// ── Opal Line port-block diagnostics (47191-47198) ─────────────────────────
// The desktop app reserves a dedicated port block (dev backend, installed
// backend, bundled PostgreSQL, Vite, Docker mappings). When a launch reports
// "port already in use" the user needs to see WHO holds the port: this module
// inspects the block and reports the listening PID and process image so a
// leftover process can be identified instead of guessed at.
//
// Windows (the desktop target) gets the full answer from `netstat -ano`
// (listening PID) + `tasklist` (image name). Anywhere else — or if netstat
// fails — a localhost connect probe still reports busy/free, just without the
// owning PID. Nothing here mutates state; it is safe to call on a timer.
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface OpalPortInfo {
  port: number
  label: string
  inUse: boolean
  pid: number | null
  process: string | null
  /** True when the holder is this very backend process. */
  isSelf: boolean
  /** How inUse was determined: netstat (authoritative, gives a PID) or probe. */
  source: 'netstat' | 'probe'
}

export const OPAL_PORT_BLOCK: ReadonlyArray<{ port: number; label: string }> = [
  { port: 47191, label: 'Backend API — development' },
  { port: 47192, label: 'Backend API — installed app' },
  { port: 47193, label: 'PostgreSQL — installed app' },
  { port: 47194, label: 'Reserved (Opal Line block)' },
  { port: 47195, label: 'Vite dev server (UI)' },
  { port: 47196, label: 'Backend — Docker' },
  { port: 47197, label: 'Frontend — Docker (nginx)' },
  { port: 47198, label: 'PostgreSQL — Docker' },
]

/**
 * Parse `netstat -ano -p tcp` output into port → listening PID.
 * Rows look like:
 *   TCP    0.0.0.0:47192        0.0.0.0:0              LISTENING       12345
 *   TCP    [::1]:47193          [::]:0                 LISTENING       999
 * Non-LISTENING states (TIME_WAIT, ESTABLISHED…) and UDP rows are ignored —
 * only a LISTENING socket actually blocks a new bind.
 */
export function parseNetstatListeners(output: string): Map<number, number> {
  const listeners = new Map<number, number>()
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    if (cols[0].toLowerCase() !== 'tcp') continue
    if (cols[3].toLowerCase() !== 'listening') continue
    const portMatch = /:(\d+)$/.exec(cols[1])
    if (!portMatch) continue
    const port = Number(portMatch[1])
    const pid = Number(cols[4])
    if (!Number.isFinite(port) || !Number.isFinite(pid) || pid <= 0) continue
    // First LISTENING row wins when a port has sockets on several addresses.
    if (!listeners.has(port)) listeners.set(port, pid)
  }
  return listeners
}

/** Parse `tasklist /FO CSV /NH` output into PID → image name. */
export function parseTasklistCsv(output: string): Map<number, string> {
  const images = new Map<number, string>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line.trim())
    if (!m) continue
    const pid = Number(m[2])
    if (!Number.isFinite(pid) || pid <= 0) continue
    if (!images.has(pid)) images.set(pid, m[1])
  }
  return images
}

/**
 * Is something listening on this port? Used where netstat is unavailable.
 * A refused connection means free; on localhost a refusal is immediate, so a
 * timeout is treated as "something is there" (conservative for diagnostics).
 */
export function probePort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = connect({ port, host })
    const done = (inUse: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(400, () => done(true))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

async function netstatListeners(): Promise<Map<number, number> | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    return parseNetstatListeners(stdout)
  } catch {
    return null
  }
}

async function tasklistImages(pids: number[]): Promise<Map<number, string>> {
  if (process.platform !== 'win32' || pids.length === 0) return new Map()
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    const all = parseTasklistCsv(stdout)
    const picked = new Map<number, string>()
    for (const pid of pids) {
      const name = all.get(pid)
      if (name) picked.set(pid, name)
    }
    return picked
  } catch {
    return new Map()
  }
}

/** Inspect every port in the Opal Line block (who holds it, and how we know). */
export async function inspectOpalPorts(): Promise<OpalPortInfo[]> {
  const listeners = await netstatListeners()
  if (listeners) {
    const pids = [...new Set(listeners.values())]
    const images = await tasklistImages(pids)
    return OPAL_PORT_BLOCK.map(({ port, label }) => {
      const pid = listeners.get(port) ?? null
      return {
        port,
        label,
        inUse: pid !== null,
        pid,
        process: pid !== null ? images.get(pid) ?? null : null,
        isSelf: pid !== null && pid === process.pid,
        source: 'netstat' as const,
      }
    })
  }
  // No netstat (non-Windows, or it failed): still report busy/free, without PID.
  const probes = await Promise.all(OPAL_PORT_BLOCK.map(({ port }) => probePort(port)))
  return OPAL_PORT_BLOCK.map(({ port, label }, i) => ({
    port,
    label,
    inUse: probes[i],
    pid: null,
    process: null,
    isSelf: false,
    source: 'probe' as const,
  }))
}
