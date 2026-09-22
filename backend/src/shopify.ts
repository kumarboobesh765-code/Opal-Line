import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { config, isConfigured, normalizeShopDomain } from './config'
import { db, schema } from './db/client'
import type { SyncCustomer, SyncLogEntry, SyncOrder, SyncPrice, SyncProduct, SyncResource, SyncStore } from './types'
import { CONSTANTS } from './constants'
import { logger } from './logger'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const MAX_STORE_ITEMS = 10000

export const store: SyncStore = {
  products: [],
  orders: [],
  customers: [],
  inventory: [],
  price: [],
  lastSync: {},
  syncing: false,
  logs: [],
}

let syncPromise: Promise<unknown> | null = null
let syncLockAcquired = false

async function acquireSyncLock(label: string): Promise<boolean> {
  if (syncLockAcquired || syncPromise) return false
  syncLockAcquired = true
  syncPromise = Promise.resolve()
  store.syncing = true
  return true
}

function releaseSyncLock() {
  syncPromise = null
  syncLockAcquired = false
  store.syncing = false
}

let logSeq = 0

function addLog(resource: SyncResource, status: SyncLogEntry['status'], count: number, message?: string) {
  store.logs.unshift({
    id: `LOG-${++logSeq}`,
    resource,
    status,
    count,
    time: new Date().toISOString(),
    message,
  })
  store.logs = store.logs.slice(0, CONSTANTS.LOG_MAX_ENTRIES)
}

let dbLogSeq = 0

async function persistLog(entry: {
  entity: string
  shopifyId?: string | null
  direction: 'in' | 'out'
  action: string
  status: 'success' | 'failed'
  error?: string
  retry?: boolean
}) {
  if (!db) return
  try {
    await db.insert(schema.syncLogs).values({
      id: `LOG-${Date.now()}-${++dbLogSeq}`,
      entity: entry.entity,
      shopifyId: entry.shopifyId ?? null,
      direction: entry.direction,
      action: entry.action,
      status: entry.status,
      time: new Date().toISOString(),
      error: entry.error ?? null,
      retry: entry.retry ?? false,
    })
  } catch {
    // Log persistence must never break a sync.
  }
}

const entityFor: Record<SyncResource, { entity: string; action: string }> = {
  orders: { entity: 'Order', action: 'Imported' },
  products: { entity: 'Product', action: 'Imported' },
  customers: { entity: 'Customer', action: 'Imported' },
  inventory: { entity: 'Inventory', action: 'Stock Update' },
  price: { entity: 'Price', action: 'Price Sync' },
}

class ShopifyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

function apiPath(version: string, resource: string) {
  return `https://${config.shop}.myshopify.com/admin/api/${version}/${resource}.json`
}

interface ShopifyResponse<T> {
  json: T
  nextPageToken: string | null
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function shopifyRequest<T>(resource: string, query = '', attempt = 0): Promise<ShopifyResponse<T>> {
  if (!isConfigured()) {
    throw new ShopifyError('Shopify is not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in server/.env', 503)
  }
  const url = new URL(apiPath(config.apiVersion, resource))
  const params = new URLSearchParams(query)
  params.set('limit', String(CONSTANTS.SHOPIFY_API_LIMIT))
  url.search = params.toString()

  const maxRetries = CONSTANTS.SHOPIFY_MAX_RETRIES
  const baseDelay = CONSTANTS.SHOPIFY_BASE_RETRY_DELAY_MS

  for (let tryNum = 0; tryNum <= maxRetries; tryNum++) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })

    if (res.status === 401) {
      throw new ShopifyError('Shopify rejected the access token. Check SHOPIFY_ACCESS_TOKEN and app scopes.', 401)
    }
    if (res.status === 403) {
      throw new ShopifyError('The access token is missing required scopes (read_orders, read_products, read_inventory, read_customers).', 403)
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After')
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelay * Math.pow(2, tryNum)
      if (tryNum < maxRetries) {
        await sleep(delay)
        continue
      }
      throw new ShopifyError('Shopify rate limit exceeded. Please try again later.', 429)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status >= 500 && tryNum < maxRetries) {
        await sleep(baseDelay * Math.pow(2, tryNum))
        continue
      }
      throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
    }

    let nextPageToken: string | null = null
    const link = res.headers.get('link')
    if (link) {
      const match = link.match(/page_info=([^>]+)>;\s*rel="next"/)
      if (match) nextPageToken = match[1]
    }

    return { json: (await res.json()) as T, nextPageToken }
  }

  throw new ShopifyError('Max retries exceeded for Shopify API', 503)
}

export async function testShopifyConnection(overrides?: {
  shop?: string
  accessToken?: string
}): Promise<{ ok: boolean; error?: string; shop?: string }> {
  const shop = overrides?.shop?.trim() ? normalizeShopDomain(overrides.shop) : config.shop
  const accessToken = overrides?.accessToken?.trim() ? overrides.accessToken.trim() : config.accessToken
  if (!shop || !accessToken) {
    return { ok: false, error: 'Shopify is not configured. Enter the store URL and access token, then click Save.' }
  }
  if (/[^\x00-\xFF]/.test(accessToken) || /[^\x00-\xFF]/.test(shop)) {
    return { ok: false, error: 'The saved Shopify credentials contain invalid characters — a masked or corrupted value was saved. Re-enter the store URL and access token, then click Save.' }
  }
  try {
    const start = Date.now()
    const url = `https://${shop}.myshopify.com/admin/api/${config.apiVersion}/shop.json`
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    })
    if (res.status === 401) {
      return { ok: false, error: 'Shopify rejected the access token. Double-check the token value.' }
    }
    if (res.status === 403) {
      return { ok: false, error: 'Access token is missing the required Shopify scopes (read_products, read_orders, read_customers, read_inventory).' }
    }
    if (!res.ok) {
      return { ok: false, error: `Shopify API error ${res.status}: ${(await res.text()).slice(0, 200)}` }
    }
    const data = await res.json()
    logger.info({ ms: Date.now() - start }, 'Shopify connection verified')
    return { ok: true, shop: data.shop?.myshopify_domain ?? `${shop}.myshopify.com` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Shopify error'
    return { ok: false, error: message }
  }
}

async function paginate<T>(resource: string, initialQuery = '', maxPages = CONSTANTS.SHOPIFY_MAX_PAGES): Promise<T[]> {
  const out: T[] = []
  let query = initialQuery
  for (let page = 0; page < maxPages; page++) {
    const res = await shopifyRequest<Record<string, T[]>>(resource, query)
    out.push(...(res.json[resource] ?? []))
    if (!res.nextPageToken) break
    query = `page_info=${encodeURIComponent(res.nextPageToken)}`
  }
  return out
}

export function normalizeProduct(raw: any): SyncProduct {
  const variant = raw.variants?.[0] ?? {}
  const rawTags = typeof raw.tags === 'string' ? raw.tags : Array.isArray(raw.tags) ? raw.tags.join(',') : ''
  const tagList = rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
  const collectionTag = tagList.find((t: string) => t.startsWith('opal-collection:'))
  const collection = collectionTag
    ? collectionTag.replace('opal-collection:', '').trim()
    : (raw.product_type ?? '').trim()
  const chargeOnTaxTag = tagList.find((t: string) => t.startsWith('opal-chargeontax:'))
  const chargeOnTax = chargeOnTaxTag ? chargeOnTaxTag.replace('opal-chargeontax:', '').trim() !== 'false' : true
  return {
    id: raw.id,
    gid: raw.admin_graphql_api_id ?? '',
    title: raw.title ?? '',
    handle: raw.handle ?? '',
    vendor: raw.vendor ?? '',
    productType: raw.product_type ?? '',
    collection,
    chargeOnTax,
    status: raw.status ?? '',
    sku: variant.sku ?? '',
    barcode: variant.barcode ?? null,
    price: variant.price ?? '0',
    compareAtPrice: variant.compare_at_price ?? null,
    image: raw.images?.[0]?.src ?? null,
    images: Array.isArray(raw.images)
      ? raw.images.map((img: { src?: string }) => String(img?.src ?? '')).filter(Boolean)
      : [],
    inventoryQuantity: variant.inventory_quantity ?? 0,
    inventoryItemId: variant.inventory_item_id ?? 0,
    variantId: variant.id ?? 0,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
  }
}

export function normalizeOrder(raw: any): SyncOrder {
  return {
    id: raw.id,
    name: raw.name ?? '',
    orderNumber: raw.order_number ?? 0,
    createdAt: raw.created_at ?? '',
    financialStatus: raw.financial_status ?? 'pending',
    fulfillmentStatus: raw.fulfillment_status ?? null,
    customerName: raw.customer ? `${raw.customer.first_name ?? ''} ${raw.customer.last_name ?? ''}`.trim() : 'Guest',
    email: raw.customer?.email ?? null,
    totalPrice: raw.total_price ?? '0',
    currency: raw.currency ?? 'INR',
    lineItems: raw.line_items?.length ?? 0,
  }
}

export function normalizeCustomer(raw: any): SyncCustomer {
  return {
    id: raw.id,
    email: raw.email ?? null,
    firstName: raw.first_name ?? '',
    lastName: raw.last_name ?? '',
    phone: raw.phone ?? null,
    city: raw.default_address?.city ?? null,
    province: raw.default_address?.province ?? null,
    ordersCount: raw.orders_count ?? 0,
    totalSpent: raw.total_spent ?? '0',
    createdAt: raw.created_at ?? '',
  }
}

async function fetchLocations(): Promise<{ id: number; name: string }[]> {
  const res = await shopifyRequest<{ locations: any[] }>('locations')
  return res.json.locations.map((l) => ({ id: l.id, name: l.name }))
}

async function fetchInventoryLevels(): Promise<any[]> {
  const locations = await fetchLocations()
  if (locations.length === 0) return []
  return paginate<any>('inventory_levels', `location_ids=${locations.map((l) => l.id).join(',')}`)
}

async function attachInventoryToProducts() {
  if (store.products.length === 0) return
  const skuByItem = new Map<number, { sku: string; title: string }>()
  for (const p of store.products) {
    if (p.inventoryItemId) skuByItem.set(p.inventoryItemId, { sku: p.sku, title: p.title })
  }
  const availableByItem = new Map<number, number>()
  const levels = await fetchInventoryLevels()
  for (const raw of levels) {
    const id = raw.inventory_item_id
    availableByItem.set(id, (availableByItem.get(id) ?? 0) + (raw.available ?? 0))
  }
  store.products = store.products.map((p) => ({
    ...p,
    inventoryQuantity: availableByItem.get(p.inventoryItemId) ?? 0,
  }))
  const nameById = new Map((await fetchLocations()).map((l) => [l.id, l.name]))
  store.inventory = levels.map((raw: any) => ({
    inventoryItemId: raw.inventory_item_id,
    locationId: raw.location_id,
    locationName: nameById.get(raw.location_id) ?? `Location #${raw.location_id}`,
    available: raw.available ?? 0,
    sku: skuByItem.get(raw.inventory_item_id)?.sku ?? '',
    title: skuByItem.get(raw.inventory_item_id)?.title ?? '',
  }))
}

async function syncProducts(): Promise<number> {
  const raw = await paginate<any>('products', 'status=active')
  store.products = raw.map(normalizeProduct).slice(0, MAX_STORE_ITEMS)
  try {
    await attachInventoryToProducts()
  } catch {
    // Inventory is an enhancement; product catalog must never fail because of it.
  }
  return store.products.length
}

async function syncOrders(): Promise<number> {
  const raw = await paginate<any>('orders', 'status=any&fulfillment_status=any')
  store.orders = raw.map(normalizeOrder).slice(0, MAX_STORE_ITEMS)
  return store.orders.length
}

async function syncCustomers(): Promise<number> {
  const raw = await paginate<any>('customers', '')
  store.customers = raw.map(normalizeCustomer).slice(0, MAX_STORE_ITEMS)
  return store.customers.length
}

async function syncInventory(): Promise<number> {
  if (store.products.length === 0) {
    await syncProducts()
  } else {
    await attachInventoryToProducts()
  }
  return store.inventory.length
}

export interface ProductsDbSyncResult {
  ok: boolean
  synced: number
  created: number
  updated: number
  removed: number
  errors: string[]
  message?: string
}

function backComputePricing(price: number, rate: number): { netWeight: number; makingCharge: number } | null {
  if (!price || price <= 0 || !rate || rate <= 0) return null
  const netWeight = price / ((rate + CONSTANTS.DEFAULT_MAKING_CHARGE) * 1.03)
  if (!Number.isFinite(netWeight) || netWeight <= 0) return null
  return { netWeight, makingCharge: CONSTANTS.DEFAULT_MAKING_CHARGE }
}

// Pull the live Shopify catalog (status=active) into the local billing database,
// keyed by SKU. Existing SKU matches are updated (keeping their pricing data),
// and local products that no longer exist on Shopify are removed so the billing
// catalog only ever mirrors live products. Products that were never pushed to
// Shopify (no live id / pending / not-listed) are preserved locally.
/**
 * Combine local image list with Shopify's gallery for the same product.
 * Local uploads ("/uploads/...") that were pushed to Shopify appear in the
 * Shopify list too — de-duplicate by filename suffix. Local-only entries are
 * preserved so nothing is lost on sync.
 */
function mergeImages(local: string[] | null, shopify: string[]): string[] | null {
  const localList = (local ?? []).filter(Boolean)
  const remoteList = (shopify ?? []).filter(Boolean)
  if (remoteList.length === 0) return localList.length > 0 ? localList : null
  if (localList.length === 0) return remoteList
  const out = [...remoteList]
  for (const l of localList) {
    const fileName = l.split('/').pop()?.split('-').slice(-1)[0] ?? l
    // Keep local entries that are clearly not among the Shopify sources
    if (!remoteList.some((r) => r.includes(fileName) || fileName.length > 8 && r.endsWith(fileName))) {
      out.push(l)
    }
  }
  return out
}

export async function syncProductsToDb(): Promise<ProductsDbSyncResult> {
  if (!isConfigured()) {
    return { ok: false, synced: 0, created: 0, updated: 0, removed: 0, errors: ['Shopify is not configured. See server/.env'], message: 'Shopify is not configured' }
  }
  if (!db) {
    return { ok: false, synced: 0, created: 0, updated: 0, removed: 0, errors: ['Database is not configured'], message: 'Database is not configured' }
  }
  if (!(await acquireSyncLock('products'))) {
    return { ok: false, synced: 0, created: 0, updated: 0, removed: 0, errors: [], message: 'A sync is already in progress' }
  }

  try {
    await syncProducts()

    const live = store.products
    const liveSkus = new Set(live.map((p) => (String(p.sku ?? '').trim() || `SHOP-${p.id}`).toLowerCase()).filter(Boolean))

    const rows = await db.select().from(schema.products)
    const bySku = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const key = String(r.sku ?? '').trim().toLowerCase()
      if (key) bySku.set(key, r)
    }

    let created = 0
    let updated = 0
    const pricingRate = (await getLatestSilverRate())?.rate ?? 92.8
    for (const p of live) {
      const sku = String(p.sku ?? '').trim() || `SHOP-${p.id}`
      const skuKey = sku.toLowerCase()
      if (!skuKey) continue
      const price = Number(p.price ?? 0) || 0
      const compareAt = p.compareAtPrice != null ? Number(p.compareAtPrice) : null
      const effectiveCompareAt = compareAt != null && compareAt > 0 ? compareAt : null
      const existing = bySku.get(skuKey)
      if (existing) {
        const hasWeight = existing.netWeight != null && Number(existing.netWeight) > 0
        const pricing = hasWeight ? null : backComputePricing(price, pricingRate)
        await db
          .update(schema.products)
          .set({
            name: p.title || existing.name,
            barcode: p.barcode ?? existing.barcode,
            category: p.productType || existing.category,
            collection: p.collection || p.productType || existing.collection,
            stock: Number.isFinite(p.inventoryQuantity) ? p.inventoryQuantity : existing.stock,
            shopifyId: String(p.id),
            shopifyStatus: 'synced',
            status: 'active',
            vendor: p.vendor || existing.vendor,
            productType: p.productType || existing.productType,
            compareAtPrice: effectiveCompareAt ?? existing.compareAtPrice,
            image: p.image ?? existing.image,
            // Mirror Shopify's gallery; keep any local-only uploads that aren't
            // yet on Shopify (they'll be pushed on the next product push).
            images: mergeImages(existing.images as string[] | null, p.images),
            netWeight: pricing ? pricing.netWeight : existing.netWeight,
            makingCharge: pricing ? pricing.makingCharge : existing.makingCharge,
            silverRate: pricing ? pricingRate : existing.silverRate,
            // Preserve existing chargeOnTax value; do not overwrite from Shopify list endpoint
            chargeOnTax: existing.chargeOnTax,
          })
          .where(eq(schema.products.id, existing.id))
        updated++
      } else {
        const pricing = backComputePricing(price, pricingRate)
        await db.insert(schema.products).values({
          id: randomUUID(),
          name: p.title || sku,
          sku,
          barcode: p.barcode ?? null,
          category: p.productType || 'Uncategorized',
          collection: p.collection || p.productType || null,
          purity: 92.5,
          grossWeight: null,
          stoneWeight: null,
          netWeight: pricing ? pricing.netWeight : null,
          makingCharge: pricing ? pricing.makingCharge : null,
          gst: 3,
          hsn: null,
          supplier: null,
          silverRate: pricing ? pricingRate : null,
          sellingPrice: price,
          compareAtPrice: effectiveCompareAt,
          stock: Number.isFinite(p.inventoryQuantity) ? p.inventoryQuantity : 0,
          reorderLevel: null,
          shopifyStatus: 'synced',
          shopifyId: String(p.id),
          status: 'active',
          image: p.image ?? null,
          images: p.images.length > 0 ? p.images : null,
          vendor: p.vendor || null,
          productType: p.productType || null,
          tags: null,
          trackInventory: true,
          // Set chargeOnTax from the product data (first sync) or preserve existing
          chargeOnTax: p.chargeOnTax ?? true,
          createdAt: new Date().toISOString().slice(0, 10),
        })
        created++
      }
    }

    let removed = 0
    for (const r of rows) {
      const key = String(r.sku ?? '').trim().toLowerCase()
      if (liveSkus.has(key)) continue
      const shopifyId = String(r.shopifyId ?? '').trim()
      const shopifyStatus = String(r.shopifyStatus ?? '').trim().toLowerCase()
      const genuinelyLinked = shopifyId !== '' && !shopifyId.startsWith('#')
      const liveLinked = shopifyStatus === 'synced'
      if (!genuinelyLinked || !liveLinked) continue
      await db.delete(schema.stockTransfers).where(sql`${schema.stockTransfers.sku} = ${r.sku}`)
      await db.delete(schema.products).where(eq(schema.products.id, r.id))
      removed++
    }

    store.lastSync.products = new Date().toISOString()
    addLog('products', 'success', live.length, `Synced ${live.length} live products into the local catalog`)
    await persistLog({ entity: 'Product', direction: 'in', action: 'Import', status: 'success' })
    return { ok: true, synced: live.length, created, updated, removed, errors: [] }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    store.lastError = message
    await persistLog({ entity: 'Product', direction: 'in', action: 'Import', status: 'failed', error: message, retry: true })
    return { ok: false, synced: 0, created: 0, updated: 0, removed: 0, errors: [message], message }
  } finally {
    releaseSyncLock()
  }
}

interface LocalCatalogEntry {
  sku: string
  barcode: string
  title: string
  sellingPrice: number
}

async function getLocalCatalog(): Promise<LocalCatalogEntry[]> {
  if (!db) return []
  try {
    const rows = await db
      .select({
        sku: schema.products.sku,
        barcode: schema.products.barcode,
        title: schema.products.name,
        sellingPrice: schema.products.sellingPrice,
      })
      .from(schema.products)
    return rows.map((r) => ({
      sku: String(r.sku ?? '').trim(),
      barcode: String(r.barcode ?? '').trim().toLowerCase(),
      title: String(r.title ?? '').trim(),
      sellingPrice: Number(r.sellingPrice ?? 0),
    }))
  } catch {
    return []
  }
}

const STOP_WORDS = CONSTANTS.STOP_WORDS
const CATEGORY_WORDS = CONSTANTS.CATEGORY_WORDS

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// Collapse case/punctuation/spacing so "SLV-RNG-00021" == "slv rng 00021" == "slvrng00021"
function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Token-overlap score between two product titles. Rewarded for sharing
// meaningful (non-stop-word) tokens, with a small boost for category words.
function titleScore(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const sigA = ta.filter((w) => !STOP_WORDS.has(w))
  const sigB = tb.filter((w) => !STOP_WORDS.has(w))
  const sigBSet = new Set(sigB)
  const sharedSig = [...new Set(sigA)].filter((w) => sigBSet.has(w))
  if (sharedSig.length === 0) return 0
  const overlap = sharedSig.length / Math.max(sigA.length, sigB.length)
  const combined = new Set([...ta, ...tb])
  const coverage = combined.size > 0 ? sharedSig.length / combined.size : 0
  const categoryHits = sharedSig.filter((w) => CATEGORY_WORDS.has(w)).length
  return overlap * 0.7 + coverage * 0.2 + Math.min(categoryHits, 2) * 0.05
}

const TITLE_MATCH_THRESHOLD = CONSTANTS.TITLE_MATCH_THRESHOLD

function buildMatcher(catalog: LocalCatalogEntry[]) {
  const bySku = new Map<string, LocalCatalogEntry>()
  const bySkuCompact = new Map<string, LocalCatalogEntry>()
  const byBarcode = new Map<string, LocalCatalogEntry>()
  const byTitle = new Map<string, LocalCatalogEntry>()
  const fuzzyClaimed = new Set<string>()
  for (const entry of catalog) {
    if (entry.sku) {
      bySku.set(entry.sku.toLowerCase(), entry)
      bySkuCompact.set(normalizeKey(entry.sku), entry)
    }
    if (entry.barcode) byBarcode.set(entry.barcode, entry)
    byTitle.set(tokenize(entry.title).join(' '), entry)
  }
  return {
    find(sku: string, barcode: string | null, title: string): LocalCatalogEntry | null {
      const skuKey = sku.trim().toLowerCase()
      const compactKey = normalizeKey(sku)
      const match = bySku.get(skuKey) ?? bySkuCompact.get(compactKey) ?? (barcode ? byBarcode.get(barcode.trim().toLowerCase()) : null)
      if (match) return match
      const tokens = tokenize(title)
      if (tokens.length === 0) return null
      const exact = byTitle.get(tokens.join(' '))
      if (exact) return exact
      let best: LocalCatalogEntry | null = null
      let bestScore = 0
      for (const entry of catalog) {
        if (fuzzyClaimed.has(entry.sku)) continue
        const score = titleScore(entry.title, title)
        if (score > bestScore) {
          bestScore = score
          best = entry
        }
      }
      if (best && bestScore >= TITLE_MATCH_THRESHOLD) {
        fuzzyClaimed.add(best.sku)
        return best
      }
      return null
    },
  }
}

async function syncPrices(): Promise<number> {
  try {
    const fresh = await paginate<any>('products', 'status=active')
    const priceById = new Map<string, string>()
    for (const raw of fresh) {
      priceById.set(String(raw.id), String(raw.variants?.[0]?.price ?? 0))
    }
    if (store.products.length === 0) {
      store.products = fresh.map(normalizeProduct)
    } else {
      store.products = store.products.map((p) => {
        const price = priceById.get(String(p.id))
        return price !== undefined ? { ...p, price } : p
      })
    }
  } catch (err) {
    if (store.products.length === 0) throw err
  }
  const catalog = await getLocalCatalog()
  const matcher = buildMatcher(catalog)
  const list: SyncPrice[] = []

  for (const p of store.products) {
    const sku = String(p.sku).trim().toLowerCase()
    const currentPrice = Number(p.price) || 0
    const local = matcher.find(sku, p.barcode, p.title)
    if (!local) {
      list.push({ productId: p.id, variantId: p.variantId, title: p.title, sku: p.sku, handle: p.handle, currentPrice, targetPrice: 0, status: 'no-match' })
      continue
    }
    const targetPrice = local.sellingPrice || 0
    const status: SyncPrice['status'] = Math.abs(currentPrice - targetPrice) > 0.005 ? 'update' : 'up-to-date'
    list.push({ productId: p.id, variantId: p.variantId, title: p.title, sku: p.sku, handle: p.handle, currentPrice, targetPrice, status })
  }

  store.price = list
  return list.filter((x) => x.status === 'update').length
}

async function setVariantPrice(variantId: number, price: number) {
  const url = new URL(apiPath(config.apiVersion, `variants/${variantId}`))
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ variant: { id: variantId, price: price.toFixed(2) } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
}

export async function applyPriceSync() {
  const pending = store.price.filter((p) => p.status === 'update')
  if (!(await acquireSyncLock('price'))) return { ok: false, message: 'A sync is already in progress' }
  if (pending.length === 0) { releaseSyncLock(); return { ok: true, updated: 0, skipped: 0, errors: [] as string[] } }

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  try {
    for (const p of pending) {
      if (!p.variantId) {
        p.status = 'no-match'
        skipped++
        continue
      }
      try {
        await setVariantPrice(p.variantId, p.targetPrice)
        p.status = 'updated'
        updated++
        addLog('price', 'success', 1, `Price updated: ${p.sku}`)
        await persistLog({ entity: 'Price', shopifyId: p.sku, direction: 'out', action: 'Price Update', status: 'success' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        p.status = 'update'
        errors.push(`${p.sku}: ${message}`)
        addLog('price', 'failed', 1, message)
        store.lastError = message
        await persistLog({ entity: 'Price', shopifyId: p.sku, direction: 'out', action: 'Price Update', status: 'failed', error: message, retry: true })
      }
    }
    if (updated > 0) store.lastSync.price = new Date().toISOString()
    return { ok: errors.length === 0, updated, skipped, errors }
  } finally {
    releaseSyncLock()
  }
}

export interface ShopifyPricePushResult {
  ok: boolean
  updated: number
  skipped: number
  errors: string[]
  message?: string
}

export async function pushProductPriceToShopify(localProductId: string): Promise<ShopifyPricePushResult> {
  if (!isConfigured()) {
    return { ok: false, updated: 0, skipped: 0, errors: [], message: 'Shopify is not configured. See server/.env' }
  }
  if (!db) {
    return { ok: false, updated: 0, skipped: 0, errors: [], message: 'Database is not configured' }
  }
  if (!(await acquireSyncLock('price'))) {
    return { ok: false, updated: 0, skipped: 0, errors: [], message: 'A sync is already in progress' }
  }

  try {
  const [row] = await db.select().from(schema.products).where(eq(schema.products.id, localProductId)).limit(1)
  if (!row) { releaseSyncLock(); return { ok: false, updated: 0, skipped: 0, errors: ['Product not found'] } }

  const shopifyProductId = Number(row.shopifyId)
  if (!row.shopifyId || !shopifyProductId) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: [`${row.sku} is not listed on Shopify yet`] }
  }

  const price = Number(row.sellingPrice)
  if (!Number.isFinite(price) || price <= 0) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: [`${row.sku} has no valid selling price`] }
  }
  const compareAt = Number(row.compareAtPrice)

  let variantId: number
  try {
    const res = await shopifyRequest<any>(`products/${shopifyProductId}`)
    const variant = res.json?.product?.variants?.[0]
    variantId = Number(variant?.id ?? 0)
    if (!variantId) {
      return { ok: false, updated: 0, skipped: 0, errors: [`No Shopify variant found for ${row.sku}`] }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    store.lastError = message
    return { ok: false, updated: 0, skipped: 0, errors: [message] }
  }

  const body: Record<string, unknown> = { id: variantId, price: price.toFixed(2) }
  if (Number.isFinite(compareAt) && compareAt > 0) body.compare_at_price = compareAt.toFixed(2)

  const url = new URL(apiPath(config.apiVersion, `variants/${variantId}`))
  const put = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ variant: body }),
  })
  if (!put.ok) {
    const text = await put.text().catch(() => '')
    const message = `Shopify API error ${put.status}: ${text.slice(0, 200)}`
    addLog('price', 'failed', 1, message)
    store.lastError = message
    await persistLog({ entity: 'Price', shopifyId: row.sku, direction: 'out', action: 'Price Update', status: 'failed', error: message, retry: true })
    return { ok: false, updated: 0, skipped: 0, errors: [message] }
  }

  store.price = store.price.map((p) =>
    p.productId === shopifyProductId
      ? { ...p, currentPrice: price, targetPrice: price, status: 'up-to-date' as const }
      : p,
  )
  store.products = store.products.map((p) =>
    p.id === shopifyProductId
      ? { ...p, price: price.toFixed(2), compareAtPrice: Number.isFinite(compareAt) && compareAt > 0 ? compareAt.toFixed(2) : null }
      : p,
  )
  store.lastSync.price = new Date().toISOString()
  addLog('price', 'success', 1, `Price updated: ${row.sku}`)
  await persistLog({ entity: 'Price', shopifyId: row.sku, direction: 'out', action: 'Price Update', status: 'success' })
  return { ok: true, updated: 1, skipped: 0, errors: [] }
  } finally {
    releaseSyncLock()
  }
}

interface LocalProductForPush {
  id: string
  name: string
  sku: string
  barcode: string | null
  huid: string | null
  category: string | null
  collection: string | null
  purity: number | null
  supplier: string | null
  vendor: string | null
  productType: string | null
  tags: string | null
  image: string | null
  images: string[] | null
  sellingPrice: number | null
  compareAtPrice: number | null
  stock: number | null
  trackInventory: boolean | null
  chargeOnTax: boolean | null
  shopifyId: string | null
  shopifyStatus: string | null
  status: string | null
}

async function createShopifyProduct(local: LocalProductForPush): Promise<{ productId: number; variantId: number; inventoryItemId: number | null }> {
  if (!isConfigured()) {
    throw new ShopifyError('Shopify is not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in server/.env', 503)
  }
  const url = new URL(apiPath(config.apiVersion, 'products'))
  const price = Number(local.sellingPrice)
  const trackInventory = local.trackInventory !== false
  const chargeOnTax = local.chargeOnTax !== false
  const variant: Record<string, string | number | boolean> = {}
  if (price > 0) variant.price = price.toFixed(2)
  if (Number(local.compareAtPrice) > 0) variant.compare_at_price = Number(local.compareAtPrice).toFixed(2)
  if (local.sku) variant.sku = local.sku
  if (local.barcode) variant.barcode = local.barcode
  if (trackInventory) variant.inventory_management = 'shopify'
  variant.taxable = chargeOnTax

  const tags = [
    local.collection ? `opal-collection:${local.collection}` : null,
    local.chargeOnTax !== false ? `opal-chargeontax:true` : `opal-chargeontax:false`,
    local.category,
    local.purity != null ? `${local.purity}%` : null,
    local.huid ? `huid:${local.huid}` : null,
    ...(local.tags ? local.tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
  ]
    .filter(Boolean)
    .join(', ')

  const body: Record<string, unknown> = {
    product: {
      title: local.name,
      body_html: `<p>${escapeHtml(local.name)}</p>`,
      vendor: local.vendor || local.supplier || 'Opal Line',
      product_type: local.collection || local.productType || local.category || '',
      tags,
      status: 'active',
      variants: [variant],
    },
  }
  // Collect all images: local uploads (data URLs / served paths) + remote URLs.
  // Shopify accepts either an external URL or a base64 `attachment` payload.
  const imageSrcs = Array.from(new Set([...(local.images ?? []).filter(Boolean), local.image].filter(Boolean) as string[]))
  const images: Array<Record<string, string>> = []
  for (const src of imageSrcs.slice(0, 20)) {
    if (/^data:image\//i.test(src)) {
      const base64 = src.slice(src.indexOf(',') + 1)
      if (base64) images.push({ attachment: base64 })
    } else if (/^https?:\/\//i.test(src)) {
      images.push({ src })
    } else if (/^\/?(uploads|images)\//i.test(src)) {
      // Locally-served file path — read from disk and attach as base64
      try {
        const { readFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        const { UPLOADS_DIR } = await import('./uploads')
        const fileName = src.replace(/^\/(uploads|images)\//, '')
        const resolved = join(UPLOADS_DIR(), path.basename(fileName))
        const buf = readFileSync(resolved)
        images.push({ attachment: buf.toString('base64'), filename: path.basename(fileName) })
      } catch {
        // File missing on disk — skip rather than fail the whole push.
      }
    }
  }
  if (images.length > 0) {
    body.product = { ...(body.product as object), images }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  const json = (await res.json()) as { product?: { id?: number; variants?: Array<{ id?: number; inventory_item_id?: number }> } }
  const productId = Number(json.product?.id ?? 0)
  if (!productId) {
    throw new ShopifyError('Shopify returned an unexpected response while creating the product.', 502)
  }
  return {
    productId,
    variantId: Number(json.product?.variants?.[0]?.id ?? 0),
    inventoryItemId: Number(json.product?.variants?.[0]?.inventory_item_id ?? 0),
  }
}

export async function deleteShopifyProduct(productId: number): Promise<void> {
  const url = new URL(apiPath(config.apiVersion, `products/${productId}`))
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })
  if (res.status === 404) return
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
}

export interface ShopifyPurgeResult {
  ok: boolean
  shopifyDeleted: number
  localDeleted: number
  errors: string[]
}

export async function purgeProducts(): Promise<ShopifyPurgeResult> {
  if (!isConfigured()) {
    return { ok: false, shopifyDeleted: 0, localDeleted: 0, errors: ['Shopify is not configured. See server/.env'] }
  }

  const errors: string[] = []
  let shopifyDeleted = 0
  let localDeleted = 0

  let all: any[] = []
  try {
    all = await paginate<any>('products', '', CONSTANTS.SHOPIFY_MAX_PAGES * 4)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Failed to list Shopify products')
  }

  for (const raw of all) {
    try {
      await deleteShopifyProduct(Number(raw.id))
      shopifyDeleted++
    } catch (err) {
      errors.push(`${raw.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  if (db) {
    try {
      const rows = await db.select({ id: schema.products.id }).from(schema.products)
      localDeleted = rows.length
      await db.delete(schema.products)
      await db.delete(schema.stockTransfers)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Failed to clear local products')
    }
  } else {
    errors.push('Database is not configured')
  }

  store.products = []
  store.inventory = []
  store.price = []
  store.lastSync = {}
  store.logs = []

  return { ok: errors.length === 0, shopifyDeleted, localDeleted, errors }
}

export interface ShopifyPushResult {
  ok: boolean
  created: number
  skipped: number
  errors: string[]
  message?: string
}

export async function pushProductsToShopify(ids?: string[]): Promise<ShopifyPushResult> {
  if (!(await acquireSyncLock('products'))) return { ok: false, created: 0, skipped: 0, errors: [], message: 'A sync is already in progress' }
  if (!isConfigured()) {
    releaseSyncLock()
    return { ok: false, created: 0, skipped: 0, errors: ['Shopify is not configured. See server/.env'], message: 'Shopify is not configured. See server/.env' }
  }
  if (!db) {
    releaseSyncLock()
    return { ok: false, created: 0, skipped: 0, errors: ['Database is not configured'], message: 'Database is not configured' }
  }

  let rows: LocalProductForPush[]
  try {
    const selected = ids && ids.length > 0
      ? await db.select().from(schema.products).where(inArray(schema.products.id, ids))
      : await db.select().from(schema.products).where(or(isNull(schema.products.shopifyId), eq(schema.products.shopifyId, ''), like(schema.products.shopifyId, '#%')))
    rows = selected.map((r) => ({
      ...r,
      images: Array.isArray(r.images) ? (r.images as string[]).filter((x): x is string => typeof x === 'string') : null,
    }))
  } catch (err) {
    releaseSyncLock()
    return { ok: false, created: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Failed to read products'] }
  }
  let created = 0
  let skipped = 0
  const errors: string[] = []
  let locations: { id: number; name: string }[] = []

  try {
    for (const row of rows) {
      const placeHolderId = row.shopifyId != null && String(row.shopifyId).trim().startsWith('#')
      const genuinelyLinked = row.shopifyId != null && String(row.shopifyId).trim() !== '' && !placeHolderId
      if (genuinelyLinked) {
        skipped++
        continue
      }
      if (row.status && row.status !== 'active') {
        skipped++
        continue
      }
      try {
        const { productId, variantId, inventoryItemId } = await createShopifyProduct(row)
        await db.update(schema.products).set({ shopifyId: String(productId), shopifyStatus: 'synced' }).where(eq(schema.products.id, row.id))
        created++
        addLog('products', 'success', 1, `Created on Shopify: ${row.sku}`)
        await persistLog({ entity: 'Product', shopifyId: String(productId), direction: 'out', action: 'Create', status: 'success' })
        if (row.trackInventory !== false && inventoryItemId) {
          try {
            if (locations.length === 0) locations = await fetchLocations()
            const locationId = locations[0]?.id
            if (locationId) {
              await setInventoryItemTracked(inventoryItemId)
              await setInventoryLevel(inventoryItemId, locationId, Number(row.stock ?? 0))
            }
          } catch {
            // Inventory level is best-effort; the product itself is already created.
          }
        }
        if (variantId) {
          store.price = store.price.map((p) =>
            p.productId === productId ? { ...p, variantId, status: p.status === 'no-match' ? 'update' : p.status } : p,
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${row.sku}: ${message}`)
        addLog('products', 'failed', 1, message)
        await persistLog({ entity: 'Product', shopifyId: row.sku, direction: 'out', action: 'Create', status: 'failed', error: message, retry: true })
      }
    }
    if (created > 0) {
      store.lastSync.products = new Date().toISOString()
      try {
        await syncProducts()
      } catch {
        // Best-effort refresh of the in-memory catalog after pushing.
      }
    }
    return { ok: errors.length === 0, created, skipped, errors }
  } finally {
    releaseSyncLock()
  }
}

export interface ShopifyInventoryPushResult {
  ok: boolean
  updated: number
  skipped: number
  errors: string[]
  message?: string
}

async function setInventoryItemTracked(inventoryItemId: number) {
  const url = new URL(apiPath(config.apiVersion, `inventory_items/${inventoryItemId}`))
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ inventory_item: { id: inventoryItemId, tracked: true } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
}

async function setInventoryLevel(inventoryItemId: number, locationId: number, available: number) {
  const url = new URL(apiPath(config.apiVersion, 'inventory_levels/set'))
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ inventory_item_id: inventoryItemId, location_id: locationId, available }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ShopifyError(`Shopify API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
}

export async function pushInventoryToShopify(ids?: string[]): Promise<ShopifyInventoryPushResult> {
  if (!(await acquireSyncLock('inventory'))) return { ok: false, updated: 0, skipped: 0, errors: [], message: 'A sync is already in progress' }
  if (!isConfigured()) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: ['Shopify is not configured. See server/.env'], message: 'Shopify is not configured. See server/.env' }
  }
  if (!db) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: ['Database is not configured'], message: 'Database is not configured' }
  }

  try {
    if (store.products.length === 0) await syncProducts()
  } catch (err) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Failed to sync products'] }
  }

  let rows: Array<{ id: string; sku: string; stock: number | null }>
  try {
    rows = ids && ids.length > 0
      ? await db.select({ id: schema.products.id, sku: schema.products.sku, stock: schema.products.stock }).from(schema.products).where(inArray(schema.products.id, ids))
      : await db.select({ id: schema.products.id, sku: schema.products.sku, stock: schema.products.stock }).from(schema.products)
  } catch (err) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Failed to read products'] }
  }

  const bySku = new Map<string, SyncProduct>()
  const bySkuCompact = new Map<string, SyncProduct>()
  for (const p of store.products) {
    if (!p.sku) continue
    const key = p.sku.trim().toLowerCase()
    bySku.set(key, p)
    bySkuCompact.set(normalizeKey(key), p)
  }

  let locations: { id: number; name: string }[]
  try {
    locations = await fetchLocations()
  } catch (err) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Failed to fetch locations'] }
  }
  const locationId = locations[0]?.id
  if (!locationId) {
    releaseSyncLock()
    return { ok: false, updated: 0, skipped: 0, errors: ['No inventory locations found on the store'] }
  }

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  try {
    for (const row of rows) {
      const skuKey = String(row.sku ?? '').trim().toLowerCase()
      if (!skuKey) {
        skipped++
        continue
      }
      const shop = bySku.get(skuKey) ?? bySkuCompact.get(normalizeKey(skuKey))
      if (!shop || !shop.inventoryItemId) {
        skipped++
        continue
      }
      const stock = Number(row.stock ?? 0)
      try {
        await setInventoryItemTracked(shop.inventoryItemId)
        await setInventoryLevel(shop.inventoryItemId, locationId, stock)
        updated++
        addLog('inventory', 'success', 1, `Stock set: ${shop.sku} = ${stock}`)
        await persistLog({ entity: 'Inventory', shopifyId: shop.sku, direction: 'out', action: 'Stock Update', status: 'success' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${shop.sku}: ${message}`)
        addLog('inventory', 'failed', 1, message)
        await persistLog({ entity: 'Inventory', shopifyId: shop.sku, direction: 'out', action: 'Stock Update', status: 'failed', error: message, retry: true })
      }
    }
    if (updated > 0) {
      store.lastSync.inventory = new Date().toISOString()
      try {
        await syncInventory()
      } catch {
        // Best-effort refresh of in-memory inventory after pushing.
      }
    }
    return { ok: errors.length === 0, updated, skipped, errors }
  } finally {
    releaseSyncLock()
  }
}

const syncers: Record<SyncResource, () => Promise<number>> = {
  products: syncProducts,
  orders: syncOrders,
  customers: syncCustomers,
  inventory: syncInventory,
  price: syncPrices,
}

export interface PostRestoreSyncResult {
  ok: boolean
  products?: { created: number; skipped: number; errors: string[] }
  prices?: { updated: number; skipped: number; errors: string[] }
  inventory?: { updated: number; skipped: number; errors: string[] }
  errors: string[]
}

// After a backup restore has committed the local database, push the restored
// catalog, prices and stock levels to Shopify so the storefront matches the
// restored data. Best-effort: failures are collected but never throw.
export async function pushRestoredDataToShopify(): Promise<PostRestoreSyncResult> {
  if (!isConfigured()) return { ok: false, errors: ['Shopify is not configured. See server/.env'] }
  if (!db) return { ok: false, errors: ['Database is not configured'] }

  const errors: string[] = []
  const result: PostRestoreSyncResult = { ok: true, errors }

  try {
    const products = await pushProductsToShopify()
    result.products = { created: products.created, skipped: products.skipped, errors: products.errors }
    if (!products.ok) errors.push(...products.errors)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Product push failed'
    errors.push(message)
  }

  try {
    await syncProducts()
    await syncPrices()
    const prices = await applyPriceSync()
    result.prices = {
      updated: prices.updated ?? 0,
      skipped: prices.skipped ?? 0,
      errors: prices.errors ?? [],
    }
    if (!prices.ok) errors.push(...(prices.errors ?? []))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Price sync failed'
    errors.push(message)
  }

  try {
    const inventory = await pushInventoryToShopify()
    result.inventory = { updated: inventory.updated, skipped: inventory.skipped, errors: inventory.errors }
    if (!inventory.ok) errors.push(...inventory.errors)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Inventory push failed'
    errors.push(message)
  }

  result.ok = errors.length === 0
  return result
}

export async function runSync(resources: SyncResource[] = ['orders', 'products', 'customers', 'inventory', 'price']) {
  if (!(await acquireSyncLock('sync'))) return { ok: false, message: 'A sync is already in progress' }
  store.lastError = undefined
  const results: Record<SyncResource, { ok: boolean; count: number; message?: string }> = {
    orders: { ok: false, count: 0 },
    products: { ok: false, count: 0 },
    customers: { ok: false, count: 0 },
    inventory: { ok: false, count: 0 },
    price: { ok: false, count: 0 },
  }

  try {
    for (const resource of resources) {
      try {
        const count = await syncers[resource]()
        store.lastSync[resource] = new Date().toISOString()
        results[resource] = { ok: true, count }
        addLog(resource, 'success', count)
        const meta = entityFor[resource]
        await persistLog({ entity: meta.entity, direction: resource === 'price' ? 'out' : 'in', action: meta.action, status: 'success' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        results[resource] = { ok: false, count: 0, message }
        addLog(resource, 'failed', 0, message)
        store.lastError = message
        const meta = entityFor[resource]
        await persistLog({ entity: meta.entity, direction: resource === 'price' ? 'out' : 'in', action: meta.action, status: 'failed', error: message, retry: true })
      }
    }
    return { ok: true, results }
  } finally {
    releaseSyncLock()
  }
}

export async function ensureSynced(resource?: SyncResource) {
  const targets = resource ? [resource] : (Object.keys(syncers) as SyncResource[])
  const pending = targets.filter((r) => !store.lastSync[r])
  if (pending.length > 0) {
    await runSync(pending)
  }
}

export interface SilverUpdateResult {
  ok: boolean
  rate: number
  previousRate: number
  affected: number
  matched: number
  updated: number
  skipped: number
  errors: string[]
  message?: string
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function getLatestSilverRate(): Promise<{ rate: number; purity: number; previousRate: number; updatedAt: string } | null> {
  if (!db) return null
  try {
    const rows = await db
      .select()
      .from(schema.silverRates)
      .orderBy(desc(schema.silverRates.updatedAt))
      .limit(1)
    const latest = rows[0]
    if (!latest) return null
    return {
      rate: Number(latest.rate ?? 0),
      purity: Number(latest.purity ?? 0),
      previousRate: Number(latest.previousRate ?? 0),
      updatedAt: String(latest.updatedAt ?? ''),
    }
  } catch {
    return null
  }
}

export async function applySilverRate(rate: number, options?: { syncFirst?: boolean }): Promise<SilverUpdateResult> {
  const previous = await getLatestSilverRate()
  const previousRate = previous?.rate ?? 92.8

  if (options?.syncFirst) {
    const synced = await syncProductsToDb()
    if (!synced.ok) {
      return {
        ok: false,
        rate,
        previousRate,
        affected: 0,
        matched: 0,
        updated: 0,
        skipped: 0,
        errors: [`Product sync failed before silver rate update: ${synced.errors.join('; ')}`],
        message: 'Product sync failed before silver rate update',
      }
    }
  }

  if (!db) {
    return { ok: false, rate, previousRate, affected: 0, matched: 0, updated: 0, skipped: 0, errors: [], message: 'Database is not configured' }
  }

  const affected = await db.$count(schema.products)
  const change = round2(rate - previousRate)
  const changePercent = previousRate > 0 ? round2((change / previousRate) * 100) : 0
  const now = new Date().toISOString()

  try {
    await db.insert(schema.silverRates).values({
      id: randomUUID(),
      purity: 92.5,
      rate,
      previousRate,
      updatedAt: now,
      change,
      changePercent,
      currency: 'INR',
    })
  } catch (err) {
    return { ok: false, rate, previousRate, affected: 0, matched: 0, updated: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Failed to save silver rate'] }
  }

  const rows = await db
    .select({ id: schema.products.id, netWeight: schema.products.netWeight, makingCharge: schema.products.makingCharge })
    .from(schema.products)

  let recomputed = 0
  for (const row of rows) {
    const netWeight = Number(row.netWeight)
    const makingCharge = Number(row.makingCharge)
    if (!netWeight || netWeight <= 0) continue
    const basePrice = (rate + makingCharge) * netWeight
    const sellingPrice = round2(basePrice * 1.03)
    await db.update(schema.products).set({ sellingPrice, silverRate: rate }).where(eq(schema.products.id, row.id))
    recomputed++
  }

  await db.insert(schema.auditLogs).values({
    id: randomUUID(),
    timestamp: now,
    user: 'Admin',
    action: `Silver rate updated to ₹${rate.toFixed(2)}/gm`,
    module: 'Silver',
    entity: 'silver_rates',
    changes: `previous=${previousRate}, rate=${rate}`,
    ip: null,
  })

  let matched = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []

  if (isConfigured()) {
    try {
      await syncPrices()
      const pending = store.price.filter((p) => p.status === 'update')
      matched = store.price.filter((p) => p.status !== 'no-match').length
      if (pending.length > 0) {
        const result = await applyPriceSync()
        updated = result.updated ?? 0
        skipped = result.skipped ?? 0
        errors.push(...(result.errors ?? []))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      store.lastError = message
      errors.push(message)
      await persistLog({ entity: 'Price', direction: 'out', action: 'Silver Rate Update', status: 'failed', error: message, retry: true })
    }
  } else {
    await persistLog({ entity: 'Silver', direction: 'in', action: 'Rate Update (Shopify not configured)', status: 'success' })
  }

  return {
    ok: errors.length === 0,
    rate,
    previousRate,
    affected: recomputed,
    matched,
    updated,
    skipped,
    errors,
  }
}

export interface DraftOrderLineInput {
  title: string
  quantity: number
  price: number | null
  sku?: string
}

export interface DraftOrderAddressInput {
  name?: string
  phone?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  zip?: string
  country?: string
}

export interface DraftOrderPayload {
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  payment?: string
  billingAddress?: DraftOrderAddressInput
  shippingAddress?: DraftOrderAddressInput
  note?: string
  tags?: string
  lineItems: DraftOrderLineInput[]
}

interface ResolveCustomerInput {
  name?: string
  email?: string
  phone?: string
  billingAddress?: Record<string, unknown>
}

async function findShopifyCustomerId(query: string): Promise<string | undefined> {
  try {
    const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/customers/search.json?limit=5&query=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return undefined
    const json = (await res.json().catch(() => null)) as { customers?: Array<{ id?: number | string }> } | null
    const id = json?.customers?.[0]?.id
    return id != null ? String(id) : undefined
  } catch {
    return undefined
  }
}

async function createShopifyCustomer(input: ResolveCustomerInput): Promise<string | undefined> {
  const nameParts = (input.name ?? '').split(/\s+/).filter(Boolean)
  const first = nameParts.shift()
  const customer: Record<string, unknown> = {
    ...(first ? { first_name: first } : {}),
    ...(nameParts.length ? { last_name: nameParts.join(' ') } : {}),
  }
  if (input.email) customer.email = input.email
  if (input.phone) customer.phone = input.phone
  const a = input.billingAddress
  if (a && Object.keys(a).length) {
    customer.addresses = [
      {
        ...(typeof a.firstName === 'string' ? { first_name: a.firstName } : {}),
        ...(typeof a.lastName === 'string' ? { last_name: a.lastName } : {}),
        ...(typeof a.phone === 'string' ? { phone: a.phone } : {}),
        ...(typeof a.address1 === 'string' ? { address1: a.address1 } : {}),
        ...(typeof a.address2 === 'string' ? { address2: a.address2 } : {}),
        ...(typeof a.city === 'string' ? { city: a.city } : {}),
        ...(typeof a.province === 'string' ? { province: a.province } : {}),
        ...(typeof a.zip === 'string' ? { zip: a.zip } : {}),
        ...(typeof a.country === 'string' ? { country: a.country } : {}),
        default: true,
      },
    ]
  }
  try {
    const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/customers.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ customer }),
    })
    if (!res.ok) return undefined
    const json = (await res.json().catch(() => null)) as { customer?: { id?: number | string } } | null
    return json?.customer?.id != null ? String(json.customer.id) : undefined
  } catch {
    return undefined
  }
}

async function resolveShopifyCustomerId(input: ResolveCustomerInput): Promise<string | undefined> {
  const queries: string[] = []
  if (input.email) queries.push(`email:${input.email}`)
  if (input.phone) queries.push(`phone:${input.phone}`)
  for (const q of queries) {
    const found = await findShopifyCustomerId(q)
    if (found) return `gid://shopify/Customer/${found}`
  }
  if (input.email || input.phone || input.name) {
    const created = await createShopifyCustomer(input)
    if (created) return `gid://shopify/Customer/${created}`
  }
  return undefined
}

function toMailingAddress(address?: DraftOrderAddressInput): Record<string, unknown> | undefined {
  if (!address) return undefined
  const name = (address.name ?? '').trim()
  const nameParts = name.split(/\s+/).filter(Boolean)
  const first = nameParts.shift()
  return {
    ...(first ? { firstName: first } : {}),
    ...(nameParts.length ? { lastName: nameParts.join(' ') } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.address1 ? { address1: address.address1 } : {}),
    ...(address.address2 ? { address2: address.address2 } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.province ? { province: address.province } : {}),
    ...(address.zip ? { zip: address.zip } : {}),
    ...(address.country ? { country: address.country } : {}),
  }
}

export interface DraftOrderResult {
  ok: boolean
  draftId?: string
  name?: string
  completed?: boolean
  customerId?: string
  errors: string[]
  message?: string
}

export async function createShopifyDraftOrder(payload: DraftOrderPayload): Promise<DraftOrderResult> {
  if (!isConfigured()) {
    return {
      ok: false,
      errors: ['Shopify is not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in server/.env'],
      message: 'Shopify is not configured',
    }
  }

  const lineItems = (payload.lineItems ?? [])
    .filter((li) => li.title && li.quantity > 0)
    .map((li) => ({
      title: li.title,
      quantity: li.quantity,
      sku: li.sku || undefined,
      originalUnitPrice:
        li.price != null && Number.isFinite(li.price) && li.price >= 0 ? li.price.toFixed(2) : '0.00',
    }))

  if (lineItems.length === 0) {
    return { ok: false, errors: ['At least one line item with a quantity is required'] }
  }

  const input: Record<string, unknown> = {
    lineItems,
    note: payload.note || undefined,
    tags: payload.tags || undefined,
  }
  if (payload.customerEmail) input.email = payload.customerEmail
  const billingAddress = toMailingAddress(payload.billingAddress)
  const shippingAddress = toMailingAddress(payload.shippingAddress)
  if (billingAddress) input.billingAddress = billingAddress
  if (shippingAddress) input.shippingAddress = shippingAddress

  const customerId = await resolveShopifyCustomerId({
    name: payload.customerName,
    email: payload.customerEmail,
    phone: payload.customerPhone,
    billingAddress,
  })
  if (customerId) {
    input.customerId = customerId
  }

  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`
  const query = `mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id name }
      userErrors { field message }
    }
  }`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: { input } }),
    })
    const resText = await res.text()
    let json: {
      data?: {
        draftOrderCreate?: {
          draftOrder?: { id?: string; name?: string }
          userErrors?: Array<{ field?: string[]; message?: string }>
        }
      }
      errors?: Array<{ message?: string }>
      extensions?: { userErrors?: Array<{ code?: string; message?: string }> }
    } | null = null
    try {
      json = JSON.parse(resText)
    } catch {
      // Non-JSON response (e.g. gateway/HTML error page).
    }

    if (!res.ok) {
      const text = json?.errors?.map((e) => e.message).join(' ') || `Shopify API error ${res.status}`
      await persistLog({ entity: 'Order', direction: 'out', action: 'Draft Order Create', status: 'failed', error: text })
      return { ok: false, errors: [text], message: 'Shopify rejected the request' }
    }

    const result = json?.data?.draftOrderCreate
    if (!result?.draftOrder?.id) {
      const msg =
        result?.userErrors?.map((u) => (u.field ? `${u.field.join('.')}: ${u.message}` : u.message)).join(' ') ||
        json?.extensions?.userErrors?.map((u) => (u.code ? `${u.code}: ${u.message}` : u.message)).join(' ') ||
        json?.errors?.map((e) => e.message).join(' ') ||
        (resText && resText.trim() ? resText.slice(0, 500) : 'Shopify returned an unexpected response')
      await persistLog({ entity: 'Order', direction: 'out', action: 'Draft Order Create', status: 'failed', error: msg })
      return { ok: false, errors: [msg], message: msg }
    }

    const draftId = result.draftOrder.id
    let completed = false
    let name = result.draftOrder.name ?? undefined
    let completionError: string | null = null

    try {
      const completeRes = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': config.accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: `mutation draftOrderComplete($id: ID!, $paymentPending: Boolean!) {
            draftOrderComplete(id: $id, paymentPending: $paymentPending) {
              draftOrder { id status name order { id name } }
              userErrors { field message }
            }
          }`,
          variables: { id: draftId, paymentPending: payload.payment !== 'paid' },
        }),
      })
      const completeJson = (await completeRes.json().catch(() => null)) as
        | {
            data?: {
              draftOrderComplete?: {
                draftOrder?: { status?: string; name?: string; order?: { id?: string; name?: string } }
                userErrors?: Array<{ field?: string[]; message?: string }>
              }
            }
            errors?: Array<{ message?: string }>
          }
        | null
      const completeResult = completeJson?.data?.draftOrderComplete
      const completedOrder = completeResult?.draftOrder?.order
      if (completedOrder?.id || completedOrder?.name) {
        completed = true
        name = completedOrder.name ?? completeResult?.draftOrder?.name ?? name
      } else if (!completeRes.ok || completeResult?.userErrors?.length || completeJson?.errors?.length) {
        const msg =
          completeResult?.userErrors?.map((u) => (u.field ? `${u.field.join('.')}: ${u.message}` : u.message)).join(' ') ||
          completeJson?.errors?.map((e) => e.message).join(' ') ||
          `Shopify API error ${completeRes.status}`
        completionError = msg
        await persistLog({
          entity: 'Order',
          shopifyId: name ?? draftId,
          direction: 'out',
          action: 'Draft Order Complete',
          status: 'failed',
          error: msg,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Draft order could not be completed'
      completionError = msg
      await persistLog({
        entity: 'Order',
        shopifyId: name ?? draftId,
        direction: 'out',
        action: 'Draft Order Complete',
        status: 'failed',
        error: msg,
      })
    }

    if (completionError) {
      return {
        ok: false,
        draftId,
        name,
        completed: false,
        errors: [completionError],
        message: `Draft order was created but could not be completed on Shopify: ${completionError}`,
      }
    }

    await persistLog({
      entity: 'Order',
      shopifyId: name ?? draftId,
      direction: 'out',
      action: completed ? 'Order Created' : 'Draft Order Created',
      status: 'success',
    })
    return { ok: true, draftId, name, completed, customerId: customerId || undefined, errors: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, errors: [msg], message: 'Shopify draft order creation failed' }
  }
}

export interface ShopifyOrderUpdateInput {
  orderName?: string
  email?: string
  note?: string
  tags?: string
  shippingAddress?: DraftOrderAddressInput
}

export interface ShopifyOrderUpdateResult {
  ok: boolean
  errors: string[]
  message?: string
}

async function findShopifyOrderIdByName(name: string): Promise<string | undefined> {
  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`
  const headers = {
    'X-Shopify-Access-Token': config.accessToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: `query($q: String!) { orders(first: 2, query: $q) { edges { node { id } } } }`,
          variables: { q: `name:${name.replace(/['"\\]/g, '')}` },
        }),
      })
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          data?: { orders?: { edges?: Array<{ node?: { id?: string } }> } }
        } | null
        const gid = json?.data?.orders?.edges?.[0]?.node?.id
        if (gid) return gid
      }
    } catch {
      // transient failure — retry
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return undefined
}

export async function updateShopifyOrder(payload: ShopifyOrderUpdateInput): Promise<ShopifyOrderUpdateResult> {
  if (!isConfigured()) {
    return { ok: false, errors: ['Shopify is not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in server/.env'], message: 'Shopify is not configured' }
  }
  const orderName = payload.orderName?.trim()
  if (!orderName) return { ok: true, errors: [] }

  try {
    const gid = await findShopifyOrderIdByName(orderName)
    if (!gid) {
      return { ok: false, errors: [`Order ${orderName} was not found on Shopify`], message: `Order ${orderName} was not found on Shopify` }
    }

    const input: Record<string, unknown> = { id: gid }
    if (payload.note != null) input.note = payload.note
    if (payload.email) input.email = payload.email
    if (payload.tags) input.tags = payload.tags
    const shippingAddress = toMailingAddress(payload.shippingAddress)
    if (shippingAddress) input.shippingAddress = shippingAddress

    if (Object.keys(input).length <= 1) return { ok: true, errors: [] }

    const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: `mutation orderUpdate($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id }
            userErrors { field message }
          }
        }`,
        variables: { input },
      }),
    })
    const json = (await res.json().catch(() => null)) as
      | {
          data?: { orderUpdate?: { userErrors?: Array<{ field?: string[]; message?: string }> } }
          errors?: Array<{ message?: string }>
        }
      | null
    const errors =
      json?.data?.orderUpdate?.userErrors
        ?.map((u) => (u.field ? `${u.field.join('.')}: ${u.message}` : u.message))
        .filter((m): m is string => Boolean(m)) ?? []
    const gqlErrors = json?.errors?.map((e) => e.message).filter((m): m is string => Boolean(m)) ?? []
    const all = [...errors, ...gqlErrors]
    const ok = res.ok && all.length === 0
    await persistLog({
      entity: 'Order',
      shopifyId: orderName,
      direction: 'out',
      action: 'Order Update',
      status: ok ? 'success' : 'failed',
      error: ok ? undefined : all.join(' ') || `Shopify API error ${res.status}`,
    })
    return { ok, errors: all, message: ok ? undefined : all.join(' ') || `Shopify API error ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, errors: [msg], message: 'Shopify order update failed' }
  }
}

export interface ShopifyOrdersImportResult {
  ok: boolean
  imported: number
  updated: number
  errors: string[]
  message?: string
}

function mapImportedPayment(status: string | null | undefined): string {
  switch (status) {
    case 'paid':
      return 'paid'
    case 'refunded':
    case 'partially_refunded':
      return 'refunded'
    case 'pending':
      return 'pending'
    default:
      return 'pending'
  }
}

function mapImportedFulfillment(status: string | null | undefined): string {
  switch (status) {
    case 'fulfilled':
      return 'fulfilled'
    case 'partial':
      return 'partial'
    default:
      return 'unfulfilled'
  }
}

function mapImportedStatus(raw: any): string {
  if (raw.cancelled_at || String(raw.financial_status ?? '') === 'voided') return 'cancelled'
  // Map Shopify fulfillment into pipeline stages so the kanban reflects reality
  if (raw.fulfillment_status === 'fulfilled') return 'fulfilled'
  if (raw.fulfillment_status === 'partial') return 'processing'
  if (Array.isArray(raw.fulfillments) && raw.fulfillments.length > 0) return 'processing'
  const closedAt = raw.closed_at ? Date.parse(raw.closed_at) : NaN
  if (Number.isFinite(closedAt)) return 'fulfilled'
  return 'imported'
}

export async function importShopifyOrders(): Promise<ShopifyOrdersImportResult> {
  if (!isConfigured()) {
    return { ok: false, imported: 0, updated: 0, errors: ['Shopify is not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in server/.env'], message: 'Shopify is not configured' }
  }
  if (!db) {
    return { ok: false, imported: 0, updated: 0, errors: ['Database is not configured. Set DATABASE_URL in server/.env and run npm run db:push && npm run db:seed.'], message: 'Database is not configured' }
  }

  try {
    const raw = await paginate<any>('orders', 'status=any&fulfillment_status=any')
    const existing = await db.select({ shopifyId: schema.salesOrders.shopifyId }).from(schema.salesOrders)
    const knownShopifyIds = new Set(existing.map((r) => r.shopifyId).filter((x): x is string => Boolean(x)))

    let customerStats = new Map<string, any>()
    try {
      const customers = await paginate<any>('customers', 'limit=250')
      customerStats = new Map(customers.map((c) => [String(c.id), c]))
    } catch {
      // Customer stats are a bonus; the import must never fail because of them.
    }

    let imported = 0
    let updated = 0
    const errors: string[] = []

    for (const o of raw) {
      const orderNumber = String(o.name ?? '').replace(/^#/, '')
      const shopifyId = orderNumber ? `#${orderNumber}` : ''
      if (!shopifyId) continue

      const customerId = o.customer?.id ? String(o.customer.id) : undefined
      // Shopify order REST API often has minimal customer object {id, email} without first_name/last_name.
      // The actual customer name is on billing_address. Fall back through: customer → billing_address → email → 'Guest'.
      // Some dev stores return literal "undefined" strings — treat those as empty.
      const safeStr = (v: unknown) => (typeof v === 'string' && v !== 'undefined' && v.trim()) ? v.trim() : ''
      const custFirstName = safeStr(o.customer?.first_name) || safeStr(o.billing_address?.first_name) || ''
      const custLastName = safeStr(o.customer?.last_name) || safeStr(o.billing_address?.last_name) || ''
      let customerName = `${custFirstName} ${custLastName}`.trim() || (safeStr(o.customer?.email) || safeStr(o.billing_address?.email) || 'Guest')
      const value = Math.round(Number(o.total_price ?? 0) * 100) / 100
      const items = o.line_items?.reduce((sum: number, li: any) => sum + Number(li.quantity ?? 0), 0) ?? 0
      const date = new Date(o.created_at ?? Date.now()).toISOString()
      const payment = mapImportedPayment(o.financial_status)
      const fulfillment = mapImportedFulfillment(o.fulfillment_status)
      const lineItems =
        o.line_items
          ?.map((li: any) => ({
            title: String(li.title ?? '').trim(),
            sku: li.sku ? String(li.sku) : '',
            quantity: Math.max(0, Number(li.quantity ?? 0)),
            price: Math.round(Number(li.price ?? 0) * 100) / 100,
          }))
          .filter((li: { title: string }) => li.title) ?? []
      const tags = String(o.tags ?? '').trim() || null
      const currency = String(o.currency ?? 'INR') || 'INR'
      const discount = Math.round(Number(o.total_discounts ?? 0) * 100) / 100

      const billingAddress = o.billing_address ? (() => {
        const addr = {
          name: `${safeStr(o.billing_address.first_name)} ${safeStr(o.billing_address.last_name)}`.trim(),
          address1: safeStr(o.billing_address.address1),
          address2: safeStr(o.billing_address.address2),
          city: safeStr(o.billing_address.city),
          province: safeStr(o.billing_address.province),
          zip: safeStr(o.billing_address.zip),
          country: safeStr(o.billing_address.country),
          phone: safeStr(o.billing_address.phone),
        }
        // Only return if at least one field has actual data
        return (addr.name || addr.address1 || addr.city || addr.phone) ? addr : null
      })() : null
      const shippingAddress = o.shipping_address ? (() => {
        const addr = {
          name: `${safeStr(o.shipping_address.first_name)} ${safeStr(o.shipping_address.last_name)}`.trim(),
          address1: safeStr(o.shipping_address.address1),
          address2: safeStr(o.shipping_address.address2),
          city: safeStr(o.shipping_address.city),
          province: safeStr(o.shipping_address.province),
          zip: safeStr(o.shipping_address.zip),
          country: safeStr(o.shipping_address.country),
          phone: safeStr(o.shipping_address.phone),
        }
        return (addr.name || addr.address1 || addr.city || addr.phone) ? addr : null
      })() : null

      if (knownShopifyIds.has(shopifyId)) {
        await db
          .update(schema.salesOrders)
          .set({
            ...(customerName && customerName !== 'Guest' ? { customer: customerName } : {}),
            value,
            payment,
            fulfillment,
            status: mapImportedStatus(o),
            items,
            tags,
            currency,
            discount,
            lineItems: lineItems.length > 0 ? lineItems : undefined,
            billingAddress: billingAddress ?? undefined,
            shippingAddress: shippingAddress ?? undefined,
          })
          .where(eq(schema.salesOrders.shopifyId, shopifyId))
        updated++
      } else {
        try {
          await db.transaction(async (tx) => {
            await tx
              .insert(schema.salesOrders)
              .values({
                id: `shopify-${o.id}`,
                shopifyId,
                internalId: `SO-${orderNumber}`,
                customer: customerName || 'Guest',
                value,
                payment,
                fulfillment,
                invoice: null,
                status: mapImportedStatus(o),
                date,
                items,
                tags,
                currency,
                discount,
                lineItems: lineItems.length > 0 ? lineItems : null,
                billingAddress: billingAddress ?? undefined,
                shippingAddress: shippingAddress ?? undefined,
              })
              .onConflictDoNothing()

            for (const li of lineItems) {
              const sku = String(li.sku ?? '').trim()
              const qty = Math.max(0, Math.floor(Number(li.quantity ?? 0)))
              if (!sku || qty <= 0) continue
              const [product] = await tx.select({ stock: schema.products.stock }).from(schema.products).where(eq(schema.products.sku, sku)).limit(1).for('update')
              if (!product) continue
              const current = Number(product.stock ?? 0)
              if (current - qty < 0) continue
              await tx.update(schema.products).set({ stock: sql`${schema.products.stock} - ${qty}` }).where(eq(schema.products.sku, sku))
            }
          })
          knownShopifyIds.add(shopifyId)
          imported++
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'Failed to import an order')
          continue
        }
      }

      if (customerId) {
        try {
          const cust = customerStats.get(customerId)
          const verifiedEmail =
            cust?.verified_email != null ? Boolean(cust.verified_email) : o.customer?.verified_email != null ? Boolean(o.customer.verified_email) : null
          const province = cust?.default_address?.province ?? cust?.addresses?.[0]?.province ?? null
          const city = cust?.default_address?.city ?? null
          const ordersCount = cust ? Number(cust.orders_count ?? 0) : null
          const totalSpent = cust ? Math.round(Number(cust.total_spent ?? value) * 100) / 100 : value
          const joined = cust?.created_at ? new Date(cust.created_at).toISOString().slice(0, 10) : date.slice(0, 10)
          // Prefer full customer object name > order billing_address name > email > fallback
          const custFullName = cust ? `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() : ''
          const label = custFullName || customerName || `Shopify Customer #${customerId}`
          // Also upgrade the order's customer field if we got a better name from the customer stats
          if (custFullName && custFullName !== customerName) {
            customerName = custFullName
          }
          const customerEmail = o.customer?.email ?? cust?.email ?? null
          const customerPhone = o.customer?.phone ?? cust?.phone ?? null

          let existingCustomer = null
          if (customerEmail) {
            const [byEmail] = await db
              .select()
              .from(schema.customers)
              .where(eq(schema.customers.email, customerEmail))
              .limit(1)
            if (byEmail) existingCustomer = byEmail
          }
          if (!existingCustomer && customerPhone) {
            const [byPhone] = await db
              .select()
              .from(schema.customers)
              .where(eq(schema.customers.phone, customerPhone))
              .limit(1)
            if (byPhone) existingCustomer = byPhone
          }
          if (!existingCustomer) {
            const [byShopifyId] = await db
              .select()
              .from(schema.customers)
              .where(eq(schema.customers.shopifyId, customerId))
              .limit(1)
            if (byShopifyId) existingCustomer = byShopifyId
          }

          if (existingCustomer) {
            await db
              .update(schema.customers)
              .set({
                name: existingCustomer.name || label,
                email: customerEmail ?? existingCustomer.email,
                phone: customerPhone ?? existingCustomer.phone,
                province: province ?? existingCustomer.province,
                city: city ?? existingCustomer.city,
                emailVerified: verifiedEmail ?? existingCustomer.emailVerified,
                shopifyId: existingCustomer.shopifyId ?? customerId,
                // Platform-reported stats are authoritative — never accumulate on top of them.
                ...(ordersCount != null ? { orders: ordersCount } : {}),
                ...(cust?.total_spent != null ? { totalSpent: Math.round(Number(cust.total_spent) * 100) / 100 } : {}),
                status: existingCustomer.status ?? 'active',
              })
              .where(eq(schema.customers.id, existingCustomer.id))
          } else {
            await db
              .insert(schema.customers)
              .values({
                id: `C-shop-${customerId}`,
                name: label,
                email: customerEmail,
                phone: customerPhone,
                city: city ?? null,
                province: province ?? null,
                shopifyId: customerId,
                emailVerified: verifiedEmail,
                orders: ordersCount ?? 0,
                totalSpent,
                status: 'active',
                joined,
              })
              .onConflictDoNothing()
          }
        } catch {
          // Customer upsert must never break the order import.
        }
      }
    }

    await persistLog({
      entity: 'Order',
      direction: 'in',
      action: 'Orders Synced',
      status: 'success',
    })
    return { ok: true, imported, updated, errors }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await persistLog({ entity: 'Order', direction: 'in', action: 'Orders Synced', status: 'failed', error: msg })
    return { ok: false, imported: 0, updated: 0, errors: [msg], message: 'Shopify order sync failed' }
  }
}

export interface ShopifyCustomersImportResult {
  ok: boolean
  imported: number
  updated: number
  errors: string[]
  message?: string
}

export async function importShopifyCustomers(): Promise<ShopifyCustomersImportResult> {
  if (!isConfigured()) {
    return { ok: false, imported: 0, updated: 0, errors: ['Shopify is not configured'], message: 'Shopify is not configured' }
  }
  if (!db) {
    return { ok: false, imported: 0, updated: 0, errors: ['Database is not configured'], message: 'Database is not configured' }
  }

  try {
    const raw = await paginate<any>('customers', 'limit=250')
    const existing = await db.select().from(schema.customers)
    const knownByShopifyId = new Map(existing.filter((r) => r.shopifyId).map((r) => [r.shopifyId!, r]))
    const knownByEmail = new Map(existing.filter((r) => r.email).map((r) => [r.email!, r]))
    const knownByPhone = new Map(existing.filter((r) => r.phone).map((r) => [r.phone!, r]))

    let imported = 0
    let updated = 0
    const errors: string[] = []

    for (const c of raw) {
      const shopifyId = String(c.id ?? '')
      const firstName = String(c.first_name ?? '').trim()
      const lastName = String(c.last_name ?? '').trim()
      const name = `${firstName} ${lastName}`.trim() || `Shopify Customer #${shopifyId}`
      const email = c.email ?? null
      const phone = c.phone ?? null
      const city = c.default_address?.city ?? c.addresses?.[0]?.city ?? null
      const province = c.default_address?.province ?? c.addresses?.[0]?.province ?? null
      const ordersCount = Number(c.orders_count ?? 0)
      const totalSpent = Math.round(Number(c.total_spent ?? 0) * 100) / 100
      const joined = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      const verifiedEmail = c.verified_email != null ? Boolean(c.verified_email) : null

      // Match existing customer by shopifyId, email, or phone
      let existingCustomer = knownByShopifyId.get(shopifyId)
      if (!existingCustomer && email) existingCustomer = knownByEmail.get(email)
      if (!existingCustomer && phone) existingCustomer = knownByPhone.get(phone)

      try {
        if (existingCustomer) {
          await db
            .update(schema.customers)
            .set({
              name: existingCustomer.name || name,
              email: email ?? existingCustomer.email,
              phone: phone ?? existingCustomer.phone,
              city: city ?? undefined,
              province: province ?? undefined,
              shopifyId: existingCustomer.shopifyId ?? shopifyId,
              emailVerified: verifiedEmail ?? undefined,
              orders: ordersCount,
              totalSpent,
              status: existingCustomer.status ?? 'active',
            })
            .where(eq(schema.customers.id, existingCustomer.id))
          updated++
        } else {
          await db
            .insert(schema.customers)
            .values({
              id: `C-shop-${shopifyId}`,
              name,
              email,
              phone,
              city: city ?? null,
              province: province ?? null,
              shopifyId,
              emailVerified: verifiedEmail,
              orders: ordersCount,
              totalSpent,
              status: 'active',
              joined,
            })
            .onConflictDoNothing()
          imported++
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Failed to import a customer')
      }
    }

    await persistLog({
      entity: 'Customer',
      direction: 'in',
      action: 'Customers Synced',
      status: 'success',
    })
    return { ok: true, imported, updated, errors }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await persistLog({ entity: 'Customer', direction: 'in', action: 'Customers Synced', status: 'failed', error: msg })
    return { ok: false, imported: 0, updated: 0, errors: [msg], message: 'Shopify customer sync failed' }
  }
}

/**
 * Re-fetch a single order from Shopify by its local row id and update the
 * local copy (customer, value, payment/fulfillment/status, addresses).
 * Used by the "Refresh from Shopify" action on the Orders page.
 */
export async function refreshShopifyOrder(localOrderId: string): Promise<{ ok: boolean; updated?: boolean; message?: string }> {
  if (!isConfigured()) return { ok: false, message: 'Shopify is not configured' }
  if (!db) return { ok: false, message: 'Database is not configured' }

  const [local] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, localOrderId)).limit(1)
  if (!local) return { ok: false, message: 'Order not found locally' }
  const orderNumber = String(local.shopifyId ?? '').replace(/^#/, '')
  if (!orderNumber) return { ok: false, message: 'Order is not linked to Shopify' }

  // Local shopifyId stores the order NAME (e.g. "#1053"), but the REST
  // single-order endpoint needs the numeric REST id. Look up by name first
  // (name query requires status=any to include closed/cancelled orders).
  const matches = await paginate<any>('orders', `status=any&name=${encodeURIComponent(`#${orderNumber}`)}`)
  const restId = matches[0]?.id
  if (!restId) return { ok: false, message: `Order #${orderNumber} not found on Shopify` }

  // Single-order REST endpoint returns { order: {...} } — use shopifyRequest
  // directly (paginate only collects res.json[resource] arrays). apiPath appends
  // .json itself, so pass the bare resource path.
  let res: { json: Record<string, unknown> }
  try {
    res = await shopifyRequest<Record<string, unknown>>(`orders/${restId}`, '')
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 404) return { ok: false, message: `Order #${orderNumber} not found on Shopify` }
    throw err
  }
  const o = (res.json?.order ?? null) as any
  if (!o || (!o.id && !o.name)) return { ok: false, message: `Order #${orderNumber} not found on Shopify` }

  const safeStr = (v: unknown) => (typeof v === 'string' && v !== 'undefined' && v.trim()) ? v.trim() : ''
  const custFirstName = safeStr(o.customer?.first_name) || safeStr(o.billing_address?.first_name) || ''
  const custLastName = safeStr(o.customer?.last_name) || safeStr(o.billing_address?.last_name) || ''
  const customerName = `${custFirstName} ${custLastName}`.trim() || (safeStr(o.customer?.email) || safeStr(o.billing_address?.email) || 'Guest')
  const value = Math.round(Number(o.total_price ?? 0) * 100) / 100
  const items = o.line_items?.reduce((sum: number, li: any) => sum + Number(li.quantity ?? 0), 0) ?? 0
  const payment = mapImportedPayment(o.financial_status)
  const fulfillment = mapImportedFulfillment(o.fulfillment_status)

  const addrFrom = (src: any) => {
    if (!src) return null
    const addr = {
      name: `${safeStr(src.first_name)} ${safeStr(src.last_name)}`.trim(),
      address1: safeStr(src.address1),
      address2: safeStr(src.address2),
      city: safeStr(src.city),
      province: safeStr(src.province),
      zip: safeStr(src.zip),
      country: safeStr(src.country),
      phone: safeStr(src.phone),
    }
    return (addr.name || addr.address1 || addr.city || addr.phone) ? addr : null
  }
  const billingAddress = addrFrom(o.billing_address)
  const shippingAddress = addrFrom(o.shipping_address)

  await db
    .update(schema.salesOrders)
    .set({
      ...(customerName && customerName !== 'Guest' ? { customer: customerName } : {}),
      value,
      payment,
      fulfillment,
      items,
      billingAddress: billingAddress ?? undefined,
      shippingAddress: shippingAddress ?? undefined,
    })
    .where(eq(schema.salesOrders.id, localOrderId))

  addLog('orders', 'success', 1, `Refreshed order #${orderNumber} from Shopify`)
  await persistLog({ entity: 'Order', shopifyId: `#${orderNumber}`, direction: 'in', action: 'Order Refreshed', status: 'success' })
  return { ok: true, updated: true }
}
