import { app, BrowserWindow, shell, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let postgresProcess: ChildProcess | null = null

const BACKEND_PORT = 4000
const PG_PORT = 5433
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
      postgresProcess = spawn(pgCtl, [
        '-D', PGDATA,
        '-o', `"${toPgOptionPort()}"`,
        '-l', join(LOG_DIR, 'postgres.log'),
        'start',
      ], { stdio: 'pipe' })
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
          postgresProcess = spawn(sysPgCtl, ['-D', PGDATA, '-o', `"${toPgOptionPort()}"`, '-l', join(LOG_DIR, 'postgres.log'), 'start'], { stdio: 'pipe' })
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

function ensureEnvFile(databaseUrl: string): { path: string; isFirstRun: boolean } {
  const envPath = join(DATA_DIR, '.env')
  const isFirstRun = !existsSync(envPath)
  if (isFirstRun) {
    const content = [
      '# Generated by Opal Line Billing on first run.',
      'PORT=4000',
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
        env: { ...process.env, PORT: String(BACKEND_PORT), DOTENV_CONFIG_PATH: envPath },
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
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  mainWindow.on('closed', () => { mainWindow = null })
}

function stopPostgres(): void {
  if (!postgresProcess) return
  try {
    const pgCtl = pgBin('pg_ctl') ?? join(systemPostgresRoot() ?? '', 'pg_ctl.exe')
    if (pgCtl && existsSync(PGDATA)) {
      execFileSync(pgCtl, ['-D', PGDATA, 'stop', '-m', 'fast'], { stdio: 'pipe', timeout: 10000 })
    }
  } catch { /* best effort */ }
  postgresProcess = null
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null }
  stopPostgres()
})

async function main() {
  try {
    ensureDirs()
    console.log('[electron] Ensuring PostgreSQL…')
    const managedUrl = await ensurePostgres()
    const { path: envPath, isFirstRun } = ensureEnvFile(managedUrl)
    console.log('[electron] Starting backend server…')
    await startBackend(envPath, managedUrl || null)
    console.log('[electron] Backend started, creating window…')
    createWindow()
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
