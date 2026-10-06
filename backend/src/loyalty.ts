import { randomUUID } from 'node:crypto'
import { desc, eq, or, sql } from 'drizzle-orm'
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

/**
 * Claw back points earned on an invoice that is being returned or cancelled.
 *
 * Points are earned on the full invoice value at creation time, so a later
 * return would otherwise leave the customer holding points for goods they gave
 * back. This writes an `adjust` entry for the value being reversed.
 *
 * Safe to call repeatedly: it only reverses what has not already been
 * reversed for that invoice, so a partial return followed by a larger one
 * tops the reversal up rather than double-counting.
 */
export async function reverseEarnedForInvoice(invoice: {
  id: string
  number: string
  customer: string
  /** Value being reversed (a partial return passes only that amount). */
  value?: number | null
  /** Credit-note / reason recorded on the ledger entry. */
  reason?: string
}): Promise<{ points: number; balanceAfter: number } | null> {
  try {
    if (!isLoyaltyEnabled() || !db) return null
    if (!invoice.customer) return null

    const [customer] = await db
      .select({ id: s.customers.id })
      .from(s.customers)
      .where(eq(s.customers.name, invoice.customer))
      .limit(1)
    if (!customer) return null // walk-in / unmatched — nothing was ever earned

    // Points already earned on this invoice, and how much has been reversed.
    const ledger = await db
      .select({ type: s.loyaltyTransactions.type, points: s.loyaltyTransactions.points })
      .from(s.loyaltyTransactions)
      .where(eq(s.loyaltyTransactions.invoiceId, invoice.id))
    const earned = ledger.filter((t) => t.type === 'earn').reduce((a, t) => a + Number(t.points ?? 0), 0)
    if (earned <= 0) return null
    const reversed = Math.abs(
      ledger
        .filter((t) => t.type === 'adjust')
        .reduce((a, t) => a + Math.min(0, Number(t.points ?? 0)), 0),
    )
    const outstandingPoints = earned - reversed
    if (outstandingPoints <= 0) return null

    // Reverse proportionally to the value being returned when we know it.
    const [invoiceRow] = await db
      .select({ grandTotal: s.salesInvoices.grandTotal })
      .from(s.salesInvoices)
      .where(eq(s.salesInvoices.id, invoice.id))
      .limit(1)
    const grandTotal = Number(invoiceRow?.grandTotal ?? 0)
    let points = outstandingPoints
    if (grandTotal > 0 && invoice.value != null) {
      const share = Math.max(0, Math.min(1, Number(invoice.value) / grandTotal))
      points = Math.floor(outstandingPoints * share)
    }
    if (points <= 0) return null

    return await record({
      customerId: customer.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      type: 'adjust',
      points: -points,
      note: invoice.reason ?? `Reversed on invoice ${invoice.number}`,
    })
  } catch (err) {
    logger.error({ err }, 'loyalty reversal failed (non-fatal)')
    return null
  }
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
  const trimmed = query.trim()
  const digits = trimmed.replace(/\D/g, '')
  // A search may be a name, a phone number, or a name that happens to contain
  // digits ("Rahul 9876543210"). These must be alternatives, not requirements:
  // requiring name AND phone meant any such customer was never found.
  const conditions = [eq(s.customers.name, trimmed)]
  if (digits.length >= 10) {
    conditions.push(eq(s.customers.phone, digits))
    conditions.push(sql`right(regexp_replace(coalesce(${s.customers.phone}, ''), '\D', '', 'g'), 10) = ${digits.slice(-10)}`)
  }
  const [customer] = await db
    .select({ id: s.customers.id, name: s.customers.name, phone: s.customers.phone })
    .from(s.customers)
    .where(or(...conditions))
    .limit(1)
  return customer ?? null
}
