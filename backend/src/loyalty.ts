import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from './db/client'
import * as s from './db/schema'
import { logger } from './logger'

/**
 * Loyalty points — earn 1 point per ₹100 spent on invoices, redeem 1 point
 * = ₹1 at billing. Points are per-customer; balances are computed from the
 * ledger (loyalty_transactions) so nothing can drift.
 */

export const POINTS_PER = 100 // ₹ spent per 1 point earned
export const POINT_VALUE = 1 // ₹ value of 1 point

export function isLoyaltyEnabled(): boolean {
  return process.env.LOYALTY_ENABLED !== 'false'
}

/** Current point balance for a customer (sum of ledger). */
export async function getBalance(customerId: string): Promise<number> {
  if (!db) return 0
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${s.loyaltyTransactions.points}), 0)` })
    .from(s.loyaltyTransactions)
    .where(eq(s.loyaltyTransactions.customerId, customerId))
  return Number(row?.total ?? 0)
}

/** Record a ledger entry and return the resulting balance. */
async function record(entry: {
  customerId: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  type: 'earn' | 'redeem' | 'adjust'
  points: number
  note?: string | null
  createdBy?: string | null
}): Promise<{ points: number; balanceAfter: number }> {
  if (!db) throw new Error('Database unavailable')
  const balanceAfter = (await getBalance(entry.customerId)) + entry.points
  await db.insert(s.loyaltyTransactions).values({
    id: randomUUID(),
    customerId: entry.customerId,
    invoiceId: entry.invoiceId ?? null,
    invoiceNumber: entry.invoiceNumber ?? null,
    type: entry.type,
    points: entry.points,
    balanceAfter,
    note: entry.note ?? null,
    createdBy: entry.createdBy ?? null,
  })
  return { points: entry.points, balanceAfter }
}

/**
 * Award points for an invoice — called after invoice creation. Fire-and-forget
 * friendly (callers should catch), matches by customer name (same as orders).
 * Returns null when the customer isn't found or loyalty is disabled.
 */
export async function earnForInvoice(invoice: {
  id: string
  number: string
  customer: string
  grandTotal: number | string | null
  status?: string | null
}): Promise<{ points: number; balanceAfter: number } | null> {
  try {
    if (!isLoyaltyEnabled() || !db) return null
    if (invoice.status === 'cancelled' || invoice.status === 'refunded') return null
    const spent = Number(invoice.grandTotal ?? 0)
    if (!(spent > 0)) return null

    const [customer] = await db
      .select({ id: s.customers.id })
      .from(s.customers)
      .where(eq(s.customers.name, invoice.customer))
      .limit(1)
    if (!customer) return null // walk-in / unmatched customer — no points

    const points = Math.floor(spent / POINTS_PER)
    if (points <= 0) return null
    return await record({
      customerId: customer.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      type: 'earn',
      points,
      note: `Earned on invoice ${invoice.number}`,
    })
  } catch (err) {
    logger.error({ err }, 'loyalty earn failed (non-fatal)')
    return null
  }
}

/**
 * Redeem points at billing time. Fails (returns error string) when the
 * balance is insufficient — the caller decides whether to block or continue.
 */
export async function redeem(
  customerId: string,
  points: number,
  opts: { invoiceId?: string; invoiceNumber?: string; createdBy?: string } = {},
): Promise<{ ok: true; balanceAfter: number } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: 'Database unavailable' }
  if (!(points > 0)) return { ok: false, error: 'Points to redeem must be positive' }
  const balance = await getBalance(customerId)
  if (balance < points) {
    return { ok: false, error: `Insufficient points: balance ${balance}, requested ${points}` }
  }
  const { balanceAfter } = await record({
    customerId,
    invoiceId: opts.invoiceId ?? null,
    invoiceNumber: opts.invoiceNumber ?? null,
    type: 'redeem',
    points: -points,
    note: opts.invoiceNumber ? `Redeemed on invoice ${opts.invoiceNumber}` : 'Redeemed at billing',
    createdBy: opts.createdBy ?? null,
  })
  return { ok: true, balanceAfter }
}

/** Manual adjust (admin correction). */
export async function adjust(
  customerId: string,
  points: number,
  note: string,
  createdBy?: string,
): Promise<{ points: number; balanceAfter: number }> {
  return record({ customerId, type: 'adjust', points, note, createdBy: createdBy ?? null })
}

/** Ledger history for a customer, newest first. */
export async function history(customerId: string, limit = 50) {
  if (!db) return []
  return db
    .select()
    .from(s.loyaltyTransactions)
    .where(eq(s.loyaltyTransactions.customerId, customerId))
    .orderBy(desc(s.loyaltyTransactions.date))
    .limit(limit)
}

/** Resolve a customer by id, name, or phone (for billing lookup). */
export async function findCustomer(query: string) {
  if (!db) return null
  const digits = query.replace(/\D/g, '')
  const conditions = [eq(s.customers.name, query)]
  if (digits.length >= 10) conditions.push(eq(s.customers.phone, digits))
  const [customer] = await db
    .select({ id: s.customers.id, name: s.customers.name, phone: s.customers.phone })
    .from(s.customers)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .limit(1)
  return customer ?? null
}
