// ── System Status: server health, runtime info and server-side log viewer ──
// Extracted verbatim from index.ts; same paths, same guards.
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Router } from 'express'
import { config, isConfigured } from '../config'
import { checkDbHealth, getDbStats } from '../db/client'
import { getSessionStats } from '../sessions'
import { isEmailIngestConfigured } from '../orderEmailIngest'
import { requirePermission } from '../rbac'
import { requireAuth } from '../sessions'
import { logger } from '../logger'

export const systemRouter = Router()

const LOG_FILE_NAMES: Record<string, string> = {
  app: 'app.log',
  backend: 'backend.log',
  'backend-err': 'backend-err.log',
  postgres: 'postgres.log',
  pgctl: 'pgctl.log',
  dev: 'dev.log',
}

function logDirectory(): string {
  if (process.env.LOG_DIR?.trim()) return process.env.LOG_DIR.trim()
  const appData = process.env.APP_DATA_DIR?.trim()
  if (appData) return join(appData, '..', 'logs')
  const roaming = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming')
  return join(roaming, 'Opal Line Billing', 'logs')
}

function tailLines(filePath: string, count: number): string[] {
  const MAX_BYTES = 256 * 1024
  let fd: number | null = null
  try {
    const size = statSync(filePath).size
    const start = Math.max(0, size - MAX_BYTES)
    const length = size - start
    if (length <= 0) return []
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(length)
    readSync(fd, buf, 0, length, start)
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-count)
  } catch {
    return []
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

systemRouter.get('/status', requireAuth, requirePermission('system', 'view'), async (_req, res) => {
  try {
    const dbHealth = await checkDbHealth()
    const mem = process.memoryUsage()
    const sessionStats = await getSessionStats()
    res.json({
      ok: true,
      app: { name: 'Opal Line Billing', version: process.env.APP_VERSION?.trim() || 'dev' },
      runtime: { node: process.version, platform: process.platform, arch: process.arch, env: process.env.NODE_ENV ?? null },
      server: {
        port: config.port,
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapMb: Math.round(mem.heapUsed / (1024 * 1024)),
        sessions: sessionStats,
      },
      database: {
        configured: Boolean(process.env.DATABASE_URL),
        healthy: dbHealth.healthy,
        latencyMs: dbHealth.latencyMs,
        stats: dbHealth.healthy ? await getDbStats() : null,
      },
      integrations: {
        shopify: isConfigured(),
        emailIngest: isEmailIngestConfigured(),
      },
      paths: {
        logs: logDirectory(),
        env: process.env.DOTENV_CONFIG_PATH?.trim() || null,
      },
    })
  } catch (err) {
    logger.error({ err }, 'system status failed')
    res.status(500).json({ error: 'Failed to read system status' })
  }
})

systemRouter.get('/log-files', requireAuth, requirePermission('system', 'view'), (_req, res) => {
  const dir = logDirectory()
  const files = Object.entries(LOG_FILE_NAMES).map(([key, name]) => {
    try {
      const s = statSync(join(dir, name))
      return { key, name, sizeKb: Math.round(s.size / 1024), modifiedAt: s.mtime.toISOString() }
    } catch {
      return { key, name, sizeKb: 0, modifiedAt: null }
    }
  })
  res.json({ directory: dir, files })
})

systemRouter.get('/logs', requireAuth, requirePermission('system', 'view'), (req, res) => {
  const key = String(req.query.file ?? 'app')
  const name = LOG_FILE_NAMES[key]
  if (!name) return res.status(400).json({ error: 'Unknown log file' })
  const requested = Number(req.query.lines ?? 200)
  const lines = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 1000) : 200
  const filePath = join(logDirectory(), name)
  if (!existsSync(filePath)) return res.json({ file: key, directory: logDirectory(), lines: [] })
  res.json({ file: key, directory: logDirectory(), lines: tailLines(filePath, lines) })
})
