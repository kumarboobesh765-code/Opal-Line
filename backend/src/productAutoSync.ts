import { db } from './db/client'
import * as schema from './db/schema'
import { eq } from 'drizzle-orm'
import { syncProductsToDb } from './shopify'
import { logger } from './logger'

/**
 * Product auto-sync scheduler — periodically pulls the live Shopify catalog
 * into the local DB so prices/stock/products never drift for long.
 * Interval hours live in settings.autoSyncIntervalHours (0 = disabled,
 * default 6). One run = syncProductsToDb() (creates + updates, never deletes).
 */

const DEFAULT_INTERVAL_HOURS = 6
let timer: NodeJS.Timeout | null = null
let lastRunAt: string | null = null
let nextRunAt: string | null = null
let lastResult: { ok: boolean; synced?: number; created?: number; updated?: number; message?: string } | null = null
let consecutiveFailures = 0
let runHistory: Array<{ at: string; ok: boolean; created?: number; updated?: number; message?: string }> = []

export async function getAutoSyncIntervalHours(): Promise<number> {
  if (!db) return DEFAULT_INTERVAL_HOURS
  try {
    // Stored inside the settings jsonb bucket (no dedicated column needed).
    const [row] = await db.select({ notificationSettings: schema.settings.notificationSettings }).from(schema.settings).where(eq(schema.settings.id, 'app')).limit(1)
    const raw = (row?.notificationSettings as Record<string, unknown> | null)?.autoSyncIntervalHours
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_HOURS
  } catch {
    return DEFAULT_INTERVAL_HOURS
  }
}

export async function setAutoSyncIntervalHours(hours: number): Promise<void> {
  if (!db) return
  const n = Number.isFinite(hours) && hours >= 0 ? Math.floor(hours) : DEFAULT_INTERVAL_HOURS
  const [row] = await db.select({ notificationSettings: schema.settings.notificationSettings }).from(schema.settings).where(eq(schema.settings.id, 'app')).limit(1)
  const current = (row?.notificationSettings ?? {}) as Record<string, unknown>
  await db
    .update(schema.settings)
    .set({ notificationSettings: { ...current, autoSyncIntervalHours: n } })
    .where(eq(schema.settings.id, 'app'))
}

export async function runProductAutoSync(): Promise<{ ok: boolean; synced?: number; created?: number; updated?: number; message?: string }> {
  const record = (ok: boolean, message?: string, created?: number, updated?: number) => {
    runHistory = [{ at: new Date().toISOString(), ok, message, created, updated }, ...runHistory].slice(0, 50)
  }
  try {
    const result = await syncProductsToDb()
    lastRunAt = new Date().toISOString()
    lastResult = { ok: result.ok, synced: result.synced, created: result.created, updated: result.updated, message: result.ok ? undefined : result.errors?.[0] }
    if (result.ok) {
      consecutiveFailures = 0
      logger.info({ synced: result.synced, created: result.created, updated: result.updated }, 'Product auto-sync completed')
      record(true, undefined, result.created, result.updated)
    } else {
      consecutiveFailures++
      logger.warn({ err: result.errors?.[0] }, 'Product auto-sync failed')
      record(false, result.errors?.[0])
      await maybeAlertSyncFailures()
    }
    return lastResult
  } catch (err) {
    lastRunAt = new Date().toISOString()
    lastResult = { ok: false, message: err instanceof Error ? err.message : 'Unknown error' }
    consecutiveFailures++
    logger.warn({ err }, 'Product auto-sync failed')
    record(false, lastResult.message)
    await maybeAlertSyncFailures()
    return lastResult
  }
}

/** Email after 2 consecutive failures; re-alert every further failure. */
async function maybeAlertSyncFailures(): Promise<void> {
  if (consecutiveFailures < 2) return
  try {
    const email = process.env.NOTIFICATION_EMAIL?.trim()
    if (!email) return
    const { sendEmail } = await import('./notifications')
    const sent = await sendEmail({
      to: email,
      subject: `⚠️ Product auto-sync failed ${consecutiveFailures}× in a row`,
      html: `<p>The Shopify product auto-sync has failed <strong>${consecutiveFailures}</strong> times in a row.</p><p>Last error: <code>${lastResult?.message ?? 'unknown'}</code></p><p>Check the Sync page in the ERP for details, or run a manual sync.</p>`,
    })
    if (sent) logger.warn({ failures: consecutiveFailures }, 'Sync-failure alert emailed')
  } catch (err) {
    logger.warn({ err }, 'Sync-failure alert failed')
  }
}

export function getAutoSyncHistory(): Array<{ at: string; ok: boolean; created?: number; updated?: number; message?: string }> {
  return runHistory
}

function schedule(): void {
  timer = null
  void (async () => {
    const hours = await getAutoSyncIntervalHours()
    if (hours <= 0) {
      logger.debug('Product auto-sync disabled (interval = 0)')
      nextRunAt = null
      return
    }
    await runProductAutoSync()
    nextRunAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    timer = setTimeout(schedule, hours * 60 * 60 * 1000)
    timer.unref()
  })()
}

export function startProductAutoSync(): void {
  if (timer) return
  schedule()
}

export function stopProductAutoSync(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

export async function getAutoSyncStatus(): Promise<{ intervalHours: number; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastResult: typeof lastResult }> {
  const hours = await getAutoSyncIntervalHours()
  return {
    intervalHours: hours,
    enabled: hours > 0,
    nextRunAt,
    lastRunAt,
    lastResult,
  }
}
