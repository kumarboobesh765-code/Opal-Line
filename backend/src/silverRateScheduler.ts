import { db, schema } from './db/client'
import { applySilverRate } from './shopify'
import { logger } from './logger'

export const SILVER_RATE_HOUR = 9
export const SILVER_RATE_MINUTE = 0

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
  next.setHours(SILVER_RATE_HOUR, SILVER_RATE_MINUTE, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

/**
 * Fetch the current silver spot rate (INR/gram) from a configurable HTTP API.
 * Configure via env:
 *   SILVER_RATE_API_URL  — full URL of a JSON endpoint returning a price
 *   SILVER_RATE_API_KEY  — optional API key sent as x-access-token
 * The response may use any of several common shapes (rate / price / silver).
 * Returns null when unconfigured or on any failure — never guesses a price.
 */
export async function fetchSilverSpotRate(): Promise<number | null> {
  const url = process.env.SILVER_RATE_API_URL?.trim()
  if (!url) {
    logger.warn('Auto silver rate: SILVER_RATE_API_URL is not configured')
    return null
  }
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    const key = process.env.SILVER_RATE_API_KEY?.trim()
    if (key) headers['x-access-token'] = key
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Auto silver rate: rate API returned an error status')
      return null
    }
    const json: unknown = await res.json()
    const candidates = [
      (json as Record<string, unknown>)?.rate,
      (json as Record<string, unknown>)?.price,
      (json as Record<string, unknown>)?.silver,
      (json as { rates?: Record<string, unknown> })?.rates?.silver,
      (json as { data?: Record<string, unknown> })?.data?.silver,
    ]
    for (const c of candidates) {
      const n = Number(c)
      if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n
    }
    logger.warn({ keys: Object.keys((json as Record<string, unknown>) ?? {}) }, 'Auto silver rate: unrecognized API response shape')
    return null
  } catch (err) {
    logger.warn({ err }, 'Auto silver rate: fetch failed')
    return null
  }
}

async function runSilverRateUpdate(): Promise<void> {
  try {
    if (!db) return
    const [settings] = await db.select().from(schema.settings).limit(1)
    if (!settings?.autoUpdateMcx) return // feature disabled — nothing to do
    const rate = await fetchSilverSpotRate()
    if (rate == null) {
      logger.warn('Auto silver rate update skipped (no configured source or fetch failed)')
      return
    }
    const result = await applySilverRate(rate)
    if (result.ok) {
      logger.info({ rate, repriced: result.affected ?? 0, pushed: result.updated ?? 0 }, 'Auto silver rate update completed')
    } else {
      logger.error({ errors: result.errors }, 'Auto silver rate update failed')
    }
  } catch (err) {
    logger.error({ err }, 'Auto silver rate update crashed')
  }
}

let timer: NodeJS.Timeout | null = null

function schedule(): void {
  timer = setTimeout(() => {
    schedule()
    void runSilverRateUpdate()
  }, msUntilNextRun())
  timer.unref()
}

export function startSilverRateScheduler(): void {
  if (timer) return
  schedule()
  logger.info(
    { next: istFileStamp(new Date(Date.now() + msUntilNextRun())), timezone: IST_TIMEZONE },
    'Silver rate auto-update scheduled (daily 9:00 AM)',
  )
}

export function stopSilverRateScheduler(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
