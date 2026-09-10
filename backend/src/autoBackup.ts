import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import path from 'node:path'
import { eq, gte, isNotNull, lte, ne, sql, and } from 'drizzle-orm'
import { exportScopeData, backupDirectory } from './routes/backup'
import { logger } from './logger'
import { notifyBackupComplete, notifyLowStock, notifyDailySummary } from './notifications'
import { db } from './db/client'
import * as schema from './db/schema'

export const AUTO_BACKUP_HOUR = 19
export const AUTO_BACKUP_MINUTE = 0
export const DAILY_SUMMARY_HOUR = 9
export const DAILY_SUMMARY_MINUTE = 0

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
    await pruneOldBackups()

    // Send email notification if configured
    try {
      const email = process.env.NOTIFICATION_EMAIL?.trim()
      if (email) {
        await notifyBackupComplete(email, {
          type: 'Full Backup',
          tables: Object.keys(result.data).length,
          fileName,
        })
        logger.info({ email }, 'Backup notification sent')
      }
    } catch (err) { logger.error({ err }, 'Backup notification failed') }

    // Check low stock and send alert
    try {
      const email = process.env.NOTIFICATION_EMAIL?.trim()
      if (email && result.data.products) {
        const lowStock = (result.data.products as any[]).filter(
          (p) => p.track_inventory !== false && p.stock != null && p.reorder_level != null && Number(p.stock) <= Number(p.reorder_level)
        )
        if (lowStock.length > 0) {
          await notifyLowStock(email, lowStock.map((p) => ({
            name: p.name, sku: p.sku, stock: Number(p.stock), reorderLevel: Number(p.reorder_level)
          })))
          logger.info({ count: lowStock.length }, 'Low stock notification sent')
        }
      }
    } catch (err) { logger.error({ err }, 'Low stock notification failed') }
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

// ─── Daily summary email ────────────────────────────────────────────

let summaryTimer: NodeJS.Timeout | null = null

function msUntilNextSummary(now = new Date()): number {
  const next = new Date(now)
  next.setHours(DAILY_SUMMARY_HOUR, DAILY_SUMMARY_MINUTE, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

async function runDailySummary(): Promise<void> {
  try {
    if (!db) return
    const [settingsRow] = await db.select().from(schema.settings).where(eq(schema.settings.id, 'app')).limit(1)
    if (settingsRow && settingsRow.dailySummary === false) return
    const recipient = process.env.NOTIFICATION_EMAIL?.trim() || settingsRow?.email?.trim()
    if (!recipient) {
      logger.debug('Daily summary skipped — no NOTIFICATION_EMAIL or settings.email')
      return
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [salesRow] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.salesInvoices.grandTotal}), 0)::float` })
      .from(schema.salesInvoices)
      .where(gte(schema.salesInvoices.date, since))
    const [ordersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.salesOrders)
      .where(gte(schema.salesOrders.date, since))
    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.salesInvoices)
      .where(ne(schema.salesInvoices.paymentStatus, 'paid'))
    const [lowStockRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(and(isNotNull(schema.products.stock), isNotNull(schema.products.reorderLevel), lte(schema.products.stock, schema.products.reorderLevel)))
    const sent = await notifyDailySummary(recipient, {
      todaySales: Number(salesRow?.total ?? 0),
      todayOrders: Number(ordersRow?.count ?? 0),
      pendingPayments: Number(pendingRow?.count ?? 0),
      lowStockCount: Number(lowStockRow?.count ?? 0),
    })
    if (sent) logger.info({ recipient }, 'Daily summary email sent')
  } catch (err) {
    logger.error({ err }, 'Daily summary failed')
  }
}

function scheduleSummary(): void {
  summaryTimer = setTimeout(() => {
    scheduleSummary()
    void runDailySummary()
  }, msUntilNextSummary())
  summaryTimer.unref()
}

export function startDailySummary(): void {
  if (summaryTimer) return
  scheduleSummary()
  logger.info({ next: new Date(Date.now() + msUntilNextSummary()).toISOString() }, 'Daily summary scheduler started (9:00 AM IST)')
}

export function stopDailySummary(): void {
  if (summaryTimer) clearTimeout(summaryTimer)
  summaryTimer = null
}

const KEEP_BACKUPS = 15
const PRE_RESTORE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

async function pruneOldBackups(): Promise<void> {
  try {
    const dir = backupDirectory()
    await mkdir(dir, { recursive: true })
    const names = (await readdir(dir)).filter(n => n.endsWith('.json'))
    const files: Array<{ name: string; exportedAt: string | null; isPreRestore: boolean }> = []
    for (const name of names) {
      try {
        const raw = await readFile(path.join(dir, name), 'utf8')
        const parsed = JSON.parse(raw)
        const meta = parsed._backup as { exportedAt?: string; isPreRestore?: boolean } | undefined
        files.push({ name, exportedAt: meta?.exportedAt ?? null, isPreRestore: meta?.isPreRestore === true })
      } catch {
        files.push({ name, exportedAt: null, isPreRestore: false })
      }
    }

    const deletable = files.filter(f => !f.isPreRestore).sort((a, b) => (b.exportedAt ?? '').localeCompare(a.exportedAt ?? ''))
    const toDelete = deletable.slice(KEEP_BACKUPS)

    const cutoff = new Date(Date.now() - PRE_RESTORE_MAX_AGE_MS).toISOString()
    const oldPreRestore = files.filter(f => f.isPreRestore && f.exportedAt && f.exportedAt < cutoff)

    const deleted: string[] = []
    for (const f of [...toDelete, ...oldPreRestore]) {
      try {
        unlinkSync(path.join(dir, f.name))
        deleted.push(f.name)
      } catch { /* skip */ }
    }
    if (deleted.length > 0) {
      logger.info({ deleted: deleted.length, kept: files.length - deleted.length }, 'Auto-pruned old backups')
    }
  } catch (err) {
    logger.error({ err }, 'Backup auto-prune failed')
  }
}

export function startAutoBackup(): void {
  if (timer) return
  schedule()
  logger.info({ next: istFileStamp(new Date(Date.now() + msUntilNextRun())), timezone: IST_TIMEZONE, keepLast: KEEP_BACKUPS }, 'Auto backup scheduled (daily 7:00 PM)')
}

export function stopAutoBackup(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
