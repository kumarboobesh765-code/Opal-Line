// Deletes the remaining test residue identified by list-test-residue.mts:
//   - 6 test products on the live Shopify store (known ids, double-checked by name)
//   - their local billing-DB rows: products, stock_levels, stock_movements
// Idempotent: safe to re-run; reports what was already gone.
//
// Usage: cd backend && npx tsx scripts/delete-test-residue.mts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'

function readTrim(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
  } catch {
    return null
  }
}

const appDir = join(process.env.APPDATA ?? '', 'Opal Line Billing')
const dataDir = join(appDir, 'data')

const key = readTrim(join(dataDir, '.encryption-key'))
if (key && !process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = key

const pgPassword = readTrim(join(appDir, '.pg-password'))?.replace(/\r?\n/g, '') ?? ''
if (pgPassword && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `postgres://postgres:${pgPassword}@127.0.0.1:47193/opal_line`
}

const { decrypt, decryptSecret } = await import('../src/lib/crypto')
const { db, schema, getRawClient } = await import('../src/db/client')

function maybeDecrypt(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return value.startsWith('encV1:') ? decryptSecret(value) : decrypt(value)
  } catch {
    return ''
  }
}

if (process.env.DATABASE_URL && (!process.env.SHOPIFY_STORE_URL || !process.env.SHOPIFY_ACCESS_TOKEN)) {
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 'app')).limit(1)
  process.env.SHOPIFY_STORE_URL ||= maybeDecrypt(settings?.shopifyStoreUrlEncrypted)
  process.env.SHOPIFY_ACCESS_TOKEN ||= maybeDecrypt(settings?.shopifyAccessTokenEncrypted)
  process.env.SHOPIFY_API_VERSION ||= settings?.shopifyApiVersion ?? '2025-10'
}

const { config, isConfigured } = await import('../src/config')

// Exactly the residue list-test-residue.mts confirmed — never a name match alone.
const TEST_STORE_IDS = [
  '15436294914141', '15436373000285', '15436393545821',
  '15436424249437', '15436455313501', '8237702414429',
]
// Belt and braces: only delete local rows whose name also looks like test data.
const TEST_NAME_RE = /^(Test Silver Ring|E2E TEST PENDING IMPORT)$/

let failures = 0

// ── 1. live store ───────────────────────────────────────────────────────────
if (!isConfigured()) {
  console.log('SKIP store: no Shopify credentials.')
} else {
  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms))
  }
  async function fetchWithBackoff(url: URL, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, init)
      if (res.status !== 429) return res
      const retryAfter = Number(res.headers.get('Retry-After'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 750 * (attempt + 1)
      await sleep(waitMs)
    }
    return fetch(url, init)
  }
  async function admin(path: string, method: string, body?: unknown): Promise<{ status: number; text: string }> {
    const url = new URL(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/${path}`)
    const res = await fetchWithBackoff(url, {
      method,
      headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, text: await res.text() }
  }

  console.log(`Store: ${config.shop}.myshopify.com · API ${config.apiVersion}`)
  for (const id of TEST_STORE_IDS) {
    const before = await admin(`products/${id}.json`, 'GET')
    if (before.status === 404) {
      console.log(`  id=${id} already absent`)
      continue
    }
    let title = ''
    try { title = JSON.parse(before.text).product?.title ?? '' } catch { /* raw */ }
    if (!TEST_NAME_RE.test(title)) {
      console.log(`  SKIPPED id=${id} — title ${JSON.stringify(title)} is not in the expected test set`)
      failures++
      continue
    }
    const del = await admin(`products/${id}.json`, 'DELETE')
    const ok = del.status === 200
    if (!ok) failures++
    console.log(`  id=${id} ${JSON.stringify(title)} → DELETE ${del.status} ${ok ? 'ok' : del.text.slice(0, 150)}`)
    await sleep(600) // stay well under the store's 2 calls/second
  }
  // verify: none of the ids remain
  let remaining = 0
  for (const id of TEST_STORE_IDS) {
    const check = await admin(`products/${id}.json`, 'GET')
    if (check.status !== 404) remaining++
    await sleep(600)
  }
  console.log(`store verification: ${remaining} of ${TEST_STORE_IDS.length} test ids still present`)
  if (remaining > 0) failures++
}

// ── 2. local billing DB ─────────────────────────────────────────────────────
const all = await db.select().from(schema.products)
const targets = all.filter((r) => TEST_STORE_IDS.includes(String(r.shopifyId)) && TEST_NAME_RE.test(r.name ?? ''))
console.log(`\nlocal test product rows to delete: ${targets.length}/${TEST_STORE_IDS.length}`)

if (targets.length > 0) {
  const ids = targets.map((r) => r.id)

  await db.delete(schema.stockLevels).where(inArray(schema.stockLevels.productId, ids))
  await db.delete(schema.stockMovements).where(inArray(schema.stockMovements.productId, ids))
  await db.delete(schema.products).where(inArray(schema.products.id, ids))
  console.log(`deleted: products=${targets.length} stock_levels/stock_movements removed`)

  // verify
  const after = await db.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.id, ids))
  const lvAfter = await db.select({ productId: schema.stockLevels.productId }).from(schema.stockLevels).where(inArray(schema.stockLevels.productId, ids))
  const mvAfter = await db.select({ productId: schema.stockMovements.productId }).from(schema.stockMovements).where(inArray(schema.stockMovements.productId, ids))
  console.log(`local verification: products left=${after.length} stock_levels left=${lvAfter.length} stock_movements left=${mvAfter.length}`)
  if (after.length || lvAfter.length || mvAfter.length) failures++
} else {
  console.log('local: nothing to delete (already clean)')
}

console.log(`\nRESULT: ${failures === 0 ? 'CLEAN' : `${failures} FAILURE(S)`}`)
await getRawClient()?.end({ timeout: 3 }).catch(() => undefined)
const exitCode = failures === 0 ? 0 : 1
process.exitCode = exitCode
const safety = setTimeout(() => process.exit(exitCode), 10_000)
safety.unref()
