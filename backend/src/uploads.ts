import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import { logger } from './logger'

// Uploads live under the backend package root (same logic as backups), so the
// folder stays stable regardless of how the server process is launched.
let _uploadsDir: string | null = null
export function UPLOADS_DIR(): string {
  if (_uploadsDir) return _uploadsDir
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    try {
      if (existsSync(join(dir, 'package.json'))) break
    } catch {
      /* keep walking up */
    }
    const parent = require('node:path').dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  _uploadsDir = process.env.UPLOADS_DIR
    ? resolve(process.env.UPLOADS_DIR)
    : process.env.APP_DATA_DIR?.trim()
      ? join(process.env.APP_DATA_DIR.trim(), 'uploads')
      : join(dir, 'uploads')
  return _uploadsDir
}

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // 8 MB per image

export function ensureUploadsDir(): string {
  const dir = UPLOADS_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Save one uploaded image. Accepts either:
 *  - a data URL ("data:image/png;base64,....")
 *  - raw base64 with an explicit mime type
 * Returns the web path ("/uploads/<file>") to store in the DB.
 */
export function saveUploadedImage(dataUrl: string): string | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  const mime = match[1].toLowerCase()
  const base64 = match[2]
  const ext = ALLOWED_MIME[mime]
  if (!ext) return null
  const buf = Buffer.from(base64, 'base64')
  if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) return null
  ensureUploadsDir()
  // Content-addressed name: same image uploaded twice stores once.
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16)
  const fileName = `${hash}-${randomUUID().slice(0, 8)}.${ext}`
  const filePath = join(UPLOADS_DIR(), fileName)
  if (!existsSync(filePath)) {
    require('node:fs').writeFileSync(filePath, buf)
  }
  return `/uploads/${fileName}`
}

/**
 * Express middleware: POST /api/v1/uploads/image
 * Body: { dataUrl: "data:image/png;base64,..." } (single) or { dataUrls: [...] } (batch)
 * Returns: { paths: ["/uploads/xxx.png", ...] }
 */
export async function uploadImageHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { dataUrl?: unknown; dataUrls?: unknown }
    const inputs: string[] = Array.isArray(body.dataUrls)
      ? (body.dataUrls as unknown[]).filter((x): x is string => typeof x === 'string')
      : typeof body.dataUrl === 'string'
        ? [body.dataUrl]
        : []
    if (inputs.length === 0) {
      res.status(400).json({ error: 'No image data provided' })
      return
    }
    if (inputs.length > 20) {
      res.status(400).json({ error: 'Too many images (max 20 per product)' })
      return
    }
    const paths: string[] = []
    const errors: string[] = []
    for (const [i, dataUrl] of inputs.entries()) {
      const saved = saveUploadedImage(dataUrl)
      if (saved) paths.push(saved)
      else errors.push(`Image ${i + 1}: unsupported format or too large (max 8 MB, jpeg/png/webp/gif/avif)`)
    }
    if (paths.length === 0) {
      res.status(400).json({ error: errors.join('; ') || 'No valid images saved' })
      return
    }
    res.json({ ok: true, paths, errors: errors.length ? errors : undefined })
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'Image upload failed')
    res.status(500).json({ error: 'Failed to save image' })
  }
}

/**
 * Express static fallback: GET /uploads/:fileName with basic hardening.
 * (express.static is mounted on the folder in index.ts; this handler is a
 * belt-and-braces resolver used by the SPA fallback path if needed.)
 */
export function resolveUploadPath(fileName: string): string | null {
  const safe = basename(fileName)
  if (safe !== fileName || safe.startsWith('.')) return null
  const resolved = join(UPLOADS_DIR(), safe)
  if (!resolved.startsWith(UPLOADS_DIR())) return null
  return existsSync(resolved) ? resolved : null
}

export function readUpload(fileName: string): Buffer | null {
  const p = resolveUploadPath(fileName)
  if (!p) return null
  try {
    return readFileSync(p)
  } catch {
    return null
  }
}
