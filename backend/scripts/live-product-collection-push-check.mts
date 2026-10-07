// Live round-trip check: PRODUCT PUSH ↔ Shopify collection membership, against
// the REAL store, using the installed desktop app's database and credentials.
//
// This is the separate "products collection sync" path (the one a user hits
// from the app), as opposed to live-collections-check.mts which calls
// syncLocalCollectionMembership() directly:
//
//   CREATE — pushProductsToShopify([id]) on a brand-new local product must
//            create the listing AND make it a member of its local collection
//            (createShopifyProduct → pushCollectionMembership).
//   PULL   — syncProductsToDb() must land the membership title in the billing
//            database's collection column.
//   MOVE   — changing the local collection and re-pushing (the update path:
//            updateShopifyProductContent with previousCollection read from the
//            opal-collection: tag) must move membership: new collect added,
//            the one the app created earlier removed.
//   LOGS   — every push that changes membership writes a 'Collection Sync'
//            success row into sync_logs.
//
// Everything this creates (local row, Shopify listing, temp collections,
// sync_log rows) is deleted again in the cleanup phase, and cleanup verifies
// the store has no residue.
//
// Credentials come from the installed app (no secrets in this file):
//   %APPDATA%\Opal Line Billing\data\.encryption-key  → ENCRYPTION_KEY
//   %APPDATA%\Opal Line Billing\.pg-password          → DATABASE_URL
//   settings table (encrypted)                        → SHOPIFY_*
// Falls back to whatever SHOPIFY_*/DATABASE_URL are already in the environment.
//
// Usage: cd backend && npx tsx scripts/live-product-collection-push-check.mts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'

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
// The store enforces 2 calls/second; bursts from this script (parallel
// membership reads, cleanup retry loops) trip 429 on a fast runner. Honour
// Retry-After instead of failing the assertion on the first throttle.
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

// Shopify can take a few seconds to reflect a product write on read-back
// (observed in CI: a 200 PUT's tags still read stale >3s later while collect
// membership had already moved). Poll briefly instead of asserting a single
// sample — a state that never converges still fails after the deadline.
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const start = Date.now()
  let last = await fn()
  while (!ok(last) && Date.now() - start < ms) {
    await sleep(1000)
    last = await fn()
  }
  return last
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

async function restDelete(path: string): Promise<number> {
  const url = new URL(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/${path}`)
  const res = await fetchWithBackoff(url, {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
  })
  return res.status
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

async function membershipsOf(productId: number): Promise<string[]> {
  const [collects, custom, smart] = await Promise.all([
    rest<{ collects?: CollectRow[] }>('collects.json', `product_id=${productId}&limit=250`),
    rest<{ custom_collections?: CollectionRow[] }>('custom_collections.json', 'limit=250'),
    rest<{ smart_collections?: CollectionRow[] }>('smart_collections.json', 'limit=250'),
  ])
  const titleById = new Map<number, string>()
  for (const c of [...(custom.custom_collections ?? []), ...(smart.smart_collections ?? [])]) {
    titleById.set(c.id, c.title)
  }
  return (collects.collects ?? []).map((r) => titleById.get(r.collection_id) ?? `#${r.collection_id}`)
}

async function customCollections(): Promise<CollectionRow[]> {
  const json = await rest<{ custom_collections?: CollectionRow[] }>('custom_collections.json', 'limit=250')
  return json.custom_collections ?? []
}

async function listProductsById(productId: number): Promise<unknown[]> {
  const json = await rest<{ products?: unknown[] }>('products.json', `ids=${productId}`)
  return json.products ?? []
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

interface LocalRow {
  id: string
  sku: string
  collection: string | null
  shopifyId: string | null
  shopifyStatus: string | null
}

async function localRow(id: string): Promise<LocalRow | undefined> {
  const [row] = await db
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      collection: schema.products.collection,
      shopifyId: schema.products.shopifyId,
      shopifyStatus: schema.products.shopifyStatus,
    })
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1)
  return row
}

// ── test data ─────────────────────────────────────────────────────────────
const stamp = Date.now()
const localId = `livecol-${stamp}`
const sku = `LIVECOL-${stamp}`
const testName = 'Live Collection Push Test'

console.log(`\nStore: ${config.shop}.myshopify.com · API ${config.apiVersion}`)
console.log('─'.repeat(70))

// Track everything to clean up, no matter which phase fails.
const tempCollections: number[] = []
let createdShopifyId: number | null = null
let baselineCustomTitles: string[] = []

async function cleanup(): Promise<void> {
  console.log('\nCleanup — removing every trace of this test')
  // 1. The Shopify listing (its collects die with it).
  try {
    const row = await localRow(localId)
    const id = createdShopifyId ?? Number(String(row?.shopifyId ?? '').replace(/^#/, ''))
    if (id) {
      const status = await restDelete(`products/${id}.json`)
      check('cleanup: Shopify listing deleted', status === 200 || status === 404, `HTTP ${status}`)
      // Collects must be gone too (retry once — deletion can lag).
      let titles: string[] = []
      for (let i = 0; i < 4; i++) {
        titles = await membershipsOf(id)
        if (titles.length === 0) break
        await sleep(1500)
      }
      check('cleanup: no collect rows left for the product', titles.length === 0, titles.join(', ') || '(none)')
      const listed = await listProductsById(id)
      check('cleanup: product absent from store catalog', listed.length === 0, `${listed.length} left`)
    }
  } catch (err) {
    check('cleanup: Shopify listing deleted', false, err instanceof Error ? err.message : 'unknown error')
  }

  // 2. Temp custom collections this script created (never touch pre-existing ones).
  for (const id of tempCollections) {
    try {
      const status = await restDelete(`custom_collections/${id}.json`)
      check(`cleanup: temp collection #${id} deleted`, status === 200 || status === 404, `HTTP ${status}`)
    } catch (err) {
      check(`cleanup: temp collection #${id} deleted`, false, err instanceof Error ? err.message : 'unknown error')
    }
  }

  // 3. The local product row and its sync logs.
  try {
    await db.delete(schema.stockTransfers).where(sql`${schema.stockTransfers.sku} = ${sku}`)
    await db.delete(schema.products).where(eq(schema.products.id, localId))
    const gone = await localRow(localId)
    check('cleanup: local product row deleted', !gone)
    await db.delete(schema.syncLogs).where(eq(schema.syncLogs.shopifyId, sku))
    if (createdShopifyId) {
      await db.delete(schema.syncLogs).where(eq(schema.syncLogs.shopifyId, String(createdShopifyId)))
    }
    const leftover = await db
      .select()
      .from(schema.syncLogs)
      .where(eq(schema.syncLogs.shopifyId, sku))
    check('cleanup: test sync_log rows deleted', leftover.length === 0, `${leftover.length} left`)
  } catch (err) {
    check('cleanup: local product row deleted', false, err instanceof Error ? err.message : 'unknown error')
  }

  // 4. The store must look exactly like it did before the test.
  try {
    const now = (await customCollections()).map((c) => c.title).sort()
    const same =
      now.length === baselineCustomTitles.length &&
      now.every((t, i) => t === baselineCustomTitles[i])
    check(
      'cleanup: store custom collections back to baseline',
      same,
      same ? `${now.length} collections` : `baseline [${baselineCustomTitles.join(', ')}] → now [${now.join(', ')}]`,
    )
  } catch (err) {
    check('cleanup: store custom collections back to baseline', false, err instanceof Error ? err.message : 'unknown error')
  }
}

// ── phases ────────────────────────────────────────────────────────────────
try {
  // Phase 0 — pick two custom collection titles (create temp ones if the store
  // has too few; temp ones are removed in cleanup).
  console.log('Phase 0 — collection setup')
  const existing = await customCollections()
  baselineCustomTitles = existing.map((c) => c.title).sort()
  console.log(`  store custom collections: ${baselineCustomTitles.join(', ') || '(none)'}`)

  let titleA = existing[0]?.title ?? ''
  let titleB = existing[1]?.title ?? ''
  if (!titleA) {
    titleA = `E2E Temp A ${stamp}`
    const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/custom_collections.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': config.accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ custom_collection: { title: titleA } }),
    })
    const json = (await res.json()) as { custom_collection?: { id?: number } }
    if (json.custom_collection?.id) tempCollections.push(json.custom_collection.id)
  }
  if (!titleB) {
    titleB = `E2E Temp B ${stamp}`
    const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/custom_collections.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': config.accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ custom_collection: { title: titleB } }),
    })
    const json = (await res.json()) as { custom_collection?: { id?: number } }
    if (json.custom_collection?.id) tempCollections.push(json.custom_collection.id)
  }
  titleB = titleB === titleA ? `${titleB} B` : titleB
  console.log(`  A (create): "${titleA}"\n  B (move to): "${titleB}"`)

  // Seed the local row — a brand-new product the store has never seen.
  await db.insert(schema.products).values({
    id: localId,
    name: testName,
    sku,
    category: 'Rings',
    collection: titleA,
    status: 'active',
    sellingPrice: 199,
    stock: 0,
    purity: 92.5,
    trackInventory: false,
    chargeOnTax: true,
    shopifyStatus: 'pending',
    description: 'Temporary product created by live-product-collection-push-check',
    createdAt: new Date().toISOString().slice(0, 10),
  })
  console.log(`  seeded local product ${sku} (collection "${titleA}")`)

  // Phase 1 — CREATE push: new listing + membership in one shot.
  console.log('\nPhase 1 — CREATE: pushProductsToShopify() on a new local product')
  const push1 = await shopify.pushProductsToShopify([localId])
  console.log(`  outcome: ${JSON.stringify(push1)}`)
  check('create: push ok', push1.ok, push1.errors.join('; '))
  check('create: exactly one listing created', push1.created === 1, `created=${push1.created} skipped=${push1.skipped}`)

  const afterCreate = await localRow(localId)
  const numericId = Number(String(afterCreate?.shopifyId ?? '').replace(/^#/, ''))
  check('create: local row linked to a numeric Shopify id', Number.isFinite(numericId) && numericId > 0, afterCreate?.shopifyId ?? '(null)')
  check('create: local row marked synced', afterCreate?.shopifyStatus === 'synced', afterCreate?.shopifyStatus ?? '(null)')
  createdShopifyId = numericId || null

  if (numericId) {
    // Read-back of a fresh write can lag (see until() above) — poll briefly.
    const listing = await until(
      () => rest<{ product?: { tags?: string; product_type?: string } }>(`products/${numericId}.json`),
      (j) => String(j.product?.tags ?? '').split(',').some((t) => t.trim() === `opal-collection:${titleA}`),
    )
    const tags = String(listing.product?.tags ?? '')
    check(`create: listing carries opal-collection tag`, tags.split(',').some((t) => t.trim() === `opal-collection:${titleA}`), tags)
    const titles = await until(
      () => membershipsOf(numericId),
      (list) => list.some((t) => t.toLowerCase() === titleA.toLowerCase()),
      10000,
    )
    check(`create: product is member of "${titleA}"`, titles.some((t) => t.toLowerCase() === titleA.toLowerCase()), titles.join(', ') || '(none)')

    const syncLogs = await db.select().from(schema.syncLogs).where(eq(schema.syncLogs.shopifyId, sku))
    const collLogs = syncLogs.filter((l) => l.action === 'Collection Sync' && l.status === 'success')
    check('create: sync_logs has a Collection Sync success row', collLogs.length >= 1, `${syncLogs.length} log row(s) for sku`)
  }

  // Phase 2 — PULL into the billing database.
  if (numericId) {
    console.log('\nPhase 2 — PULL: syncProductsToDb() into the billing database')
    const pull = await shopify.syncProductsToDb()
    console.log(`  sync result: ok=${pull.ok} created=${pull.created} updated=${pull.updated} removed=${pull.removed} errors=${pull.errors.join('; ') || '-'}`)
    check('pull: syncProductsToDb succeeded', pull.ok, pull.errors.join('; '))
    const row = await localRow(localId)
    const segments = shopify.collectionSegments(row?.collection).map((s) => s.toLowerCase())
    check(`pull: billing DB collection reflects "${titleA}"`, segments.includes(titleA.toLowerCase()), `collection="${row?.collection}"`)
    check('pull: row still linked', Number(String(row?.shopifyId ?? '')) === numericId, row?.shopifyId ?? '(null)')
  }

  // Phase 3 — MOVE: change the local collection, push the update path.
  if (numericId) {
    console.log(`\nPhase 3 — MOVE: "${titleA}" → "${titleB}" through the update push path`)
    await db.update(schema.products).set({ collection: titleB }).where(eq(schema.products.id, localId))
    const push2 = await shopify.pushProductsToShopify([localId])
    console.log(`  outcome: ${JSON.stringify(push2)}`)
    check('move: push ok', push2.ok, push2.errors.join('; '))
    check('move: one listing updated (not recreated)', push2.updated === 1 && push2.created === 0, `created=${push2.created} updated=${push2.updated}`)

    const listing = await until(
      () => rest<{ product?: { tags?: string } }>(`products/${numericId}.json`),
      (j) => String(j.product?.tags ?? '').split(',').some((t) => t.trim() === `opal-collection:${titleB}`),
    )
    const tags = String(listing.product?.tags ?? '')
    check(`move: tag now opal-collection:${titleB}`, tags.split(',').some((t) => t.trim() === `opal-collection:${titleB}`), tags)
    const titles = await until(
      () => membershipsOf(numericId),
      (list) =>
        list.some((t) => t.toLowerCase() === titleB.toLowerCase()) &&
        !list.some((t) => t.toLowerCase() === titleA.toLowerCase()),
      10000,
    )
    check(`move: member of "${titleB}"`, titles.some((t) => t.toLowerCase() === titleB.toLowerCase()), titles.join(', ') || '(none)')
    check(
      `move: old membership "${titleA}" dropped`,
      !titles.some((t) => t.toLowerCase() === titleA.toLowerCase()),
      titles.join(', ') || '(none)',
    )

    // The pull mirrors whatever the storefront currently reports; while tags
    // are still catching up, re-pull until the membership view converges or
    // the deadline passes (a state that never converges still fails below).
    let pull2 = await shopify.syncProductsToDb()
    let row = await localRow(localId)
    const moveDeadline = Date.now() + 25000
    for (;;) {
      const seg = shopify.collectionSegments(row?.collection).map((s) => s.toLowerCase())
      if ((seg.includes(titleB.toLowerCase()) && !seg.includes(titleA.toLowerCase())) || Date.now() >= moveDeadline) break
      await sleep(3000)
      pull2 = await shopify.syncProductsToDb()
      row = await localRow(localId)
    }
    check('move: pull after move succeeded', pull2.ok, pull2.errors.join('; '))
    const segments = shopify.collectionSegments(row?.collection).map((s) => s.toLowerCase())
    check(`move: billing DB collection now "${titleB}"`, segments.includes(titleB.toLowerCase()) && !segments.includes(titleA.toLowerCase()), `collection="${row?.collection}"`)

    const syncLogs = await db.select().from(schema.syncLogs).where(eq(schema.syncLogs.shopifyId, sku))
    const collLogs = syncLogs.filter((l) => l.action === 'Collection Sync' && l.status === 'success')
    check('move: cumulative Collection Sync success rows ≥ 2', collLogs.length >= 2, `${collLogs.length} rows`)
  }
} catch (err) {
  failed++
  console.error(`  ✘ unexpected error — ${err instanceof Error ? (err.stack ?? err.message) : 'unknown'}`)
} finally {
  await cleanup()
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('─'.repeat(70))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
// Close the pool and let the process exit naturally: force-exiting while a
// handle is mid-close trips a libuv teardown assertion on Windows
// ("handle->flags & UV_HANDLE_CLOSING") and turns a green run into exit 127.
await getRawClient()?.end({ timeout: 3 }).catch(() => undefined)
const exitCode = failed === 0 ? 0 : 1
process.exitCode = exitCode
// Safety net: if some handle never closes, force the exit anyway.
const safety = setTimeout(() => process.exit(exitCode), 10_000)
safety.unref()
