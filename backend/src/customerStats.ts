import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from './db/client'
import * as schema from './db/schema'

export type CustomerStatsSource = 'orders' | 'invoices'

export interface CustomerStatsResult {
  updated: number
  source: CustomerStatsSource
}

/**
 * Recount customers.orders / customers.total_spent from real transaction data.
 *
 * - orders:   count of sales_orders whose `customer` matches the customer name
 * - invoices: count of sales_invoices matching by email (or name fallback),
 *             summing grand_total of non-refunded invoices for total_spent
 *
 * Shopify-imported customers keep their platform-reported orders_count /
 * total_spent (authoritative there), so only local-only customers are
 * recounted when source is 'orders'.
 */
export async function recountCustomerStats(source: CustomerStatsSource = 'orders'): Promise<CustomerStatsResult> {
  if (!db) return { updated: 0, source }

  let updated = 0

  if (source === 'invoices') {
    // Aggregate invoices per customer email (null emails are skipped by the join).
    const invoiceAgg = await db
      .select({
        email: schema.salesInvoices.customerEmail,
        orderCount: sql<number>`count(*)::int`,
        spent: sql<number>`coalesce(sum(case when ${schema.salesInvoices.status} <> 'refunded' then ${schema.salesInvoices.grandTotal} else 0 end), 0)`,
      })
      .from(schema.salesInvoices)
      .where(and(isNotNull(schema.salesInvoices.customerEmail), ne(schema.salesInvoices.customerEmail, '')))
      .groupBy(schema.salesInvoices.customerEmail)

    const byEmail = new Map(invoiceAgg.map((r) => [String(r.email).toLowerCase(), r]))

    const customers = await db
      .select({ id: schema.customers.id, email: schema.customers.email })
      .from(schema.customers)
      .where(and(isNotNull(schema.customers.email), ne(schema.customers.email, '')))

    for (const c of customers) {
      const agg = byEmail.get(String(c.email).toLowerCase())
      if (!agg) continue
      await db
        .update(schema.customers)
        .set({ orders: agg.orderCount, totalSpent: Math.round(Number(agg.spent) * 100) / 100 })
        .where(eq(schema.customers.id, c.id))
      updated++
    }
    return { updated, source }
  }

  // source === 'orders': local-only customers recount from sales_orders by name.
  const orderAgg = await db
    .select({
      name: schema.salesOrders.customer,
      orderCount: sql<number>`count(*)::int`,
      spent: sql<number>`coalesce(sum(${schema.salesOrders.value}), 0)`,
    })
    .from(schema.salesOrders)
    .where(and(isNotNull(schema.salesOrders.customer), ne(schema.salesOrders.customer, '')))
    .groupBy(schema.salesOrders.customer)

  const byName = new Map(orderAgg.map((r) => [String(r.name), r]))

  const customers = await db
    .select({ id: schema.customers.id, name: schema.customers.name, shopifyId: schema.customers.shopifyId })
    .from(schema.customers)

  for (const c of customers) {
    if (c.shopifyId) continue // Shopify customers keep platform-reported stats
    const agg = byName.get(c.name)
    const orders = agg?.orderCount ?? 0
    const spent = Math.round(Number(agg?.spent ?? 0) * 100) / 100
    await db
      .update(schema.customers)
      .set({ orders, totalSpent: spent })
      .where(eq(schema.customers.id, c.id))
    updated++
  }

  return { updated, source }
}

/** Convenience: recount across both sources in one call. */
export async function recountCustomerStatsBoth(): Promise<{ orders: number; invoices: number }> {
  const a = await recountCustomerStats('orders')
  const b = await recountCustomerStats('invoices')
  return { orders: a.updated, invoices: b.updated }
}
