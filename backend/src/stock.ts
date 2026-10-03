/**
 * The single write path for stock.
 *
 * Stock used to be mutated in six or seven unrelated places, each doing its own
 * arithmetic on products.stock. That left no way to answer "why is this
 * number what it is" — a stock count silently overwrote a purchase, a transfer
 * record moved nothing, and no report could show anything but the current
 * balance.
 *
 * Every change now goes through applyStockMovement, which writes an append-only
 * stock_movements row and maintains stock_levels per location. products.stock
 * stays as the rollup across locations, so existing reports keep working.
 */
import { and, eq, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from './db/client'
import * as schema from './db/schema'

/** Anything the app can do to a stock balance. */
export type MovementType =
  | 'purchase_in'
  | 'purchase_return_out'
  | 'sale_out'
  | 'sale_return_in'
  | 'transfer_in'
  | 'transfer_out'
  | 'count_adjust'
  | 'shopify_sync'
  | 'opening'
  | 'manual'

export const DEFAULT_LOCATION_ID = 'LOC-DEFAULT'
export const DEFAULT_LOCATION_NAME = 'Main Store'

export type Tx = Parameters<Parameters<NonNullable<typeof db>['transaction']>[0]>[0]
type Client = Tx | NonNullable<typeof db>

export interface StockMovementInput {
  sku: string
  /** Signed quantity: positive adds stock, negative removes it. */
  qty: number
  type: MovementType
  locationId?: string | null
  /** Unit cost for valuation; also revalues the weighted average on stock-in. */
  unitCost?: number
  refType?: string
  refId?: string
  note?: string
  createdBy?: string
  tx?: Tx
}

function newId(): string {
  return `SM-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Creates the default location if missing.
 *
 * Stock predates locations, so every existing balance has to land somewhere.
 * Rather than a backfill that guesses, the default location is seeded on demand
 * and the first movement for a product claims its whole existing balance —
 * that is what it was physically there before locations existed.
 */
export async function ensureDefaultLocation(tx?: Tx): Promise<string> {
  const client = (tx ?? db) as Client
  if (!client) return DEFAULT_LOCATION_ID
  const [existing] = await client
    .select({ id: schema.inventoryLocations.id })
    .from(schema.inventoryLocations)
    .where(eq(schema.inventoryLocations.id, DEFAULT_LOCATION_ID))
    .limit(1)
  if (existing) return DEFAULT_LOCATION_ID
  await client
    .insert(schema.inventoryLocations)
    .values({ id: DEFAULT_LOCATION_ID, name: DEFAULT_LOCATION_NAME, type: 'store' })
    .onConflictDoNothing()
  return DEFAULT_LOCATION_ID
}

/**
 * Applies one stock movement.
 *
 * Returns the product's new total across all locations, or null when the SKU
 * is unknown or the quantity nets to zero. Safe to call inside a transaction:
 * pass `tx` so the movement commits or rolls back with the document that caused
 * it.
 */
export async function applyStockMovement(input: StockMovementInput): Promise<number | null> {
  const { sku, type } = input
  const qty = Math.floor(num(input.qty))
  if (!sku || qty === 0) return null

  const client = (input.tx ?? db) as Client
  if (!client) return null
  const locationId = input.locationId ?? (await ensureDefaultLocation(input.tx))

  // Lock the product so two concurrent movements cannot interleave their
  // balance arithmetic.
  const [row] = await client
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      stock: schema.products.stock,
      costPrice: schema.products.costPrice,
    })
    .from(schema.products)
    .where(eq(schema.products.sku, sku))
    .limit(1)
    .for('update')
  if (!row) return null

  const [level] = await client
    .select({ qty: schema.stockLevels.qty })
    .from(schema.stockLevels)
    .where(and(eq(schema.stockLevels.productId, row.id), eq(schema.stockLevels.locationId, locationId)))
    .limit(1)

  const isFirstAtLocation = !level

  // Only the default location inherits the pre-ledger balance. A genuinely new
  // location starts empty — otherwise the first transfer into it would adopt
  // the whole existing stock and double-count it.
  let currentAtLocation = isFirstAtLocation ? 0 : num(level.qty)
  if (isFirstAtLocation && locationId === DEFAULT_LOCATION_ID) {
    const [anywhere] = await client
      .select({ locationId: schema.stockLevels.locationId })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.productId, row.id))
      .limit(1)
    // Product has never moved through the ledger: products.stock predates it,
    // so that balance physically belongs to the default location.
    if (!anywhere) currentAtLocation = num(row.stock)
  }
  const nextAtLocation = currentAtLocation + qty

  if (isFirstAtLocation) {
    await client
      .insert(schema.stockLevels)
      .values({ productId: row.id, locationId, qty: nextAtLocation })
      .onConflictDoUpdate({
        target: [schema.stockLevels.productId, schema.stockLevels.locationId],
        set: { qty: nextAtLocation },
      })
  } else {
    await client
      .update(schema.stockLevels)
      .set({ qty: nextAtLocation })
      .where(and(eq(schema.stockLevels.productId, row.id), eq(schema.stockLevels.locationId, locationId)))
  }

  // products.stock is the rollup, so reports that read it directly stay right.
  const [total] = await client
    .select({ qty: sql<number>`coalesce(sum(${schema.stockLevels.qty}), 0)` })
    .from(schema.stockLevels)
    .where(eq(schema.stockLevels.productId, row.id))

  const patch: Record<string, unknown> = { stock: Math.floor(num(total?.qty)) }

  // Weighted-average cost, maintained on the way in only. Removing stock does
  // not revalue: the remaining units keep the average they were bought at.
  const unitCost = num(input.unitCost)
  if (qty > 0 && unitCost > 0) {
    const oldStock = num(row.stock)
    const oldCost = num(row.costPrice)
    const newStock = oldStock + qty
    // Stock on hand but no cost recorded: adopt the buy price rather than
    // averaging against a meaningless zero.
    patch.costPrice = round2(oldStock > 0 && oldCost > 0 ? (oldStock * oldCost + qty * unitCost) / newStock : unitCost)
  }

  await client.update(schema.products).set(patch as never).where(eq(schema.products.id, row.id))

  await client.insert(schema.stockMovements).values({
    id: newId(),
    productId: row.id,
    sku: row.sku ?? sku,
    locationId,
    type,
    qty,
    stockAfter: nextAtLocation,
    unitCost: unitCost > 0 ? round2(unitCost) : null,
    refType: input.refType,
    refId: input.refId,
    note: input.note,
    createdBy: input.createdBy,
    date: new Date().toISOString(),
  })

  return Math.floor(num(total?.qty))
}

/**
 * Moves stock between two locations as a matched pair of movements, so each
 * location's ledger shows its own side and neither total changes.
 */
export async function transferStock(input: {
  sku: string
  qty: number
  fromLocationId: string
  toLocationId: string
  refType?: string
  refId?: string
  createdBy?: string
  note?: string
  tx?: Tx
}): Promise<number | null> {
  const qty = Math.floor(num(input.qty))
  if (!input.sku || qty <= 0 || input.fromLocationId === input.toLocationId) return null

  const source = await applyStockMovement({
    sku: input.sku,
    qty: -qty,
    type: 'transfer_out',
    locationId: input.fromLocationId,
    refType: input.refType,
    refId: input.refId,
    createdBy: input.createdBy,
    note: input.note,
    tx: input.tx,
  })
  if (source === null) return null

  await applyStockMovement({
    sku: input.sku,
    qty,
    type: 'transfer_in',
    locationId: input.toLocationId,
    refType: input.refType,
    refId: input.refId,
    createdBy: input.createdBy,
    note: input.note,
    tx: input.tx,
  })
  return source
}

/** Stock on hand at one location (or across all of them when omitted). */
export async function stockAt(sku: string, locationId?: string | null): Promise<number> {
  if (!db) return 0
  const [row] = await db
    .select({ qty: sql<number>`coalesce(sum(${schema.stockLevels.qty}), 0)` })
    .from(schema.stockLevels)
    .innerJoin(schema.products, eq(schema.products.id, schema.stockLevels.productId))
    .where(locationId ? eq(schema.stockLevels.locationId, locationId) : eq(schema.products.sku, sku))
  return Math.floor(num(row?.qty))
}