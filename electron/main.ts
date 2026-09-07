import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null

const BACKEND_PORT = 4000
const isDev = !app.isPackaged

function findNode(): string {
  if (isDev) return 'node'
  // Try common Windows locations
  const candidates = [
    join(process.execPath, '..', 'node.exe'),  // bundled with Electron (unlikely)
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]
  // Try PATH
  try {
    const path = execSync('where node', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0]
    if (path && existsSync(path)) return path
  } catch {}
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return 'node' // fallback to PATH
}

function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    let cwd: string
    let entry: string
    let nodeCmd: string

    if (isDev) {
      cwd = join(__dirname, '..')
      entry = join(__dirname, '..', 'backend', 'src', 'index.ts')
      nodeCmd = 'npx'
      backendProcess = spawn(nodeCmd, ['tsx', entry], {
        cwd, env: { ...process.env, PORT: String(BACKEND_PORT) },
        stdio: ['ignore', 'pipe', 'pipe'], shell: true,
      })
    } else {
      // Bundled backend: single CJS file with argon2 in node_modules
      const backendRoot = join(process.resourcesPath, 'backend')
      cwd = backendRoot
      entry = join(backendRoot, 'dist', 'index.cjs')
      nodeCmd = findNode()

      console.log('[electron] Using node:', nodeCmd)
      console.log('[electron] Backend entry:', entry)
      console.log('[electron] Entry exists:', existsSync(entry))

      const frontendDist = join(process.resourcesPath, 'app', 'frontend', 'dist')
      const backendEnv: Record<string, string | undefined> = {
        ...process.env,
        PORT: String(BACKEND_PORT),
        NODE_ENV: 'production',
        NODE_PATH: join(backendRoot, 'dist', 'node_modules'),
      }
      // Only set FRONTEND_DIST when the directory exists. Setting it to
      // `undefined` would be serialized by spawn to the literal string
      // "undefined", which the backend would treat as the dist path and skip
      // static file serving (404 on / and /login).
      if (existsSync(frontendDist)) backendEnv.FRONTEND_DIST = frontendDist
      backendProcess = spawn(nodeCmd, [entry], {
        cwd,
        env: backendEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    let started = false
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Backend failed to start within 20 seconds'))
    }, 20000)

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[backend:out]', text.trim())
      if ((text.includes('Server started') || text.includes('listening')) && !started) {
        started = true
        clearTimeout(timeout)
        resolve()
      }
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[backend:err]', data.toString().trim())
    })

    backendProcess.on('error', (err) => {
      console.error('[electron] Spawn error:', err.message)
      if (!started) { clearTimeout(timeout); reject(err) }
    })

    backendProcess.on('exit', (code) => {
      console.log(`[electron] Backend exited with code ${code}`)
      backendProcess = null
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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', () => { if (backendProcess) { backendProcess.kill(); backendProcess = null } })

async function main() {
  try {
    console.log('[electron] Starting backend server...')
    await startBackend()
    console.log('[electron] Backend started, creating window...')
    createWindow()
  } catch (err) {
    console.error('[electron] Failed to start:', err)
    if (!mainWindow) createWindow()
  }
}

main()
