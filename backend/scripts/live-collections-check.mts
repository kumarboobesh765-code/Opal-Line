// Live round-trip check: products ↔ Shopify collections, against the REAL
// store, using the installed desktop app's database and credentials.
//
//   PUSH   — syncLocalCollectionMembership() must make the product a member of
//            its local collection on Shopify (the gap this fixes: no collect
//            was ever created before).
//   PULL   — syncProductsToDb() must land real Shopify membership titles in
//            the billing database's collection column.
//   CHANGE — moving the product to another collection (previous-tag
//            semantics) drops the old membership; restoring brings it back.
//
// Credentials come from the installed app (no secrets in this file):
//   %APPDATA%\Opal Line Billing\data\.encryption-key  → ENCRYPTION_KEY
//   %APPDATA%\Opal Line Billing\.pg-password          → DATABASE_URL
//   settings table (encrypted)                        → SHOPIFY_*
// Falls back to whatever SHOPIFY_*/DATABASE_URL are already in the environment.
//
// Usage: cd backend && npx tsx scripts/live-collections-check.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'

function readTrim(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
  } catch {
    return null
  }
}

const appDir = join(process.env.APPDATA ?? '', 'Opal Line Billing')
const dataDir = join(appDir, 'data')

// ── bootstrap env BEFORE anything from src/ is imported (config caches env) ─
const key = readTrim(join(dataDir, '.encryption-key'))
if (key && !process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = key

const pgPassword = readTrim(join(appDir, '.pg-password'))?.replace(/\r?\n/g, '') ?? ''
if (pgPassword && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `postgres://postgres:${pgPassword}@127.0.0.1:47193/opal_line`
}

const { decrypt, decryptSecret } = await import('../src/lib/crypto')
const { db, schema } = await import('../src/db/client')

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
const shopify = await import('../src/shopify')

if (!isConfigured()) {
  console.error('SKIP: no Shopify credentials available (installed app files or env).')
  process.exit(2)
}

// ── tiny assertion harness ────────────────────────────────────────────────
let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── raw Shopify REST helpers (independent of the code under test) ─────────
// The store enforces 2 calls/second — honour Retry-After instead of failing
// an assertion on the first throttle.
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
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

interface CollectRow {
  id: number
  product_id: number
  collection_id: number
}
interface CollectionRow {
  id: number
  title: string
}

async function membershipsOf(productId: number): Promise<{ collectIds: number[]; titles: string[] }> {
  const [collects, custom, smart] = await Promise.all([
    rest<{ collects?: CollectRow[] }>('collects.json', `product_id=${productId}&limit=250`),
    rest<{ custom_collections?: CollectionRow[] }>('custom_collections.json', 'limit=250'),
    rest<{ smart_collections?: CollectionRow[] }>('smart_collections.json', 'limit=250'),
  ])
  const titleById = new Map<number, string>()
  for (const c of [...(custom.custom_collections ?? []), ...(smart.smart_collections ?? [])]) {
    titleById.set(c.id, c.title)
  }
  const rows = collects.collects ?? []
  return {
    collectIds: rows.map((r) => r.id),
    titles: rows.map((r) => titleById.get(r.collection_id) ?? `#${r.collection_id}`),
  }
}

async function customCollectionTitles(): Promise<string[]> {
  const custom = await rest<{ custom_collections?: CollectionRow[] }>('custom_collections.json', 'limit=250')
  return (custom.custom_collections ?? []).map((c) => c.title)
}

interface ProductRow {
  id: string
  sku: string
  name: string
  collection: string | null
  shopifyId: string | null
}

async function dbProduct(id: string): Promise<{ collection: string | null }> {
  const [row] = await db
    .select({ collection: schema.products.collection })
    .from(schema.products)
    .where(eq(schema.products.id, id))
  return { collection: row?.collection ?? null }
}

console.log(`\nStore: ${config.shop}.myshopify.com · API ${config.apiVersion}`)
console.log('─'.repeat(70))

// ── choose a real, linked product with a local collection ─────────────────
const all = await db
  .select({
    id: schema.products.id,
    sku: schema.products.sku,
    name: schema.products.name,
    collection: schema.products.collection,
    shopifyId: schema.products.shopifyId,
  })
  .from(schema.products)
const linked = all.filter(
  (r): r is ProductRow =>
    Boolean(r.collection && r.collection.trim()) &&
    Boolean(r.shopifyId) &&
    /^[0-9]+$/.test(String(r.shopifyId)),
)
if (linked.length === 0) {
  console.error('SKIP: no linked product with a local collection in the billing database.')
  process.exit(2)
}
const product = linked[0]
const productId = Number(product.shopifyId)
const localTitles = shopify.collectionSegments(product.collection)
console.log(
  `Product: ${product.sku} — "${product.name}" (id ${productId})\nLocal collection field: "${product.collection}" (${localTitles.length} title(s))\n`,
)

// ── Phase 1: baseline ─────────────────────────────────────────────────────
console.log('Phase 1 — baseline (raw Shopify REST)')
const before = await membershipsOf(productId)
const existingCollections = await customCollectionTitles()
console.log(`  Store collections: ${existingCollections.length ? existingCollections.join(', ') : '(none)'}`)
console.log(`  Product memberships: ${before.titles.length ? before.titles.join(', ') : '(none)'}`)
const alreadyMember = localTitles.every((t) =>
  before.titles.some((x) => x.toLowerCase() === t.toLowerCase()),
)
console.log(
  alreadyMember
    ? '  → product already in its local collection(s)'
    : '  → product is NOT in its local collection (the reported gap)',
)

// ── Phase 2: PUSH membership with the new code ────────────────────────────
console.log('\nPhase 2 — PUSH: syncLocalCollectionMembership() against the real store')
const pushOutcome = await shopify.syncLocalCollectionMembership(productId, product.collection, null)
console.log(`  outcome: ${JSON.stringify(pushOutcome)}`)
check('push: no per-title errors', pushOutcome.errors.length === 0, pushOutcome.errors.join('; '))
const afterPush = await membershipsOf(productId)
for (const title of localTitles) {
  check(
    `push: product is now in "${title}"`,
    afterPush.titles.some((x) => x.toLowerCase() === title.toLowerCase()),
    `memberships: ${afterPush.titles.join(', ') || '(none)'}`,
  )
}

// ── Phase 3: PULL into the billing database ───────────────────────────────
console.log('\nPhase 3 — PULL: syncProductsToDb() into the billing database')
const dbBefore = await dbProduct(product.id)
const pull = await shopify.syncProductsToDb()
console.log(
  `  sync result: ok=${pull.ok} created=${pull.created} updated=${pull.updated} removed=${pull.removed} errors=${pull.errors.join('; ') || '-'}`,
)
check('pull: syncProductsToDb succeeded', pull.ok, pull.errors.join('; '))
const dbAfter = await dbProduct(product.id)
const pulledTitles = shopify
  .collectionSegments(dbAfter.collection)
  .filter((t) => afterPush.titles.some((x) => x.toLowerCase() === t.toLowerCase()))
console.log(`  billing DB collection: "${dbBefore.collection}" → "${dbAfter.collection}"`)
check(
  'pull: billing DB collection reflects real Shopify memberships',
  pulledTitles.length > 0,
  `membership-sourced titles in DB: ${pulledTitles.join(', ') || '(none)'}`,
)

// ── Phase 4: change → pull → restore → pull ───────────────────────────────
console.log('\nPhase 4 — CHANGE: move to another collection and back (previous-tag semantics)')
const otherTitle = (await customCollectionTitles()).find(
  (t) => !localTitles.some((l) => l.toLowerCase() === t.toLowerCase()),
)
if (otherTitle) {
  console.log(`  temporary collection: "${otherTitle}"`)
  const move = await shopify.syncLocalCollectionMembership(productId, otherTitle, product.collection)
  console.log(`  move outcome: ${JSON.stringify(move)}`)
  check('change: no errors', move.errors.length === 0, move.errors.join('; '))
  const moved = await membershipsOf(productId)
  check(
    `change: now in "${otherTitle}", local collection(s) dropped`,
    moved.titles.some((x) => x.toLowerCase() === otherTitle.toLowerCase()) &&
      !localTitles.some((l) => moved.titles.some((x) => x.toLowerCase() === l.toLowerCase())),
    `memberships: ${moved.titles.join(', ') || '(none)'}`,
  )
  const pullMoved = await shopify.syncProductsToDb()
  check('change: pull after move succeeded', pullMoved.ok, pullMoved.errors.join('; '))
  const dbMoved = await dbProduct(product.id)
  console.log(`  billing DB collection after move: "${dbMoved.collection}"`)

  const restore = await shopify.syncLocalCollectionMembership(productId, product.collection, otherTitle)
  console.log(`  restore outcome: ${JSON.stringify(restore)}`)
  check('restore: no errors', restore.errors.length === 0, restore.errors.join('; '))
  const restored = await membershipsOf(productId)
  check(
    'restore: back to the local collection only',
    localTitles.every((t) => restored.titles.some((x) => x.toLowerCase() === t.toLowerCase())) &&
      !restored.titles.some((x) => x.toLowerCase() === otherTitle.toLowerCase()),
    `memberships: ${restored.titles.join(', ') || '(none)'}`,
  )
} else {
  console.log('  (store has no second custom collection — move test skipped; add/remove still covered by unit tests)')
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('─'.repeat(70))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
