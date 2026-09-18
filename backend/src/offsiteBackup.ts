import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { AwsClient } from 'aws4fetch'
import { logger } from './logger'
import { autoBackupDirectory } from './autoBackup'

/**
 * Off-site backup sync — pushes auto-backup JSON files to any S3-compatible
 * bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO…) using aws4fetch SigV4.
 * Zero-config when env vars are absent: every function no-ops safely.
 *
 * Required env:
 *   BACKUP_OFFSITE_ENDPOINT  e.g. https://<accountid>.r2.cloudflarestorage.com or https://s3.amazonaws.com
 *   BACKUP_OFFSITE_BUCKET    bucket name
 *   BACKUP_OFFSITE_KEY_ID    access key id
 *   BACKUP_OFFSITE_SECRET    secret access key
 * Optional env:
 *   BACKUP_OFFSITE_PREFIX    key prefix (default "opal-line-backups")
 *   BACKUP_OFFSITE_REGION    (default "auto" — correct for R2/B2)
 */

export interface OffsiteConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  region: string
}

export function isOffsiteConfigured(): boolean {
  return Boolean(
    process.env.BACKUP_OFFSITE_ENDPOINT?.trim() &&
    process.env.BACKUP_OFFSITE_BUCKET?.trim() &&
    process.env.BACKUP_OFFSITE_KEY_ID?.trim() &&
    process.env.BACKUP_OFFSITE_SECRET?.trim(),
  )
}

function getConfig(): OffsiteConfig | null {
  if (!isOffsiteConfigured()) return null
  return {
    endpoint: process.env.BACKUP_OFFSITE_ENDPOINT!.trim().replace(/\/+$/, ''),
    bucket: process.env.BACKUP_OFFSITE_BUCKET!.trim(),
    accessKeyId: process.env.BACKUP_OFFSITE_KEY_ID!.trim(),
    secretAccessKey: process.env.BACKUP_OFFSITE_SECRET!.trim(),
    prefix: process.env.BACKUP_OFFSITE_PREFIX?.trim() || 'opal-line-backups',
    region: process.env.BACKUP_OFFSITE_REGION?.trim() || 'auto',
  }
}

function client(cfg: OffsiteConfig): AwsClient {
  return new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey })
}

function fileKey(cfg: OffsiteConfig, fileName: string): string {
  return `${cfg.prefix}/${fileName}`
}

/** Push every local auto-backup file that is not yet on the bucket (HEAD check first). */
export async function syncBackupsOffsite(): Promise<{ ok: boolean; uploaded: string[]; skipped: number; error?: string }> {
  const cfg = getConfig()
  if (!cfg) return { ok: false, uploaded: [], skipped: 0, error: 'Off-site backup not configured (set BACKUP_OFFSITE_* env vars)' }
  const aws = client(cfg)
  const dir = autoBackupDirectory()
  const uploaded: string[] = []
  let skipped = 0
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
    for (const name of names) {
      const key = fileKey(cfg, name)
      const url = `${cfg.endpoint}/${cfg.bucket}/${encodeURIComponent(key)}`
      try {
        const head = await aws.fetch(url, { method: 'HEAD' })
        if (head.ok) { skipped++; continue }
      } catch { /* not there — upload */ }
      const body = await readFile(path.join(dir, name))
      const put = await aws.fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
        body,
      })
      if (put.ok) {
        uploaded.push(name)
        logger.info({ key }, 'Backup uploaded off-site')
      } else {
        logger.warn({ key, status: put.status }, 'Off-site upload failed')
      }
    }
    return { ok: true, uploaded, skipped }
  } catch (err) {
    return { ok: false, uploaded, skipped, error: err instanceof Error ? err.message : 'Off-site sync failed' }
  }
}

/** Quick credential/bucket check used by the "Test" button in Connections. */
export async function testOffsiteConnection(): Promise<{ ok: boolean; error?: string; bucket?: string }> {
  const cfg = getConfig()
  if (!cfg) return { ok: false, error: 'Not configured (BACKUP_OFFSITE_* env vars)' }
  try {
    const aws = client(cfg)
    const res = await aws.fetch(`${cfg.endpoint}/${cfg.bucket}?list-type=2&max-keys=1`, { method: 'GET' })
    if (res.ok) return { ok: true, bucket: cfg.bucket }
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 120)}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}

/** Hook called after each auto backup — fire-and-forget, never blocks. */
export async function pushLatestBackupOffsite(fileName: string): Promise<void> {
  const cfg = getConfig()
  if (!cfg) return
  const aws = client(cfg)
  try {
    const body = await readFile(path.join(autoBackupDirectory(), fileName))
    const url = `${cfg.endpoint}/${cfg.bucket}/${encodeURIComponent(fileKey(cfg, fileName))}`
    const put = await aws.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    })
    if (put.ok) logger.info({ key: fileKey(cfg, fileName) }, 'Auto backup pushed off-site')
    else logger.warn({ status: put.status }, 'Off-site push of latest backup failed')
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Off-site push skipped')
  }
}
