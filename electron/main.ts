import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, openSync, closeSync, readSync, statSync, createWriteStream, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import * as https from 'node:https'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let localPostgresStarted = false

// Dedicated desktop port — deliberately different from the dev backend port
// Opal Line uses a dedicated port block (47191-47198) chosen to avoid
// collisions with common software on any machine. The installed app uses
// 47192/47193, distinct from the dev backend (47191), so the dev server and
// the installed desktop app can run at the same time.
const BACKEND_PORT = 47192
const PG_PORT = 47193
const isDev = !app.isPackaged

const APP_DATA = join(app.getPath('appData'), 'Opal Line Billing')
const PGDATA = join(APP_DATA, 'pgdata')
const DATA_DIR = join(APP_DATA, 'data')
const LOG_DIR = join(APP_DATA, 'logs')

function ensureDirs(): void {
  for (const d of [APP_DATA, PGDATA, DATA_DIR, LOG_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}

function logLine(stream: string, text: string): void {
  const line = `[${new Date().toISOString()}] [${stream}] ${text.trimEnd()}\n`
  try {
    const f = join(LOG_DIR, isDev ? 'dev.log' : 'app.log')
    require('node:fs').appendFileSync(f, line)
  } catch { /* ignore */ }
}

function pgRoot(): string | null {
  if (isDev) {
    const dev = resolve(__dirname, '..', 'backend', 'pgsql')
    return existsSync(dev) ? dev : null
  }
  const bundled = join(process.resourcesPath, 'pgsql')
  return existsSync(bundled) ? bundled : null
}

function pgBin(name: string): string | null {
  const root = pgRoot()
  if (!root) return null
  const candidates = [join(root, 'bin', `${name}.exe`), join(root, 'bin', name)]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function haveSystemPostgres(): boolean {
  try {
    execSync('psql --version', { encoding: 'utf8', timeout: 4000, stdio: 'pipe' })
    return true
  } catch { return false }
}

function systemPostgresRoot(): string | null {
  const candidates = [
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    'C:\\Program Files\\PostgreSQL\\15\\bin',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function getOrCreatePgPassword(): string {
  const pwFile = join(APP_DATA, '.pg-password')
  try {
    if (existsSync(pwFile)) {
      return readFileSync(pwFile, 'utf8').trim()
    }
  } catch { /* generate new */ }
  const pw = randomBytes(16).toString('base64url')
  try { writeFileSync(pwFile, pw, { mode: 0o600 }) } catch { /* best effort */ }
  return pw
}

// pg_ctl start used to be fire-and-forget: if it failed (e.g. the app raced
// the installer writing files), waitForPostgres gave up silently after 15s
// and the backend booted with no database — login 500 forever, no error shown.
// Start synchronously with -w, retry transient failures, and fail loudly.
function startPostgresWithRetry(pgCtl: string): void {
  const ATTEMPTS = 3
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (isPostgresRunning()) { localPostgresStarted = true; return }
    try {
      // IMPORTANT: never use stdio:'pipe' here. pg_ctl launches postgres.exe,
      // which inherits pg_ctl's pipe handles, so execFileSync would block until
      // the DATABASE exits — the timeout then kills a perfectly healthy server
      // (seen live as "server started" followed by "immediate shutdown" x3).
      // Route output to a log file and verify the port ourselves instead.
      const pgctlLog = openSync(join(LOG_DIR, 'pgctl.log'), 'a')
      try {
        execFileSync(pgCtl, [
          '-D', PGDATA,
          '-o', `"${toPgOptionPort()}"`,
          '-l', join(LOG_DIR, 'postgres.log'),
          'start', '-w', '-t', '15',
        ], { stdio: ['ignore', pgctlLog, pgctlLog], timeout: 30000 })
      } finally { closeSync(pgctlLog) }
      if (isPostgresRunning()) {
        localPostgresStarted = true
        console.log(`[postgres] Started on port ${PG_PORT} (attempt ${attempt})`)
        logLine('postgres', `started on port ${PG_PORT} (attempt ${attempt})`)
        return
      }
      logLine('postgres', `attempt ${attempt}: pg_ctl returned but port ${PG_PORT} is not listening`)
    } catch (err: any) {
      console.error(`[postgres] start attempt ${attempt}/${ATTEMPTS} failed:`, err?.message)
      logLine('postgres', `start attempt ${attempt}/${ATTEMPTS} failed: ${err?.message}`)
      // Clear stale pid/crash state before retrying
      try {
        execFileSync(pgCtl, ['-D', PGDATA, 'stop', '-m', 'immediate'], { stdio: 'ignore', timeout: 5000 })
      } catch { /* not running — expected */ }
    }
    if (attempt < ATTEMPTS) sleep(1500)
  }
  throw new Error(
    `PostgreSQL could not start after ${ATTEMPTS} attempts.\n\n` +
    `See the database logs for the reason:\n${join(LOG_DIR, 'postgres.log')}\n${join(LOG_DIR, 'pgctl.log')}`,
  )
}

async function ensurePostgres(): Promise<string> {
  const pgPassword = process.env.PG_PASSWORD?.trim() || getOrCreatePgPassword()
  const dbName = 'opal_line'
  const url = `postgresql://postgres:${pgPassword}@127.0.0.1:${PG_PORT}/${dbName}`

  const initdb = pgBin('initdb')
  const pgCtl = pgBin('pg_ctl')
  const createdb = pgBin('createdb')

  if (initdb && pgCtl) {
    if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
      console.log('[postgres] Initializing data directory…')
      logLine('postgres', 'initdb ' + PGDATA)
      try {
        execFileSync(initdb, ['-D', PGDATA, '-U', 'postgres', '-E', 'UTF8', '--auth=trust'], { stdio: 'pipe' })
      } catch (err: any) {
        console.error('[postgres] initdb failed:', err.message)
        logLine('postgres', 'initdb failed: ' + err.message)
        throw new Error(`PostgreSQL initdb failed: ${err.stderr?.toString() || err.message}`)
      }
    }
    if (!isPostgresRunning()) {
      console.log('[postgres] Starting bundled PostgreSQL…')
      logLine('postgres', 'starting bundled postgres on ' + PG_PORT)
      startPostgresWithRetry(pgCtl)
    }
    waitForPostgres(PG_PORT)
    if (createdb) {
      try {
        execFileSync(createdb, ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', dbName], { stdio: 'pipe' })
        console.log('[postgres] Database created')
      } catch { /* already exists */ }
    }
    return url
  }

  if (haveSystemPostgres()) {
    const sysPgRootW = systemPostgresRoot()
    if (sysPgRootW) {
      const sysInitdb = join(sysPgRootW, 'initdb.exe')
      const sysPgCtl = join(sysPgRootW, 'pg_ctl.exe')
      if (existsSync(sysInitdb) && existsSync(sysPgCtl)) {
        if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
          console.log('[postgres] Initializing data directory (system postgres)…')
          try {
            execFileSync(sysInitdb, ['-D', PGDATA, '-U', 'postgres', '-E', 'UTF8', '--auth=trust'], { stdio: 'pipe' })
          } catch (err: any) {
            throw new Error(`PostgreSQL initdb failed: ${err.stderr?.toString() || err.message}`)
          }
        }
        if (!isPostgresRunning()) {
          startPostgresWithRetry(sysPgCtl)
        }
        waitForPostgres(PG_PORT)
        const sysCreatedb = join(sysPgRootW, 'createdb.exe')
        if (existsSync(sysCreatedb)) {
          try {
            execFileSync(sysCreatedb, ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', dbName], { stdio: 'pipe' })
          } catch { /* exists */ }
        }
        return url
      }
    }
  }

  console.log('[postgres] No bundled/system PostgreSQL found — using DATABASE_URL from .env')
  logLine('postgres', 'no local postgres; using external DATABASE_URL')
  return ''
}

function toPgOptionPort(): string {
  return `-p ${PG_PORT}`
}

function isPostgresRunning(): boolean {
  try {
    execSync(`netstat -ano | findstr :${PG_PORT} | findstr LISTENING`, { encoding: 'utf8', timeout: 4000, stdio: 'pipe', shell: 'cmd.exe' })
    return true
  } catch { return false }
}

function waitForPostgres(port: number, tries = 30): void {
  for (let i = 0; i < tries; i++) {
    if (isPostgresRunning()) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  console.warn('[postgres] Did not become ready in time — continuing')
}

function processNameForPid(pid: string): string {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe', shell: 'cmd.exe' })
    const first = out.split('\n').find((l) => l.trim().startsWith('"'))
    return first ? first.split('","')[0].replace(/^"/, '') : 'unknown process'
  } catch { return 'unknown process' }
}

function pidListeningOn(port: number): string | null {
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe', shell: 'cmd.exe' })
    const line = out.split('\n').find((l) => l.trim().length > 0)
    if (!line) return null
    const pid = line.trim().split(/\s+/).pop() ?? ''
    return /^\d+$/.test(pid) ? pid : null
  } catch { return null }
}

/**
 * Fail fast — with a human-readable reason — when the dedicated ports are
 * taken before we try to bind them. Otherwise the user only sees a long
 * startup stall or a generic EADDRINUSE crash from the backend child.
 */
function preflightPorts(): boolean {
  for (const [port, label] of [[BACKEND_PORT, 'application server'] as const, [PG_PORT, 'bundled database'] as const]) {
    const pid = pidListeningOn(port)
    if (!pid) continue
    const name = processNameForPid(pid)
    if (/opal line billing/i.test(name)) {
      logLine('startup', `port ${port} held by another Opal Line instance (pid ${pid})`)
      dialog.showMessageBox({
        type: 'info',
        title: 'Opal Line Billing is already running',
        message: 'Opal Line Billing is already running.',
        detail: `Another instance holds the ${label} port (${port}). Check the system tray or taskbar and switch to the open window.`,
        buttons: ['OK'],
      })
    } else {
      logLine('startup', `port ${port} held by ${name} (pid ${pid})`)
      dialog.showErrorBox(
        'Port already in use',
        `The ${label} port (${port}) is used by:\n\n${name} (PID ${pid})\n\n` +
        `Close that program or change the port in:\n${join(DATA_DIR, '.env')}`,
      )
    }
    return false
  }
  return true
}

function ensureEnvFile(databaseUrl: string): { path: string; isFirstRun: boolean } {
  const envPath = join(DATA_DIR, '.env')
  const isFirstRun = !existsSync(envPath)
  if (isFirstRun) {
    const content = [
      '# Generated by Opal Line Billing on first run.',
      'PORT=47192',
      `DATABASE_URL=${databaseUrl}`,
      'ENCRYPTION_KEY=',
      'NODE_ENV=production',
      '',
    ].join('\n')
    writeFileSync(envPath, content, 'utf8')
    console.log('[env] Created first-run .env at', envPath)
  } else if (databaseUrl) {
    let content = readFileSync(envPath, 'utf8')
    if (!/^DATABASE_URL=/m.test(content)) {
      content = `DATABASE_URL=${databaseUrl}\n` + content
      writeFileSync(envPath, content, 'utf8')
    }
  }
  return { path: envPath, isFirstRun }
}

function findNode(): string {
  if (process.platform !== 'win32') return 'node'
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]
  try {
    const path = execSync('where node', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0]
    if (path && existsSync(path)) return path
  } catch {}
  for (const c of candidates) if (existsSync(c)) return c
  return 'node'
}

function backendCommand(): { cmd: string; baseArgs: string[] } {
  const electronNode = process.execPath
  return { cmd: electronNode, baseArgs: ['--js-flags=', '-e', 'process.env.ELECTRON_RUN_AS_NODE="1";require(process.argv[1])'] }
}

function startBackend(envPath: string, managedDbUrl: string | null): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let cwd: string
    let entry: string
    let cmd: string
    let args: string[]

    if (isDev) {
      cwd = resolve(__dirname, '..', 'backend')
      entry = resolve(__dirname, '..', 'backend', 'src', 'index.ts')
      cmd = 'npx'
      args = ['tsx', entry]
      backendProcess = spawn(cmd, args, {
        cwd,
        env: { ...process.env, PORT: String(BACKEND_PORT), DOTENV_CONFIG_PATH: envPath, APP_VERSION: app.getVersion(), LOG_DIR },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      })
    } else {
      const backendRoot = join(process.resourcesPath, 'backend')
      cwd = backendRoot
      entry = join(backendRoot, 'dist', 'index.cjs')
      cmd = process.execPath
      args = [entry]
      const backendEnv: Record<string, string | undefined> = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(BACKEND_PORT),
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: envPath,
        APP_DATA_DIR: DATA_DIR,
        LOG_DIR,
        APP_VERSION: app.getVersion(),
        NODE_PATH: join(backendRoot, 'dist', 'node_modules'),
      }
      if (managedDbUrl) backendEnv.DATABASE_URL = managedDbUrl
      if (!backendEnv.DATABASE_URL) {
        dialog.showErrorBox(
          'Database not configured',
          'No PostgreSQL database is available.\n\n' +
          'Start the bundled database or set DATABASE_URL in:\n' + envPath,
        )
        reject(new Error('No DATABASE_URL'))
        return
      }
      console.log('[electron] Backend entry:', entry, 'exists:', existsSync(entry))
      backendProcess = spawn(cmd, args, { cwd, env: backendEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    }

    let started = false
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Backend failed to start within 25 seconds'))
    }, 25000)

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[backend:out]', text.trim())
      logLine('backend', text)
      if ((text.includes('Server started') || text.includes('listening')) && !started) {
        started = true
        clearTimeout(timeout)
        resolvePromise()
      }
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.error('[backend:err]', text.trim())
      logLine('backend-err', text)
      // Port conflict fails instantly — don't make the user wait out the timeout.
      if (!started && /EADDRINUSE|already in use/i.test(text)) {
        clearTimeout(timeout)
        reject(new Error(
          `Port ${BACKEND_PORT} is already in use.\n\n` +
          'Another instance of Opal Line Billing — or the development server (npm run dev) — is already using it.\n\n' +
          'Close the other one, then reopen Opal Line Billing.',
        ))
      }
    })

    backendProcess.on('error', (err) => {
      console.error('[electron] Spawn error:', err.message)
      if (!started) { clearTimeout(timeout); reject(err) }
    })

    backendProcess.on('exit', (code) => {
      console.log(`[electron] Backend exited with code ${code}`)
      logLine('backend', `exited code ${code}`)
      backendProcess = null
      if (!started) {
        clearTimeout(timeout)
        reject(new Error(`The backend process exited with code ${code} before the server was ready.\n\nCheck the logs in the app data folder for details.`))
      }
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 600,
    title: 'Opal Line — Billing Software',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:47195')
  } else {
    mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  mainWindow.on('closed', () => { mainWindow = null })
}

function stopPostgres(): void {
  if (!localPostgresStarted) return
  try {
    const pgCtl = pgBin('pg_ctl') ?? join(systemPostgresRoot() ?? '', 'pg_ctl.exe')
    if (pgCtl && existsSync(PGDATA)) {
      execFileSync(pgCtl, ['-D', PGDATA, 'stop', '-m', 'fast'], { stdio: 'pipe', timeout: 10000 })
    }
  } catch { /* best effort */ }
  localPostgresStarted = false
}

// ── Auto-update ──────────────────────────────────────────────────────────
// Packaged builds poll GitHub Releases for a newer v* tag, download the signed
// NSIS installer, verify its SHA-256 (release asset digest) and Authenticode
// signer subject, then relaunch it silently after the app quits. The renderer
// drives it through the preload bridge (System Status page).
const UPDATE_REPO = 'kumarboobesh765-code/Opal-Line'
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  phase: UpdatePhase
  latest: string | null
  progress: number
  assetName: string | null
  assetSize: number | null
  filePath: string | null
  error: string | null
}

let updateState: UpdateState = { phase: 'idle', latest: null, progress: 0, assetName: null, assetSize: null, filePath: null, error: null }
let updateDownloadUrl: string | null = null
let updateExpectedSha256: string | null = null
let updateDialogOpen = false

function publicUpdateState(): UpdateState & { current: string } {
  return { ...updateState, current: app.isPackaged ? app.getVersion() : 'dev' }
}

function httpsGetBody(url: string, headers: Record<string, string>, timeoutMs: number, redirects = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectP) => {
    const req = https.get(url, { headers, timeout: timeoutMs }, (resp) => {
      const location = resp.headers.location
      if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && location) {
        resp.resume()
        if (redirects >= 5) { rejectP(new Error('Too many redirects')); return }
        httpsGetBody(location, headers, timeoutMs, redirects + 1).then(resolvePromise, rejectP)
        return
      }
      let data = ''
      resp.setEncoding('utf8')
      resp.on('data', (chunk: string) => { data += chunk })
      resp.on('end', () => resolvePromise({ status: resp.statusCode ?? 0, body: data }))
    })
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', rejectP)
  })
}

function httpsDownload(url: string, dest: string, totalBytes: number, onProgress: (pct: number) => void, redirects = 0): Promise<void> {
  return new Promise((resolvePromise, rejectP) => {
    const req = https.get(url, { timeout: 60000 }, (resp) => {
      const location = resp.headers.location
      if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && location) {
        resp.resume()
        if (redirects >= 5) { rejectP(new Error('Too many redirects')); return }
        httpsDownload(location, dest, totalBytes, onProgress, redirects + 1).then(resolvePromise, rejectP)
        return
      }
      if (resp.statusCode !== 200) {
        resp.resume()
        rejectP(new Error(`Download failed (HTTP ${resp.statusCode})`))
        return
      }
      const file = createWriteStream(dest)
      let received = 0
      let lastPct = -1
      resp.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (totalBytes > 0) {
          const pct = Math.min(99, Math.floor((received / totalBytes) * 100))
          if (pct !== lastPct) { lastPct = pct; onProgress(pct) }
        }
      })
      resp.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          if (totalBytes > 0 && received !== totalBytes) {
            rejectP(new Error(`Download truncated (${received}/${totalBytes} bytes)`))
            return
          }
          onProgress(100)
          resolvePromise()
        })
      })
      file.on('error', rejectP)
      resp.on('error', rejectP)
    })
    req.on('timeout', () => req.destroy(new Error('Download timed out')))
    req.on('error', rejectP)
  })
}

function sha256File(file: string): string {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const size = statSync(file).size
    const buf = Buffer.alloc(1024 * 1024)
    let pos = 0
    while (pos < size) {
      const read = readSync(fd, buf, 0, buf.length, pos)
      if (read <= 0) break
      hash.update(buf.subarray(0, read))
      pos += read
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

function verifyInstallerSignature(file: string): void {
  const escaped = file.replace(/'/g, "''")
  const script = [
    `$s = Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    'if (-not $s.SignerCertificate) { exit 2 }',
    "if ($s.Status -eq 'HashMismatch' -or $s.Status -eq 'NotSigned') { exit 3 }",
    "if ($s.SignerCertificate.Subject -notlike '*Opal Line Billing*') { exit 4 }",
    'exit 0',
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', timeout: 60000 })
}

function isNewerVersion(current: string, latest: string): boolean {
  const pa = current.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = latest.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

async function checkForUpdates(opts: { announce: boolean }): Promise<UpdateState & { current: string }> {
  if (!app.isPackaged) {
    updateState = { ...updateState, phase: 'up-to-date' }
    return publicUpdateState()
  }
  if (updateState.phase === 'checking' || updateState.phase === 'downloading') return publicUpdateState()
  updateState = { ...updateState, phase: 'checking', error: null }
  try {
    const { status, body } = await httpsGetBody(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { 'User-Agent': 'opal-line-updater', Accept: 'application/vnd.github+json' },
      20000,
    )
    if (status !== 200) throw new Error(`GitHub API returned HTTP ${status}`)
    const release = JSON.parse(body) as {
      tag_name?: string
      assets?: Array<{ name: string; browser_download_url: string; size: number; digest?: string }>
    }
    const latest = (release.tag_name ?? '').trim().replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('Latest release has no usable version tag')
    const current = app.getVersion()
    if (!isNewerVersion(current, latest)) {
      updateState = { ...updateState, phase: 'up-to-date', latest }
      logLine('update', `up to date: installed ${current}, latest ${latest}`)
      return publicUpdateState()
    }
    const assets = release.assets ?? []
    const asset = assets.find((a) => /-Setup-.*\.exe$/i.test(a.name)) ?? assets.find((a) => a.name.endsWith('.exe'))
    if (!asset) throw new Error('Newer release has no installer asset')
    updateDownloadUrl = asset.browser_download_url
    updateExpectedSha256 = asset.digest && asset.digest.toLowerCase().startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null
    updateState = { ...updateState, phase: 'available', latest, assetName: asset.name, assetSize: asset.size, error: null }
    logLine('update', `version ${latest} available (installed ${current})`)
    if (opts.announce && !updateDialogOpen) {
      updateDialogOpen = true
      dialog.showMessageBox({
        type: 'info',
        title: 'Opal Line Billing — Update available',
        message: `Version ${latest} is available.`,
        detail: `You have ${current}. The update will be downloaded and verified, then the app will restart to install it.`,
        buttons: ['Download & install', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
        .then((r) => { updateDialogOpen = false; if (r.response === 0) void downloadUpdateAndOfferInstall() })
        .catch(() => { updateDialogOpen = false })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    updateState = { ...updateState, phase: 'error', error: message }
    logLine('update', `check failed: ${message}`)
  }
  return publicUpdateState()
}

async function downloadUpdateAndOfferInstall(): Promise<UpdateState & { current: string }> {
  if (!updateDownloadUrl || !updateState.latest || !updateState.assetName) return publicUpdateState()
  if (updateState.phase === 'downloading' || updateState.phase === 'ready') return publicUpdateState()
  const dest = join(app.getPath('temp'), `OpalLine-Setup-${updateState.latest}.exe`)
  updateState = { ...updateState, phase: 'downloading', progress: 0, error: null }
  logLine('update', `downloading ${updateState.assetName}…`)
  try {
    await httpsDownload(updateDownloadUrl, dest, updateState.assetSize ?? 0, (pct) => {
      updateState = { ...updateState, progress: pct }
      if (pct % 25 === 0) logLine('update', `download ${pct}%`)
    })
    if (updateExpectedSha256) {
      const actual = sha256File(dest)
      if (actual !== updateExpectedSha256) throw new Error('Downloaded installer failed SHA-256 verification')
    }
    try {
      verifyInstallerSignature(dest)
    } catch {
      throw new Error('Downloaded installer failed signature verification')
    }
    updateState = { ...updateState, phase: 'ready', progress: 100, filePath: dest }
    logLine('update', `verified update ${updateState.latest} at ${dest}`)
    if (!updateDialogOpen) {
      updateDialogOpen = true
      dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Version ${updateState.latest} is downloaded and verified.`,
        detail: 'The app will restart to finish the update.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
        .then((r) => { updateDialogOpen = false; if (r.response === 0) installUpdateAndRestart() })
        .catch(() => { updateDialogOpen = false })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    updateState = { ...updateState, phase: 'error', error: message }
    logLine('update', `download failed: ${message}`)
    try { rmSync(dest, { force: true }) } catch { /* ignore */ }
  }
  return publicUpdateState()
}

function installUpdateAndRestart(): void {
  if (!updateState.filePath) return
  const setup = updateState.filePath
  logLine('update', `restarting into installer ${setup}`)
  const ps = `Start-Sleep -Seconds 4; Start-Process -FilePath '${setup.replace(/'/g, "''")}' -ArgumentList '/S'`
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  app.quit()
}

ipcMain.handle('updates:status', () => publicUpdateState())
ipcMain.handle('updates:check', () => checkForUpdates({ announce: false }))
ipcMain.handle('updates:download', () => downloadUpdateAndOfferInstall())
ipcMain.handle('updates:install', () => {
  if (updateState.phase === 'ready') {
    installUpdateAndRestart()
    return true
  }
  return false
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null }
  stopPostgres()
})

async function main() {
  try {
    ensureDirs()
    if (!preflightPorts()) {
      app.quit()
      return
    }
    console.log('[electron] Ensuring PostgreSQL…')
    const managedUrl = await ensurePostgres()
    const { path: envPath, isFirstRun } = ensureEnvFile(managedUrl)
    console.log('[electron] Starting backend server…')
    await startBackend(envPath, managedUrl || null)
    console.log('[electron] Backend started, creating window…')
    createWindow()
    // Auto-update: first check shortly after launch, then every 6 hours.
    if (app.isPackaged) {
      setTimeout(() => { void checkForUpdates({ announce: true }) }, 60 * 1000)
      setInterval(() => { void checkForUpdates({ announce: true }) }, UPDATE_CHECK_INTERVAL_MS)
    }
    // On first run, show credentials dialog after a short delay
    if (isFirstRun) {
      setTimeout(() => {
        dialog.showMessageBox({
          type: 'info',
          title: 'Opal Line Billing — First Run',
          message: 'Admin account created!',
          detail: 'Username: admin\nPassword: Opal@2026\n\nYou MUST change this password after first login.',
          buttons: ['OK'],
        })
      }, 3000)
    }
  } catch (err) {
    console.error('[electron] Failed to start:', err)
    logLine('electron', 'startup failed: ' + String((err as Error)?.message ?? err))
    dialog.showErrorBox('Startup failed', String((err as Error)?.message ?? err))
    if (!mainWindow) createWindow()
  }
}

main()
