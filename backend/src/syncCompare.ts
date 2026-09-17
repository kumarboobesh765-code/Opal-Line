import { db } from './db/client'
import * as schema from './db/schema'
import { desc } from 'drizzle-orm'
import { store } from './shopify'
import { isConfigured } from './config'
import { logger } from './logger'

function normalizeKey(text: string): string {
  return String(text ?? '').replace(/[^a-z0-9]/g, '').toLowerCase()
}

/**
 * Product Sync comparison — side-by-side view of local products vs the live
 * Shopify catalog, matched by SKU (with compact-key fallback like the other
 * sync flows). Pure read-only: never mutates either side.
 */

export interface ProductSyncRow {
  localId: string
  sku: string
  name: string
  localPrice: number | null
  shopifyPrice: number | null
  priceDelta: number | null
  localStock: number | null
  shopifyStock: number | null
  stockDelta: number | null
  shopifyId: number | null
  shopifyStatus: string | null
  localStatus: string | null
  localUpdatedAt: string | null
  shopifyUpdatedAt: string | null
  /** in-sync | price-diff | stock-diff | both-diff | local-only | shopify-only */
  state: string
}

function newState(hasPriceDiff: boolean, hasStockDiff: boolean): string {
  if (hasPriceDiff && hasStockDiff) return 'both-diff'
  if (hasPriceDiff) return 'price-diff'
  if (hasStockDiff) return 'stock-diff'
  return 'in-sync'
}

export async function compareProductsWithShopify(): Promise<{ ok: boolean; rows: ProductSyncRow[]; syncedAt: string | null; error?: string }> {
  if (!isConfigured()) return { ok: false, rows: [], syncedAt: null, error: 'Shopify is not configured' }
  if (!db) return { ok: false, rows: [], syncedAt: null, error: 'Database is not configured' }

  // Fresh catalog fetch using the sync pipeline (ensureSynced refreshes the
  // shared store when stale), then compare against local rows.
  try {
    const { ensureSynced } = await import('./shopify')
    await ensureSynced('products')
  } catch (err) {
    logger.warn({ err }, 'syncCompare: product fetch failed')
    return { ok: false, rows: [], syncedAt: null, error: err instanceof Error ? err.message : 'Fetch failed' }
  }

  return buildComparison()
}

async function buildComparison(): Promise<{ ok: boolean; rows: ProductSyncRow[]; syncedAt: string | null; error?: string }> {
  if (!db) return { ok: false, rows: [], syncedAt: null, error: 'Database is not configured' }

  const locals = await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      sku: schema.products.sku,
      sellingPrice: schema.products.sellingPrice,
      stock: schema.products.stock,
      shopifyId: schema.products.shopifyId,
      shopifyStatus: schema.products.shopifyStatus,
      status: schema.products.status,
      createdAt: schema.products.createdAt,
    })
    .from(schema.products)
    .orderBy(desc(schema.products.createdAt))
    .limit(2000)

  const bySku = new Map<string, ReturnType<typeof shapeShopifyProduct>>()
  const bySkuCompact = new Map<string, ReturnType<typeof shapeShopifyProduct>>()
  const usedShopifyIds = new Set<number>()

  for (const p of store.products) {
    if (!p.sku) continue
    const shaped = shapeShopifyProduct(p)
    const key = p.sku.trim().toLowerCase()
    const existing = bySku.get(key)
    if (!existing) {
      bySku.set(key, shaped)
      bySkuCompact.set(normalizeKey(key), shaped)
    }
  }

  const rows: ProductSyncRow[] = []
  const matchedLocal = new Set<string>()

  for (const l of locals) {
    const skuKey = String(l.sku ?? '').trim().toLowerCase()
    const shop = skuKey ? bySku.get(skuKey) ?? bySkuCompact.get(normalizeKey(skuKey)) : undefined
    if (shop) {
      matchedLocal.add(skuKey)
      usedShopifyIds.add(shop.shopifyId)
      const localPrice = l.sellingPrice == null ? null : Number(l.sellingPrice)
      const shopPrice = shop.price
      const priceDelta = localPrice != null && shopPrice != null ? Number((shopPrice - localPrice).toFixed(2)) : null
      const hasPriceDiff = priceDelta != null && Math.abs(priceDelta) >= 0.01
      const localStock = l.stock == null ? null : Number(l.stock)
      const stockDelta = localStock != null && shop.stock != null ? shop.stock - localStock : null
      const hasStockDiff = stockDelta != null && stockDelta !== 0

      rows.push({
        localId: l.id,
        sku: l.sku ?? '',
        name: l.name,
        localPrice,
        shopifyPrice: shopPrice,
        priceDelta,
        localStock,
        shopifyStock: shop.stock,
        stockDelta,
        shopifyId: shop.shopifyId,
        shopifyStatus: shop.status,
        localStatus: l.status,
        localUpdatedAt: l.createdAt ?? null,
        shopifyUpdatedAt: shop.updatedAt,
        state: newState(hasPriceDiff, hasStockDiff),
      })
    } else {
      rows.push({
        localId: l.id,
        sku: l.sku ?? '',
        name: l.name,
        localPrice: l.sellingPrice == null ? null : Number(l.sellingPrice),
        shopifyPrice: null,
        priceDelta: null,
        localStock: l.stock == null ? null : Number(l.stock),
        shopifyStock: null,
        stockDelta: null,
        shopifyId: l.shopifyId ? Number(l.shopifyId) : null,
        shopifyStatus: l.shopifyStatus,
        localStatus: l.status,
        localUpdatedAt: l.createdAt ?? null,
        shopifyUpdatedAt: null,
        state: 'local-only',
      })
    }
  }

  // Shopify-only products (not matched to any local row)
  for (const p of store.products) {
    if (!p.sku) continue
    const key = p.sku.trim().toLowerCase()
    if (matchedLocal.has(key)) continue
    if (usedShopifyIds.has(p.id)) continue
    const shaped = shapeShopifyProduct(p)
    rows.push({
      localId: '',
      sku: p.sku,
      name: p.title,
      localPrice: null,
      shopifyPrice: shaped.price,
      priceDelta: null,
      localStock: null,
      shopifyStock: shaped.stock,
      stockDelta: null,
      shopifyId: shaped.shopifyId,
      shopifyStatus: shaped.status,
      localStatus: null,
      localUpdatedAt: null,
      shopifyUpdatedAt: shaped.updatedAt,
      state: 'shopify-only',
    })
  }

  // Sort: diffs first, then local-only/shopify-only, then in-sync
  const order: Record<string, number> = { 'both-diff': 0, 'price-diff': 1, 'stock-diff': 2, 'local-only': 3, 'shopify-only': 4, 'in-sync': 5 }
  rows.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.sku.localeCompare(b.sku))

  return { ok: true, rows, syncedAt: store.lastSync.products ?? null }
}

function shapeShopifyProduct(p: { id: number; title: string; sku: string; price: string; status: string; inventoryQuantity: number; updatedAt: string }) {
  return {
    shopifyId: p.id,
    title: p.title,
    price: p.price == null ? null : Number(p.price),
    stock: p.inventoryQuantity,
    status: p.status,
    updatedAt: p.updatedAt,
  }
}
