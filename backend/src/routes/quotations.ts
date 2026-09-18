import { desc, eq, sql } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db/client'
import * as s from '../db/schema'
import { requirePermission } from '../rbac'
import { num, round2 } from './db'

type Handler = (req: Request, res: Response, next: NextFunction) => unknown

interface RouteRegistrar {
  get: (path: string, ...handlers: Handler[]) => void
  post: (path: string, ...handlers: Handler[]) => void
  patch: (path: string, ...handlers: Handler[]) => void
  delete: (path: string, ...handlers: Handler[]) => void
}

/**
 * Quotations — pre-sale estimates that convert into tax invoices.
 *
 * Routes (mounted under /api/v1/db/quotations by routes/db.ts):
 *   GET    /quotations            list (paginated)
 *   GET    /quotations/:id        one (with items)
 *   POST   /quotations            create
 *   PATCH  /quotations/:id        update (replaces items when provided)
 *   DELETE /quotations/:id        delete
 *   POST   /quotations/:id/convert  convert into a real tax invoice (no stock movement
 *                                  until conversion; conversion mirrors manual invoices)
 */

const QUOTE_PREFIX = 'QT-'

async function nextQuotationNumber(): Promise<string> {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${QUOTE_PREFIX}${stamp}${Math.floor(1000 + Math.random() * 9000)}`
    const [clash] = await db!
      .select({ id: s.quotations.id })
      .from(s.quotations)
      .where(eq(s.quotations.number, candidate))
      .limit(1)
    if (!clash) return candidate
  }
  throw new Error('Could not generate a unique quotation number')
}

function normalizeQuotationItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((it) => {
      const item = it && typeof it === 'object' ? (it as Record<string, unknown>) : {}
      const weight = num(item.weight, 0)
      const silverRate = num(item.silverRate, 0)
      const makingCharge = num(item.makingCharge, 0)
      const qty = Math.max(1, Math.floor(num(item.qty, 1)))
      const amount =
        weight > 0 && silverRate > 0
          ? round2(weight * silverRate + makingCharge)
          : num(item.amount, 0)
      return {
        product: String(item.product ?? item.title ?? '').trim(),
        sku: String(item.sku ?? '').trim(),
        qty,
        weight,
        silverRate,
        makingCharge,
        amount,
      }
    })
    .filter((it) => it.sku !== '' || it.product !== '')
}

function computeTotals(items: Array<Record<string, unknown>>, gstRate: number, discount: number) {
  const subtotal = round2(items.reduce((a, it) => a + num(it.amount, 0), 0))
  const gstAmount = round2((subtotal * gstRate) / 100)
  const grandTotal = round2(subtotal + gstAmount - discount)
  return { subtotal, gstAmount, grandTotal }
}

function sanitizeCustomer(body: Record<string, unknown>) {
  return {
    customer: String(body.customer ?? '').trim() || null,
    customerPhone: String(body.customerPhone ?? body.phone ?? '').trim() || null,
    customerEmail: String(body.customerEmail ?? body.email ?? '').trim() || null,
    customerAddress: String(body.customerAddress ?? body.address ?? '').trim() || null,
    customerCity: String(body.customerCity ?? body.city ?? '').trim() || null,
    customerState: String(body.customerState ?? body.state ?? '').trim() || null,
    customerPincode: String(body.customerPincode ?? body.pincode ?? '').trim() || null,
    notes: String(body.notes ?? '').trim() || null,
    validUntil: body.validUntil ? String(body.validUntil) : null,
  }
}

export function registerQuotationRoutes(router: RouteRegistrar) {
  router.get('/quotations', requirePermission('sales', 'view'), async (_req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const quotes = await db.select().from(s.quotations).orderBy(desc(s.quotations.date)).limit(200)
      res.json({ page: 1, pageSize: 200, total: quotes.length, data: quotes })
    } catch {
      res.status(500).json({ error: 'Failed to list quotations' })
    }
  })

  router.get('/quotations/:id', requirePermission('sales', 'view'), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const [quote] = await db.select().from(s.quotations).where(eq(s.quotations.id, req.params.id)).limit(1)
      if (!quote) { res.status(404).json({ error: 'Not found' }); return }
      const items = await db.select().from(s.quotationItems).where(eq(s.quotationItems.quotationId, quote.id))
      res.json({ ...quote, items })
    } catch {
      res.status(500).json({ error: 'Failed to load quotation' })
    }
  })

  router.post('/quotations', requirePermission('sales', 'create'), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>
      const items = normalizeQuotationItems(body.items)
      if (items.length === 0) { res.status(400).json({ error: 'At least one line item is required' }); return }
      const gstRate = num(body.gst, 3)
      const discount = num(body.discount, 0)
      const { subtotal, gstAmount, grandTotal } = computeTotals(items, gstRate, discount)
      const number = await nextQuotationNumber()
      const id = randomUUID()

      const row = await db.transaction(async (tx) => {
        const [created] = await tx.insert(s.quotations).values({
          id,
          number,
          ...sanitizeCustomer(body),
          subtotal,
          gst: gstRate,
          gstAmount,
          discount,
          grandTotal,
          status: 'draft',
          createdBy: (req as Request & { userId?: string }).userId ?? null,
        }).returning()
        for (const it of items) {
          await tx.insert(s.quotationItems).values({ ...it, id: randomUUID(), quotationId: id })
        }
        return created
      })
      res.status(201).json({ ...row, items })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      res.status(400).json({ error: msg.includes('unique') ? 'Quotation number clash, retry' : 'Failed to create quotation' })
    }
  })

  router.patch('/quotations/:id', requirePermission('sales', 'edit'), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>
      const [existing] = await db.select().from(s.quotations).where(eq(s.quotations.id, req.params.id)).limit(1)
      if (!existing) { res.status(404).json({ error: 'Not found' }); return }
      if (existing.convertedInvoice) { res.status(400).json({ error: 'Quotation already converted to an invoice' }); return }

      const clean = sanitizeCustomer(body)
      const items = normalizeQuotationItems(body.items)
      const gstRate = num(body.gst, num(existing.gst, 3))
      const discount = num(body.discount, num(existing.discount, 0))
      let totals = {
        subtotal: num(existing.subtotal, 0),
        gstAmount: num(existing.gstAmount, 0),
        grandTotal: num(existing.grandTotal, 0),
      }
      if (items.length > 0) totals = computeTotals(items, gstRate, discount)

      const [row] = await db.update(s.quotations).set({
        ...clean,
        gst: gstRate,
        discount,
        ...totals,
        updatedAt: new Date().toISOString(),
      }).where(eq(s.quotations.id, req.params.id)).returning()

      if (items.length > 0) {
        await db.delete(s.quotationItems).where(eq(s.quotationItems.quotationId, req.params.id))
        for (const it of items) {
          await db.insert(s.quotationItems).values({ ...it, id: randomUUID(), quotationId: req.params.id })
        }
      }
      const freshItems = await db.select().from(s.quotationItems).where(eq(s.quotationItems.quotationId, req.params.id))
      res.json({ ...row, items: freshItems })
    } catch {
      res.status(400).json({ error: 'Failed to update quotation' })
    }
  })

  router.delete('/quotations/:id', requirePermission('sales', 'delete'), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const [existing] = await db.select().from(s.quotations).where(eq(s.quotations.id, req.params.id)).limit(1)
      if (!existing) { res.status(404).json({ error: 'Not found' }); return }
      await db.delete(s.quotationItems).where(eq(s.quotationItems.quotationId, req.params.id))
      await db.delete(s.quotations).where(eq(s.quotations.id, req.params.id))
      res.json({ ok: true, id: req.params.id })
    } catch {
      res.status(500).json({ error: 'Failed to delete quotation' })
    }
  })

  router.post('/quotations/:id/convert', requirePermission('sales', 'create'), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const [quote] = await db.select().from(s.quotations).where(eq(s.quotations.id, req.params.id)).limit(1)
      if (!quote) { res.status(404).json({ error: 'Not found' }); return }
      if (quote.convertedInvoice) {
        res.status(400).json({ error: `Already converted to ${quote.convertedInvoice}` })
        return
      }
      const items = await db.select().from(s.quotationItems).where(eq(s.quotationItems.quotationId, quote.id))
      if (items.length === 0) { res.status(400).json({ error: 'Quotation has no line items' }); return }

      // Build invoice items (same shape as manual invoice items)
      const invoiceItems = items.map((it) => ({
        product: it.product ?? '',
        sku: it.sku ?? '',
        qty: it.qty ?? 1,
        weight: it.weight ?? 0,
        silverRate: it.silverRate ?? 0,
        makingCharge: it.makingCharge ?? 0,
        tax: 0,
        amount: it.amount ?? 0,
      }))

      // Reuse the manual invoice numbering + creation logic by inserting directly
      const { default: crypto } = await import('node:crypto')
      const [settingsRow] = await db.select().from(s.settings).where(eq(s.settings.id, 'app')).limit(1)
      const gstRate = num(quote.gst, Number(settingsRow?.gstRate ?? 3))
      const prefix = settingsRow?.invoicePrefix?.trim() || 'INV-'
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      let invoiceNumber = ''
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = `${prefix}${stamp}${Math.floor(1000 + Math.random() * 9000)}`
        const [clash] = await db.select({ id: s.salesInvoices.id }).from(s.salesInvoices).where(eq(s.salesInvoices.number, candidate)).limit(1)
        if (!clash) { invoiceNumber = candidate; break }
      }
      if (!invoiceNumber) { res.status(500).json({ error: 'Could not generate invoice number' }); return }

      const subtotal = round2(invoiceItems.reduce((a, it) => a + (it.amount ?? 0), 0))
      const gstAmount = round2((subtotal * gstRate) / 100)
      const discount = num(quote.discount, 0)
      const grandTotal = round2(subtotal + gstAmount - discount)

      const invoiceId = crypto.randomUUID()
      await db.transaction(async (tx) => {
        await tx.insert(s.salesInvoices).values({
          id: invoiceId,
          number: invoiceNumber,
          customer: quote.customer,
          customerEmail: quote.customerEmail ?? '',
          customerPhone: quote.customerPhone ?? '',
          customerAddress: quote.customerAddress ?? '',
          customerCity: quote.customerCity ?? '',
          customerState: quote.customerState ?? '',
          customerPincode: quote.customerPincode ?? '',
          silverValue: round2(invoiceItems.reduce((a, it) => a + (it.weight ?? 0) * (it.silverRate ?? 0), 0)),
          makingCharge: round2(invoiceItems.reduce((a, it) => a + (it.makingCharge ?? 0), 0)),
          subtotal,
          gst: gstRate,
          gstAmount,
          discount,
          grandTotal,
          paymentMethod: 'Pending',
          paymentStatus: 'pending',
          status: 'issued',
          date: new Date().toISOString(),
        })
        for (const it of invoiceItems) {
          await tx.insert(s.salesInvoiceItems).values({ ...it, id: crypto.randomUUID(), invoiceId })
          // Deduct stock, same rule as manual invoices (no deduction while it was only a quote)
          const sku = String(it.sku ?? '')
          const qty = Number(it.qty ?? 0)
          if (sku && qty) {
            await tx
              .update(s.products)
              .set({ stock: sql`${s.products.stock} - ${qty}` })
              .where(eq(s.products.sku, sku))
          }
        }
        await tx.update(s.quotations).set({
          status: 'converted',
          convertedInvoice: invoiceNumber,
          convertedAt: new Date().toISOString(),
        }).where(eq(s.quotations.id, quote.id))
      })

      res.status(201).json({ ok: true, invoiceNumber, invoiceId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('Insufficient stock')) { res.status(400).json({ error: msg }); return }
      res.status(500).json({ error: 'Failed to convert quotation' })
    }
  })
}
