import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exportScopeData, backupDirectory } from './routes/backup'
import { logger } from './logger'

export const AUTO_BACKUP_HOUR = 19
export const AUTO_BACKUP_MINUTE = 0

export function autoBackupDirectory(): string {
  return backupDirectory()
}

const IST_TIMEZONE = 'Asia/Kolkata'

function istFileStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}-${get('hour')}-${get('minute')}-${get('second')}`
}

function msUntilNextRun(now = new Date()): number {
  const next = new Date(now)
  next.setHours(AUTO_BACKUP_HOUR, AUTO_BACKUP_MINUTE, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

async function runAutoBackup(): Promise<void> {
  const result = await exportScopeData('full')
  if (!result.ok) {
    logger.error({ err: result.error }, 'Auto backup export failed')
    return
  }
  const dir = autoBackupDirectory()
  try {
    await mkdir(dir, { recursive: true })
    const stamp = istFileStamp()
    const fileName = `auto-backup-full-${stamp}.json`
    const payload = {
      _backup: { type: 'full', label: 'Full Backup (auto)', exportedAt: new Date().toISOString() },
      data: result.data,
    }
    await writeFile(path.join(dir, fileName), JSON.stringify(payload, null, 2), 'utf8')
    logger.info({ file: fileName, tables: Object.keys(result.data).length }, 'Auto backup completed')
  } catch (err) {
    logger.error({ err }, 'Auto backup file write failed')
  }
}

let timer: NodeJS.Timeout | null = null

function schedule(): void {
  timer = setTimeout(() => {
    schedule()
    void runAutoBackup()
  }, msUntilNextRun())
  timer.unref()
}

export function startAutoBackup(): void {
  if (timer) return
  schedule()
  logger.info({ next: istFileStamp(new Date(Date.now() + msUntilNextRun())), timezone: IST_TIMEZONE }, 'Auto backup scheduled (daily 7:00 PM)')
}

export function stopAutoBackup(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
