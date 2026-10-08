// Read-only inventory of remaining test residue, before deleting anything.
//   - local billing DB: products table rows that look like test data
//   - live Shopify store: the 6 known test product ids (+ a name scan)
//
// Credentials bootstrap copied from live-collections-check.mts (env BEFORE src/).
//
// Usage: cd backend && npx tsx scripts/list-test-residue.mts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const { eq } = await import('drizzle-orm')

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

// ── local billing DB ────────────────────────────────────────────────────────
const all = await db
  .select({
    id: schema.products.id,
    sku: schema.products.sku,
    name: schema.products.name,
    shopifyId: schema.products.shopifyId,
    collection: schema.products.collection,
  })
  .from(schema.products)

console.log(`\nLOCAL products table: ${all.length} total rows`)
const testish = all.filter((r) => {
  const n = (r.name ?? '').toLowerCase()
  const s = (r.sku ?? '').toLowerCase()
  return n.includes('test') || n.includes('e2e') || s.includes('test') || s.includes('e2e')
})
console.log(`test-looking rows: ${testish.length}`)
for (const r of testish) {
  console.log(`  id=${r.id} sku=${JSON.stringify(r.sku)} name=${JSON.stringify(r.name)} shopify_id=${r.shopifyId ?? '-'} collection=${JSON.stringify(r.collection)}`)
}

// ── live Shopify store ──────────────────────────────────────────────────────
if (!isConfigured()) {
  console.log('\nSKIP: no Shopify credentials (store scan skipped).')
  process.exit(0)
}

const KNOWN_IDS = ['15436294914141', '15436373000285', '15436393545821', '15436424249437', '15436455313501', '8237702414429']

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

async function rest<T>(path: string, query = ''): Promise<T> {
  const url = new URL(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/${path}`)
  if (query) url.search = query
  const res = await fetchWithBackoff(url, {
    headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
}

const found: ShopifyProduct[] = []
let nextPage = ''
do {
  const q = new URLSearchParams({ limit: '250', fields: 'id,title,handle' })
  if (nextPage) q.set('page_info', nextPage)
  const res = await rest<{ products: ShopifyProduct[]; next_page_info?: string }>('products.json', q.toString())
  found.push(...(res.products ?? []))
  nextPage = res.next_page_info ?? ''
} while (nextPage)

console.log(`\nSTORE products: ${found.length} total`)
const known = found.filter((p) => KNOWN_IDS.includes(String(p.id)))
const named = found.filter((p) => /test|e2e/i.test(p.title) || /test|e2e/i.test(p.handle))
console.log(`known test ids present: ${known.length}/${KNOWN_IDS.length}`)
for (const p of known) console.log(`  id=${p.id} title=${JSON.stringify(p.title)} handle=${p.handle}`)
console.log(`name-matching test products: ${named.length}`)
for (const p of named) console.log(`  id=${p.id} title=${JSON.stringify(p.title)} handle=${p.handle}`)

const missing = KNOWN_IDS.filter((id) => !known.some((p) => String(p.id) === id))
if (missing.length) console.log(`known ids NOT on store (already deleted?): ${missing.join(', ')}`)

// Orphans: local rows pointing at a shopify_id that no longer exists on the
// store (residue from earlier cleanup rounds). Distinct from "test-named" rows.
const storeIds = new Set(found.map((p) => String(p.id)))
const orphans = all.filter((r) => r.shopifyId && /^[0-9]+$/.test(String(r.shopifyId)) && !storeIds.has(String(r.shopifyId)))
console.log(`\nLOCAL orphan rows (shopify_id not on store): ${orphans.length}`)
for (const r of orphans) {
  console.log(`  id=${r.id} sku=${JSON.stringify(r.sku)} name=${JSON.stringify(r.name)} shopify_id=${r.shopifyId}`)
}

const unlinked = all.filter((r) => !r.shopifyId || !/^[0-9]+$/.test(String(r.shopifyId)))
console.log(`\nLOCAL unlinked rows (no shopify_id): ${unlinked.length}`)
for (const r of unlinked) {
  console.log(`  id=${r.id} sku=${JSON.stringify(r.sku)} name=${JSON.stringify(r.name)} collection=${JSON.stringify(r.collection)}`)
}

// Rows in dependent tables that reference the test product ids.
const testProductIds = testish.map((r) => r.id)
if (testProductIds.length) {
  const s = schema as Record<string, { name: string } | undefined>
  const { inArray } = await import('drizzle-orm')
  for (const key of ['stockLevels', 'stockMovements', 'stockTransfers'] as const) {
    const table = s[key]
    if (!table) continue
    try {
      const rows = await db
        .select()
        .from(s[key] as never)
        .where(inArray((s[key] as { productId: never }).productId, testProductIds as never))
      console.log(`\n${table.name} rows referencing test products: ${rows.length}`)
      for (const r of rows as unknown[]) console.log(`  ${JSON.stringify(r)}`)
    } catch (err) {
      console.log(`\n${table.name}: scan failed — ${(err as Error).message.slice(0, 120)}`)
    }
  }
}

// Orders / invoices / quotations whose customer or tags mention test data.
for (const [key, col] of [
  ['salesOrders', 'customer'],
  ['salesInvoices', 'customer'],
  ['quotations', 'customer'],
] as const) {
  const table = (schema as Record<string, unknown>)[key] as { name: string } | undefined
  if (!table) continue
  try {
    const { like, or } = await import('drizzle-orm')
    const c = (schema as Record<string, Record<string, never>>)[key]![col]
    const rows = await db.select().from((schema as Record<string, never>)[key]!).where(
      or(like(c, '%test%'), like(c, '%e2e%'), like(c, '%E2E%')),
    )
    console.log(`\n${table.name} rows with test-ish ${col}: ${rows.length}`)
    for (const r of rows as unknown[]) console.log(`  ${JSON.stringify(r).slice(0, 300)}`)
  } catch (err) {
    console.log(`\n${table.name}: scan failed — ${(err as Error).message.slice(0, 120)}`)
  }
}

await getRawClient()?.end({ timeout: 3 }).catch(() => undefined)
process.exitCode = 0
const safety = setTimeout(() => process.exit(0), 10_000)
safety.unref()
