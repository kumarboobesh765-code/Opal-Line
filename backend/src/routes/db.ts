import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import argon2 from 'argon2'
import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db, schema, checkDbHealth } from '../db/client'
import { requirePermission } from '../rbac'
import { actorFromRequest, moduleLabel, recordActivity } from '../activity'
import { encrypt, decrypt, mask, encryptSecret } from '../lib/crypto'
import { isConfigured as isShopifyConfigured, config as shopifyConfig, normalizeShopDomain } from '../config'
import { upsertEnvVar } from '../lib/envfile'
import { logger } from '../logger'

export const dbRouter = Router()

function requireDb(res: Response) {
  if (!db) {
    res.status(503).json({ error: 'Service temporarily unavailable' })
    return false
  }
  return true
}

const COLUMNS_KEY = Symbol.for('drizzle:Columns')

function columnsOf(table: any): string[] {
  const cols = table?.[COLUMNS_KEY] ?? table
  return Object.keys(cols)
}

function sanitize(body: Record<string, unknown>, table: any): Record<string, unknown> {
  const allowed = new Set(columnsOf(table))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body ?? {})) {
    if (allowed.has(key)) out[key] = value
  }
  // Stock/price floors: the transactional order/invoice paths guard stock with
  // row locks, but direct product writes must never push stock or prices negative.
  if (table === s.products) {
    if (out.stock !== undefined) {
      const n = Number(out.stock)
      if (!Number.isFinite(n) || n < 0) throw new Error('Stock cannot be negative')
      out.stock = Math.floor(n)
    }
    if (out.reorderLevel !== undefined) {
      const n = Number(out.reorderLevel)
      if (!Number.isFinite(n) || n < 0) throw new Error('Reorder level cannot be negative')
      out.reorderLevel = Math.floor(n)
    }
    for (const priceField of ['sellingPrice', 'compareAtPrice', 'costPrice', 'silverRate', 'makingCharge'] as const) {
      if (out[priceField] !== undefined) {
        const n = Number(out[priceField])
        if (!Number.isFinite(n) || n < 0) throw new Error(`${priceField} cannot be negative`)
        out[priceField] = n
      }
    }
  }
  return out
}

function stripHash<T extends Record<string, unknown>>(row: T): T {
  if (row && 'passwordHash' in row) {
    const { passwordHash, resetToken, resetTokenExpiry, emailVerificationToken, emailVerificationExpiry, ...rest } = row
    void passwordHash; void resetToken; void resetTokenExpiry; void emailVerificationToken; void emailVerificationExpiry
    return rest as T
  }
  return row
}

const PASSWORD_RULES: Array<[RegExp, string]> = [
  [/[A-Z]/, 'Password must contain at least one uppercase letter'],
  [/[a-z]/, 'Password must contain at least one lowercase letter'],
  [/[0-9]/, 'Password must contain at least one number'],
  [/[^A-Za-z0-9]/, 'Password must contain at least one special character'],
]

export function assertStrongPassword(pwd: string): void {
  if (pwd.length < 8) throw new Error('Password must be at least 8 characters')
  if (pwd.length > 255) throw new Error('Password must not exceed 255 characters')
  for (const [pattern, message] of PASSWORD_RULES) {
    if (!pattern.test(pwd)) throw new Error(message)
  }
}

async function prepareUserBody(body: Record<string, unknown>, isUpdate = false): Promise<Record<string, unknown>> {
  const cleaned = sanitize(body, schema.users)
  delete cleaned.passwordHash
  const raw = body ?? {}
  const password = raw.password
  if (password != null && password !== '') {
    const pwd = String(password)
    assertStrongPassword(pwd)
    cleaned.passwordHash = await argon2.hash(pwd, { type: argon2.argon2id })
  }
  if (isUpdate && password == null) delete cleaned.passwordHash
  delete cleaned.password
  return cleaned
}

function num(value: unknown, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function maskBankAccount(row: Record<string, unknown>): Record<string, unknown> {
  if (!row || row.account_number_encrypted == null) return row
  try {
    const full = decrypt(String(row.account_number_encrypted))
    row.accountNumber = mask(full)
  } catch {
    row.accountNumber = '••••'
  }
  delete row.account_number_encrypted
  return row
}

function orderedColumn(orderCol: any): any {
  if (!orderCol) return undefined
  if (orderCol.direction) return orderCol
  const colName = String(orderCol.name ?? '')
  return /(date|time|timestamp|created|updated|_at)$/i.test(colName) ? desc(orderCol) : orderCol
}

async function paginate(table: any, query: any, orderCol: any, req: Request) {
  const page = Math.max(1, num(req.query.page, 1))
  const pageSize = Math.min(200, Math.max(1, num(req.query.limit, 50)))
  const offset = (page - 1) * pageSize
  const [rows, [{ count }]] = await Promise.all([
    db!.select().from(table).orderBy(orderedColumn(orderCol)).limit(pageSize).offset(offset),
    db!.select({ count: sql<number>`count(*) over ()` }).from(table).limit(1),
  ])
  return { page, pageSize, total: Number(count ?? 0), data: rows }
}

const listOf = (table: any, orderCol?: any) =>
    async (req: Request, res: Response) => {
    if (!requireDb(res)) return
    try {
      const result = await paginate(table, req.query, orderCol ?? table.id, req)
      result.data = result.data.map(stripHash)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

const oneOf = (table: any, idCol: any) =>
    async (req: Request, res: Response) => {
    if (!requireDb(res)) return
    try {
      const rows = await db!.select().from(table).where(eq(idCol, req.params.id)).limit(1)
      if (!rows[0]) return res.status(404).json({ error: 'Not found' })
      res.json(stripHash(rows[0]))
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

const s = schema

dbRouter.get('/products', listOf(s.products, s.products.name))

// Barcode / QR Code labels (must be before /products/:id to avoid param capture)
dbRouter.get('/products/labels/presets', requirePermission('inventory', 'view'), (_req, res) => {
  const { LABEL_PRESETS } = require('../barcodeLabels')
  res.json(Object.entries(LABEL_PRESETS).map(([key, val]) => ({ key, ...(val as any) })))
})

dbRouter.get('/products/labels', requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const { fetchAllProductLabels, fetchProductLabels, generateLabelsPDF, LABEL_PRESETS } = await import('../barcodeLabels')
    const preset = String(req.query.preset || 'zlabel-50x30')
    const showPrice = req.query.price !== 'false'
    const showWeight = req.query.weight !== 'false'
    const showQR = req.query.qr !== 'false'
    // Optional `ids` query (comma-separated product IDs) → labels for selected products only
    const idsParam = String(req.query.ids ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const products = idsParam.length > 0 ? await fetchProductLabels(idsParam) : await fetchAllProductLabels()
    if (products.length === 0) return res.status(404).json({ error: 'No products found' })
    const opts = LABEL_PRESETS[preset] ?? {}
    const pdf = await generateLabelsPDF(products, { ...opts, showPrice, showWeight, showQR, businessName: 'Opal Line' })
    if (!pdf) return res.status(500).json({ error: 'Label generation failed' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="product-labels-${Date.now()}.pdf"`)
    res.send(pdf)
  } catch (err) {
    res.status(500).json({ error: 'Label generation failed' })
  }
})

dbRouter.post('/products/labels', requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const { fetchProductLabels, generateLabelsPDF, LABEL_PRESETS } = await import('../barcodeLabels')
    const ids: string[] = req.body?.productIds ?? []
    const preset = String(req.body?.preset || 'zlabel-50x30')
    const showPrice = req.body?.showPrice !== false
    const showWeight = req.body?.showWeight !== false
    const showQR = req.body?.showQR !== false
    if (ids.length === 0) return res.status(400).json({ error: 'productIds is required' })
    const products = await fetchProductLabels(ids)
    if (products.length === 0) return res.status(404).json({ error: 'Products not found' })
    const opts = LABEL_PRESETS[preset] ?? {}
    const pdf = await generateLabelsPDF(products, { ...opts, showPrice, showWeight, showQR, businessName: 'Opal Line' })
    if (!pdf) return res.status(500).json({ error: 'Label generation failed' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="product-labels-${Date.now()}.pdf"`)
    res.send(pdf)
  } catch (err) {
    res.status(500).json({ error: 'Label generation failed' })
  }
})

// Scan-based stock count: look up a product by barcode or exact SKU (for scanner guns)
dbRouter.get('/products/scan', requirePermission('inventory', 'view'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const code = String(req.query.code ?? '').trim()
    if (!code) return res.status(400).json({ error: 'code is required' })
    const [row] = await db!
      .select({
        id: s.products.id,
        name: s.products.name,
        sku: s.products.sku,
        barcode: s.products.barcode,
        stock: s.products.stock,
        category: s.products.category,
      })
      .from(s.products)
      .where(or(eq(s.products.barcode, code), eq(s.products.sku, code)))
      .limit(1)
    if (!row) return res.status(404).json({ error: 'No product with that barcode/SKU' })
    res.json({ data: row })
  } catch (err) {
    logger.error({ err }, 'product scan lookup failed')
    res.status(500).json({ error: 'Scan lookup failed' })
  }
})

// Bulk stock-count: apply counted quantities for many products at once.
// body: { counts: [{ id, counted }], mode: 'set' | 'adjust' }
dbRouter.post('/inventory/stock-count', requirePermission('inventory', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const counts = Array.isArray(req.body?.counts) ? req.body.counts : []
    const mode = req.body?.mode === 'adjust' ? 'adjust' : 'set'
    if (counts.length === 0) return res.status(400).json({ error: 'counts array is required' })
    let applied = 0
    const errors: string[] = []
    for (const c of counts.slice(0, 500)) {
      const id = String(c?.id ?? '').trim()
      const counted = Number(c?.counted)
      if (!id || !Number.isFinite(counted) || counted < 0) {
        errors.push(`${id || 'unknown'}: invalid counted value`)
        continue
      }
      try {
        if (mode === 'set') {
          await db!.update(s.products).set({ stock: Math.floor(counted) }).where(eq(s.products.id, id))
        } else {
          await db!.update(s.products).set({ stock: sql`greatest(0, ${s.products.stock} + ${Math.floor(counted)})` }).where(eq(s.products.id, id))
        }
        applied++
      } catch (err) {
        errors.push(`${id}: ${err instanceof Error ? err.message : 'update failed'}`)
      }
    }
    recordCrud('products', 'Updated', req, { stockCount: true, applied, mode })
    res.json({ ok: errors.length === 0, applied, mode, errors })
  } catch (err) {
    logger.error({ err }, 'stock count apply failed')
    res.status(500).json({ error: 'Stock count failed' })
  }
})

// Product catalog PDF + duplicate SKU detection (before /products/:id to avoid param capture)
dbRouter.get('/products/catalog-pdf', requirePermission('inventory', 'view'), async (_req, res) => {
  try {
    const { generateCatalogPDF } = await import('../catalogPdf')
    const pdf = await generateCatalogPDF()
    if (!pdf) return res.status(500).json({ error: 'Catalog generation failed' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="product-catalog-${new Date().toISOString().slice(0, 10)}.pdf"`)
    res.send(pdf)
  } catch (err) {
    logger.error({ err }, 'catalog PDF failed')
    res.status(500).json({ error: 'Catalog generation failed' })
  }
})

// Duplicate SKU detection
dbRouter.get('/products/duplicates', requirePermission('inventory', 'view'), async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.execute<Record<string, unknown>>(sql`
      SELECT lower(sku) AS sku, count(*)::int AS cnt,
             string_agg(name || ' (' || id || ')', ' | ') AS products
      FROM products
      GROUP BY lower(sku)
      HAVING count(*) > 1
      ORDER BY cnt DESC
    `)
    res.json({ data: rows })
  } catch (err) {
    logger.error({ err }, 'duplicate check failed')
    res.status(500).json({ error: 'Duplicate check failed' })
  }
})

dbRouter.get('/products/:id', oneOf(s.products, s.products.id))

dbRouter.get('/customers', listOf(s.customers, s.customers.name))
dbRouter.get('/customers/:id', oneOf(s.customers, s.customers.id))

dbRouter.get('/suppliers', listOf(s.suppliers, s.suppliers.name))
dbRouter.get('/suppliers/:id', oneOf(s.suppliers, s.suppliers.id))

dbRouter.get('/invoices', listOf(s.salesInvoices, s.salesInvoices.date))
dbRouter.get('/invoices/with-items', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const limit = Math.min(200, Math.max(1, num(req.query.limit, 100)))
    const invoices = await db!.select().from(s.salesInvoices).orderBy(desc(s.salesInvoices.date)).limit(limit)
    const ids = invoices.map((i) => i.id)
    const items = ids.length > 0 ? await db!.select().from(s.salesInvoiceItems).where(inArray(s.salesInvoiceItems.invoiceId, ids)) : []
    const byInvoice = new Map<string, typeof items>()
    for (const it of items) {
      const key = String(it.invoiceId ?? '')
      const arr = byInvoice.get(key) ?? []
      arr.push(it)
      byInvoice.set(key, arr)
    }
  res.json({ page: 1, pageSize: limit, total: invoices.length, data: invoices.map((i) => ({ ...i, items: byInvoice.get(i.id) ?? [] })) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})
dbRouter.get('/invoices/:id', oneOf(s.salesInvoices, s.salesInvoices.id))

dbRouter.get('/invoices/:id/items', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.select().from(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, req.params.id))
  res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

async function applyStockDelta(tx: any, sku: string, delta: number): Promise<void> {
  if (!sku || !delta) return
  if (delta < 0) {
    const [row] = await tx.select({ stock: s.products.stock }).from(s.products).where(eq(s.products.sku, sku)).limit(1).for('update')
    if (!row) return
    const current = Number(row.stock ?? 0)
    if (current + delta < 0) {
      throw new Error(`Insufficient stock for SKU ${sku}: available ${current}, requested ${Math.abs(delta)}`)
    }
  }
  await tx
    .update(s.products)
    .set({ stock: sql`${s.products.stock} + ${delta}` })
    .where(eq(s.products.sku, sku))
}

function normalizeInvoiceItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((it) => {
      const item = it && typeof it === 'object' ? (it as Record<string, unknown>) : {}
      const row = sanitize(item, s.salesInvoiceItems)
      delete row.id
      delete row.invoiceId
      row.product = String(item.product ?? item.title ?? '').trim()
      row.sku = String(item.sku ?? '').trim()
      row.qty = Math.max(1, Math.floor(num(item.qty, 1)))
      row.weight = num(item.weight, 0)
      row.silverRate = num(item.silverRate, 0)
      row.makingCharge = num(item.makingCharge, 0)
      row.tax = num(item.tax, 0)
      const weight = num(item.weight, 0)
      const silverRate = num(item.silverRate, 0)
      const makingCharge = num(item.makingCharge, 0)
      if (weight > 0 && silverRate > 0) {
        const silverValue = round2(weight * silverRate)
        row.amount = round2(silverValue + makingCharge)
      } else {
        row.amount = num(item.amount, 0)
      }
      return row
    })
    .filter((it) => String(it.sku) !== '' || String(it.product) !== '')
}

dbRouter.post('/invoices', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const body = req.body ?? {}
    const items = normalizeInvoiceItems(body.items)
    const clean = sanitize(body, s.salesInvoices)
    delete clean.id
    delete clean.items
    if (!clean.number) return res.status(400).json({ error: 'Invoice number is required' })

    const hasItems = items.length > 0
    const gst = num(body.gst, 3)
    const subtotal = hasItems ? round2(items.reduce((a, it) => a + num(it.amount, 0), 0)) : num(clean.subtotal, 0)
    const discount = num(body.discount, 0)
    const gstAmount = hasItems ? round2(subtotal * gst / 100) : num(clean.gstAmount, round2(subtotal * gst / 100))
    const grandTotal = hasItems ? round2(subtotal + gstAmount - discount) : num(clean.grandTotal, round2(subtotal + gstAmount - discount))
    const silverValue = hasItems ? round2(items.reduce((a, it) => a + num(it.weight, 0) * num(it.silverRate, 0), 0)) : num(clean.silverValue, 0)
    const makingCharge = hasItems ? round2(items.reduce((a, it) => a + num(it.makingCharge, 0), 0)) : num(clean.makingCharge, 0)

    const id = randomUUID()
    const row = await db!.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(s.salesInvoices)
        .values({
          ...clean,
          id,
          subtotal,
          gst,
          gstAmount,
          discount,
          grandTotal,
          silverValue,
          makingCharge,
        } as any)
        .returning()
      for (const it of items) {
        await tx.insert(s.salesInvoiceItems).values({ ...it, id: randomUUID(), invoiceId: id })
        await applyStockDelta(tx, String(it.sku ?? ''), -num(it.qty, 0))
      }
      return invoice
    })

    recordCrud('invoices', 'Created', req, row)
    res.status(201).json(stripHash(row))
  } catch (err) {
    res.status(400).json({ error: 'Failed to create invoice' })
  }
})

dbRouter.patch('/invoices/:id', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const body = req.body ?? {}
    const clean = sanitize(body, s.salesInvoices)
    delete clean.id
    delete clean.items

    const row = await db!.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, req.params.id)).limit(1)
      if (!existing) return null
      const items = normalizeInvoiceItems(body.items)
      if (items.length > 0) {
        // First, restore old stock
        const oldItems = await tx.select().from(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, req.params.id))
        for (const oi of oldItems) {
          await applyStockDelta(tx, String(oi.sku ?? ''), num(oi.qty, 0))
        }
        // Delete old items
        await tx.delete(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, req.params.id))
        // Insert new items and deduct stock
        for (const it of items) {
          await tx.insert(s.salesInvoiceItems).values({ ...it, id: randomUUID(), invoiceId: req.params.id })
          await applyStockDelta(tx, String(it.sku ?? ''), -num(it.qty, 0))
        }
        const gst = num(body.gst, num(existing.gst, 3))
        const subtotal = round2(items.reduce((a, it) => a + num(it.amount, 0), 0))
        const discount = num(body.discount, num(existing.discount, 0))
        const gstAmount = round2(subtotal * gst / 100)
        const grandTotal = round2(subtotal + gstAmount - discount)
        const silverValue = round2(items.reduce((a, it) => a + num(it.weight, 0) * num(it.silverRate, 0), 0))
        const makingCharge = round2(items.reduce((a, it) => a + num(it.makingCharge, 0), 0))
        clean.subtotal = subtotal
        clean.gst = gst
        clean.gstAmount = gstAmount
        clean.discount = discount
        clean.grandTotal = grandTotal
        clean.silverValue = silverValue
        clean.makingCharge = makingCharge
      }
      if (Object.keys(clean).length === 0) return existing
      const [updated] = await tx.update(s.salesInvoices).set(clean).where(eq(s.salesInvoices.id, req.params.id)).returning()
      return updated
    })

    if (!row) return res.status(404).json({ error: 'Not found' })
    recordCrud('invoices', 'Updated', req, row)
    res.json(stripHash(row))
  } catch (err) {
    res.status(400).json({ error: 'Failed to update invoice' })
  }
})

dbRouter.delete('/invoices/:id', requirePermission('sales', 'delete'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const removed = await db!.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, req.params.id)).limit(1)
      if (!existing) return false
      const items = await tx.select().from(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, req.params.id))
      for (const it of items) {
        await applyStockDelta(tx, String(it.sku ?? ''), num(it.qty, 0))
      }
      await tx.delete(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, req.params.id))
      await tx.delete(s.salesInvoices).where(eq(s.salesInvoices.id, req.params.id))
      recordCrud('invoices', 'Deleted', req, existing)
      return true
    })
    if (!removed) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dbRouter.get('/sales-orders', listOf(s.salesOrders, s.salesOrders.date))
dbRouter.get('/sales-orders/:id', oneOf(s.salesOrders, s.salesOrders.id))

/** Raise an invoice for an order that doesn't have one yet (inline action). */
dbRouter.post('/sales-orders/:id/create-invoice', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [order] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, req.params.id)).limit(1)
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const { createInvoiceForOrderRow } = await import('../orderEmailIngest')
    const existing = order.invoice
    const invoiceNumber = await createInvoiceForOrderRow(order)
    if (invoiceNumber && !existing) {
      const [fresh] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, req.params.id)).limit(1)
      if (fresh) recordCrud('sales-orders', 'Updated', req, fresh)
      await insertOrderEvent(req.params.id, 'Invoice Created', `Invoice ${invoiceNumber} generated`, actorFromRequest(req).userId ?? 'system')
    }
    res.json({ created: Boolean(invoiceNumber) && !existing, invoiceNumber })
  } catch (err) {
    logger.error({ err }, 'create-invoice for order failed')
    res.status(500).json({ error: 'Failed to create invoice from order' })
  }
})

// ─── Bulk product import (CSV rows parsed client-side) ───────────────────────
const PRODUCT_FIELD_ALIASES: Record<string, string> = {
  name: 'name', title: 'name', product: 'name', 'product name': 'name',
  sku: 'sku', 'item code': 'sku', code: 'sku',
  barcode: 'barcode', 'bar code': 'barcode',
  category: 'category', type: 'category',
  collection: 'collection',
  purity: 'purity',
  grossweight: 'grossWeight', 'gross weight': 'grossWeight',
  stoneweight: 'stoneWeight', 'stone weight': 'stoneWeight',
  netweight: 'netWeight', 'net weight': 'netWeight',
  makingcharge: 'makingCharge', 'making charge': 'makingCharge', mc: 'makingCharge',
  gst: 'gst', 'gst rate': 'gst',
  hsn: 'hsn', 'hsn code': 'hsn',
  supplier: 'supplier',
  silverrate: 'silverRate', 'silver rate': 'silverRate', rate: 'silverRate',
  sellingprice: 'sellingPrice', 'selling price': 'sellingPrice', price: 'sellingPrice',
  compareatprice: 'compareAtPrice', 'compare at price': 'compareAtPrice', mrp: 'compareAtPrice',
  stock: 'stock', quantity: 'stock', qty: 'stock',
  reorderlevel: 'reorderLevel', 'reorder level': 'reorderLevel',
  status: 'status',
  vendor: 'vendor',
  producttype: 'productType', 'product type': 'productType',
  tags: 'tags',
  huid: 'huid',
}

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  return PRODUCT_FIELD_ALIASES[key] ?? PRODUCT_FIELD_ALIASES[key.replace(/\s/g, '')] ?? ''
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

dbRouter.post('/products/bulk-import', requirePermission('inventory', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const rawRows: unknown[] = Array.isArray(req.body?.rows) ? req.body.rows : []
    if (rawRows.length === 0) return res.status(400).json({ error: 'rows is required (array of objects with CSV headers as keys)' })
    if (rawRows.length > 2000) return res.status(400).json({ error: 'Maximum 2000 rows per import' })

    const errors: string[] = []
    let created = 0
    let updated = 0

    // Load existing products by normalized SKU for upsert
    const existing = await db!.select({ id: s.products.id, sku: s.products.sku }).from(s.products)
    const bySku = new Map(existing.map((p) => [p.sku.trim().toLowerCase(), p]))

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i] as Record<string, unknown>
      if (!raw || typeof raw !== 'object') continue
      const mapped: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        const field = normalizeHeader(k)
        if (field && v != null && String(v).trim() !== '') mapped[field] = String(v).trim()
      }
      const rowNo = i + 2 // +2: header row + 1-indexed
      const name = mapped.name
      const sku = mapped.sku
      if (!name) { errors.push(`Row ${rowNo}: missing name — skipped`); continue }
      if (!sku) { errors.push(`Row ${rowNo}: missing SKU — skipped`); continue }
      const skuKey = sku.toLowerCase()
      const numeric = {
        purity: toNum(mapped.purity),
        grossWeight: toNum(mapped.grossWeight),
        stoneWeight: toNum(mapped.stoneWeight),
        netWeight: toNum(mapped.netWeight),
        makingCharge: toNum(mapped.makingCharge),
        gst: toNum(mapped.gst),
        silverRate: toNum(mapped.silverRate),
        sellingPrice: toNum(mapped.sellingPrice),
        compareAtPrice: toNum(mapped.compareAtPrice),
        stock: toNum(mapped.stock),
        reorderLevel: toNum(mapped.reorderLevel),
      }
      const text = {
        name,
        barcode: mapped.barcode ?? null,
        category: mapped.category ?? 'Imported',
        collection: mapped.collection ?? null,
        hsn: mapped.hsn ?? null,
        supplier: mapped.supplier ?? null,
        status: mapped.status ?? 'active',
        vendor: mapped.vendor ?? null,
        productType: mapped.productType ?? null,
        tags: mapped.tags ?? null,
        huid: mapped.huid ?? null,
      }
      try {
        const hit = bySku.get(skuKey)
        if (hit) {
          const patch: Record<string, unknown> = { ...text }
          for (const [k, v] of Object.entries(numeric)) if (v != null) patch[k] = v
          await db!.update(s.products).set(patch).where(eq(s.products.id, hit.id))
          updated++
        } else {
          const values: Record<string, unknown> = {
            id: randomUUID(), sku, ...text, ...numeric,
            stock: numeric.stock ?? 0,
            reorderLevel: numeric.reorderLevel ?? 5,
            purity: numeric.purity ?? 92.5,
            trackInventory: true,
            chargeOnTax: true,
            createdAt: new Date().toISOString().slice(0, 10),
          }
          const [row] = await db!.insert(s.products).values(values as typeof s.products.$inferInsert).returning()
          bySku.set(skuKey, { id: row.id, sku })
          created++
        }
      } catch (rowErr) {
        const base = rowErr instanceof Error ? rowErr.message : 'insert failed'
        const cause = rowErr instanceof Error && (rowErr as any).cause ? String((rowErr as any).cause?.message ?? (rowErr as any).cause) : ''
        errors.push(`Row ${rowNo} (${sku}): ${`${base} ${cause}`.replace(/\s+/g, ' ')}`)
      }
    }
    recordCrud('products', 'Created', req, { created, updated })
    res.json({ created, updated, errors })
  } catch (err) {
    logger.error({ err }, 'bulk import failed')
    res.status(500).json({ error: 'Bulk import failed' })
  }
})

// ─── Bulk image upload, auto-matched to products by SKU from filename ────────
dbRouter.post('/products/bulk-images', requirePermission('inventory', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const images: Array<{ filename?: unknown; dataUrl?: unknown }> = Array.isArray(req.body?.images) ? req.body.images : []
    if (images.length === 0) return res.status(400).json({ error: 'images is required ([{ filename, dataUrl }])' })
    if (images.length > 200) return res.status(400).json({ error: 'Maximum 200 images per batch' })

    const { saveUploadedImage } = await import('../uploads')
    const all = await db!.select({ id: s.products.id, sku: s.products.sku }).from(s.products)
    const bySku = new Map(all.map((p) => [p.sku.trim().toLowerCase(), p.id]))

    let matched = 0
    const unmatched: string[] = []
    const errors: string[] = []
    for (const img of images) {
      const filename = typeof img.filename === 'string' ? img.filename : ''
      const dataUrl = typeof img.dataUrl === 'string' ? img.dataUrl : ''
      if (!filename || !dataUrl) { errors.push(`${filename || 'image'}: missing filename or data`); continue }
      const base = filename.split('/').pop() ?? filename
      const sku = base.replace(/\.[^.]+$/, '').trim().toLowerCase()
      const productId = bySku.get(sku)
      if (!productId) { unmatched.push(filename); continue }
      const path = saveUploadedImage(dataUrl)
      if (!path) { errors.push(`${filename}: invalid image data (must be a data:image/... URL)`); continue }
      const [prod] = await db!.select({ images: s.products.images, image: s.products.image }).from(s.products).where(eq(s.products.id, productId)).limit(1)
      const gallery = Array.isArray(prod?.images) ? (prod!.images as string[]) : []
      if (!gallery.includes(path)) gallery.push(path)
      await db!.update(s.products).set({ images: gallery, image: prod?.image ?? path }).where(eq(s.products.id, productId))
      matched++
    }
    res.json({ matched, unmatched, errors })
  } catch (err) {
    logger.error({ err }, 'bulk image match failed')
    res.status(500).json({ error: 'Bulk image upload failed' })
  }
})

// ─── Order status pipeline (kanban drag & drop) ──────────────────────────────
dbRouter.patch('/sales-orders/:id/status', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const status = String(req.body?.status ?? '').trim()
    const allowed = ['imported', 'confirmed', 'processing', 'fulfilled', 'cancelled']
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` })
    const [row] = await db!.update(s.salesOrders).set({ status }).where(eq(s.salesOrders.id, req.params.id)).returning()
    if (!row) return res.status(404).json({ error: 'Order not found' })
    const actor = actorFromRequest(req)
    await insertOrderEvent(row.id, 'Status Change', `Status moved to ${status}`, actor.userId ?? 'system')
    void recordActivity({
      action: 'Updated Order Status',
      module: 'sales',
      entity: row.internalId ?? row.id,
      details: `Status → ${status}`,
      userId: actor.userId,
      ip: actor.ip,
    })
    res.json(row)
  } catch (err) {
    res.status(400).json({ error: 'Failed to update order status' })
  }
})

// ─── Returns & credit notes: return invoice items, restock, credit note ─────
dbRouter.post('/invoices/:id/return', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [invoice] = await db!.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, req.params.id)).limit(1)
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    const invItems = await db!.select().from(s.salesInvoiceItems).where(eq(s.salesInvoiceItems.invoiceId, invoice.id))
    if (invItems.length === 0) return res.status(400).json({ error: 'Invoice has no line items to return' })

    // Return spec: explicit items list (partial) or whole invoice
    const requested: Array<{ sku?: string; qty: number }> = Array.isArray(req.body?.items) && req.body.items.length > 0
      ? req.body.items
      : invItems.map((it) => ({ sku: it.sku ?? undefined, qty: it.qty ?? 1 }))
    const qtyBySku = new Map<string, number>()
    for (const r of requested) {
      if (r.sku && Number(r.qty) > 0) qtyBySku.set(r.sku, (qtyBySku.get(r.sku) ?? 0) + Number(r.qty))
    }
    const returnItems = invItems
      .filter((it) => it.sku && qtyBySku.has(it.sku))
      .map((it) => {
        const sku = it.sku as string
        const qty = Math.min(qtyBySku.get(sku) ?? 0, it.qty ?? 1)
        return {
          product: it.product, sku, qty,
          amount: Math.round(((it.amount ?? 0) * qty) / (it.qty || 1) * 100) / 100,
        }
      })
      .filter((it) => it.qty > 0)
    if (returnItems.length === 0) return res.status(400).json({ error: 'No matching items to return (SKU + qty required)' })

    const amount = Math.round(returnItems.reduce((a, it) => a + (it.amount ?? 0), 0) * 100) / 100
    const restock = req.body?.restock !== false
    if (restock) {
      for (const it of returnItems) {
        const [prod] = await db!.select({ id: s.products.id, stock: s.products.stock }).from(s.products).where(eq(s.products.sku, it.sku!)).limit(1)
        if (prod) {
          await db!.update(s.products).set({ stock: (prod.stock ?? 0) + it.qty }).where(eq(s.products.id, prod.id))
        }
      }
    }

    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    let number = `CR${ym}-${Math.floor(100000 + Math.random() * 900000)}`
    for (let attempt = 0; attempt < 3; attempt++) {
      const [dup] = await db!.select({ id: s.salesReturns.id }).from(s.salesReturns).where(eq(s.salesReturns.number, number)).limit(1)
      if (!dup) break
      number = `CR${ym}-${Math.floor(100000 + Math.random() * 900000)}`
    }

    const [ret] = await db!.insert(s.salesReturns).values({
      id: randomUUID(),
      number,
      invoiceId: invoice.id,
      creditNoteNumber: number,
      restocked: restock,
      returnItems,
      order: invoice.shopifyOrder,
      customer: invoice.customer,
      items: returnItems.reduce((a, it) => a + it.qty, 0),
      amount,
      status: 'processed',
      date: now.toISOString(),
    }).returning()

    // Accounting trail: negative payment against the invoice
    await db!.insert(s.payments).values({
      id: randomUUID(), ref: number, invoice: invoice.number, customer: invoice.customer,
      amount: -amount, method: 'Credit Note', gateway: 'return', status: 'refunded', date: now.toISOString(),
    })

    recordCrud('sales-returns', 'Created', req, ret)
    if (invoice.id) await insertOrderEvent(invoice.id, 'Return Processed', `Credit note ${number} — ${returnItems.length} item(s), ₹${amount.toLocaleString('en-IN')}${restock ? ', restocked' : ''}`, actorFromRequest(req).userId ?? 'system')
    void import('../statusNotifications').then((m) => m.notifyReturnProcessed({ customer: invoice.customer, invoiceNumber: invoice.number, amount, restocked: restock, creditNoteNumber: number })).catch(() => undefined)
    res.json({ return: ret, creditNoteNumber: number, amount, restocked: restock })
  } catch (err) {
    logger.error({ err }, 'invoice return failed')
    res.status(500).json({ error: 'Failed to process return' })
  }
})

// ─── Booking orders: advance payment, convert to invoice on completion ──────
dbRouter.post('/bookings', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const customer = String(req.body?.customer ?? '').trim()
    const rawItems: Array<{ product?: unknown; sku?: unknown; qty?: unknown; price?: unknown }> = Array.isArray(req.body?.items) ? req.body.items : []
    if (!customer) return res.status(400).json({ error: 'customer is required' })
    const items = rawItems
      .map((it) => ({ title: String(it.product ?? ''), sku: String(it.sku ?? ''), quantity: Number(it.qty ?? 0), price: Number(it.price ?? 0) }))
      .filter((it) => it.title && it.quantity > 0)
    if (items.length === 0) return res.status(400).json({ error: 'at least one item with product + qty is required' })
    const discount = toNum(req.body?.discount) ?? 0
    const value = Math.round((items.reduce((a, it) => a + it.price * it.quantity, 0) - discount) * 100) / 100
    const advancePaid = Math.min(Math.max(toNum(req.body?.advanceAmount) ?? 0, 0), value)

    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const internalId = `BK${ym}-${Math.floor(100000 + Math.random() * 900000)}`
    const [row] = await db!.insert(s.salesOrders).values({
      id: randomUUID(),
      internalId,
      customer,
      value,
      payment: advancePaid >= value && value > 0 ? 'paid' : 'pending',
      fulfillment: 'pending',
      status: 'confirmed',
      date: now.toISOString(),
      items: items.reduce((a, it) => a + it.quantity, 0),
      tags: 'booking',
      currency: 'INR',
      discount,
      lineItems: items,
      isBooking: true,
      advancePaid,
    }).returning()
    recordCrud('sales-orders', 'Created', req, row)
    await insertOrderEvent(row.id, 'Booking Created', `Booking ${internalId} — ${items.reduce((a, it) => a + it.quantity, 0)} item(s), value ₹${value.toLocaleString('en-IN')}, advance ₹${advancePaid.toLocaleString('en-IN')}`, actorFromRequest(req).userId ?? 'system')
    res.json(row)
  } catch (err) {
    logger.error({ err }, 'booking create failed')
    res.status(500).json({ error: 'Failed to create booking' })
  }
})

// Booking advance payment link — customers pay their advance online via Razorpay
dbRouter.post('/bookings/:id/payment-link', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [booking] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, req.params.id)).limit(1)
    if (!booking) return res.status(404).json({ error: 'Booking not found' })
    if (!booking.isBooking) return res.status(400).json({ error: 'Order is not a booking' })
    const value = Number(booking.value ?? 0)
    const advancePaid = Number(booking.advancePaid ?? 0)
    const remaining = Math.round((value - advancePaid) * 100) / 100
    if (remaining <= 0) return res.status(400).json({ error: 'Booking is already fully paid' })
    const { createRazorpayPaymentLink, isRazorpayConfigured } = await import('../paymentLinks')
    if (!isRazorpayConfigured()) return res.status(400).json({ error: 'Razorpay not configured (set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET)', configured: false })
    const link = await createRazorpayPaymentLink({
      amount: remaining,
      customer: booking.customer ?? 'Customer',
      description: `Advance for booking ${booking.internalId ?? booking.id} — Opal Line`,
      referenceId: `BK-${booking.internalId ?? booking.id}`.replace(/[^a-zA-Z0-9-]/g, ''),
    })
    if (!link) return res.status(500).json({ error: 'Failed to create payment link' })
    res.json({ url: link.url, id: link.id, amount: remaining, configured: true })
  } catch (err) {
    logger.error({ err }, 'booking payment link failed')
    res.status(500).json({ error: 'Payment link generation failed' })
  }
})

dbRouter.post('/bookings/:id/convert', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [order] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, req.params.id)).limit(1)
    if (!order) return res.status(404).json({ error: 'Booking not found' })
    if (order.invoice) return res.status(400).json({ error: `Already converted to invoice ${order.invoice}` })
    const value = Number(order.value ?? 0)
    const advancePaid = Number(order.advancePaid ?? 0)
    const fullyPaid = advancePaid >= value && value > 0
    await db!.update(s.salesOrders).set({ payment: fullyPaid ? 'paid' : 'pending' }).where(eq(s.salesOrders.id, order.id))
    const [fresh] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, order.id)).limit(1)
    const { createInvoiceForOrderRow } = await import('../orderEmailIngest')
    const invoiceNumber = await createInvoiceForOrderRow(fresh!)
    if (!invoiceNumber) return res.status(400).json({ error: 'Conversion failed: booking has no convertible line items' })
    await db!.update(s.salesOrders).set({ invoice: invoiceNumber, status: 'fulfilled' }).where(eq(s.salesOrders.id, order.id))
    if (advancePaid > 0) {
      await db!.insert(s.payments).values({
        id: randomUUID(), ref: order.internalId ?? order.id, invoice: invoiceNumber, customer: order.customer,
        amount: advancePaid, method: 'Advance', gateway: 'booking', status: 'paid', date: new Date().toISOString(),
      })
    }
    recordCrud('sales-orders', 'Updated', req, { id: order.id, invoice: invoiceNumber })
    await insertOrderEvent(order.id, 'Booking Converted', `Converted to invoice ${invoiceNumber}; advance applied ₹${advancePaid.toLocaleString('en-IN')}`, actorFromRequest(req).userId ?? 'system')
    res.json({ invoiceNumber, advanceApplied: advancePaid, balance: Math.round((value - advancePaid) * 100) / 100 })
  } catch (err) {
    logger.error({ err }, 'booking convert failed')
    res.status(500).json({ error: 'Failed to convert booking' })
  }
})

// ─── Order events timeline ───────────────────────────────────────────────────
export async function insertOrderEvent(orderId: string, event: string, details: string, actor?: string | null): Promise<void> {
  if (!db) return
  try {
    await db.insert(s.orderEvents).values({
      id: randomUUID(), orderId, event, details,
      actor: actor ?? null,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    logger.warn({ err }, 'order event insert failed')
  }
}

// Seed a timeline for orders that have none (first time the dialog is opened)
async function ensureOrderTimeline(order: typeof s.salesOrders.$inferSelect): Promise<void> {
  const existing = await db!.select({ id: s.orderEvents.id }).from(s.orderEvents).where(eq(s.orderEvents.orderId, order.id)).limit(1)
  if (existing.length > 0) return
  const events: Array<[string, string]> = []
  if (order.date) events.push(['Order Created', order.shopifyId ? `Imported from Shopify order ${order.shopifyId}` : 'Order recorded'])
  if (order.isBooking && order.advancePaid) events.push(['Advance Received', `${Number(order.advancePaid).toLocaleString('en-IN')} collected at booking`])
  if (order.invoice) events.push(['Invoice Created', `Invoice ${order.invoice}`])
  if (order.status && order.status !== 'imported') events.push(['Status', `Status set to ${order.status}`])
  for (const [e, d] of events) {
    await insertOrderEvent(order.id, e, d, 'system')
  }
}

dbRouter.get('/orders/:id/events', requirePermission('sales', 'view'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [order] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, req.params.id)).limit(1)
    if (!order) return res.status(404).json({ error: 'Order not found' })
    await ensureOrderTimeline(order)
    const events = await db!.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, req.params.id)).orderBy(desc(s.orderEvents.createdAt))
    res.json({ data: events })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load order events' })
  }
})

// ─── Customer 360: everything about one customer in a single call ───────────
dbRouter.get('/customers/:name/summary', requirePermission('sales', 'view'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const customer = req.params.name
    const [orders, invoices, dues, pays] = await Promise.all([
      db!.select().from(s.salesOrders).where(eq(s.salesOrders.customer, customer)).orderBy(desc(s.salesOrders.date)).limit(25),
      db!.select().from(s.salesInvoices).where(eq(s.salesInvoices.customer, customer)).orderBy(desc(s.salesInvoices.date)).limit(25),
      db!.select().from(s.salesInvoices).where(sql`${s.salesInvoices.customer} = ${customer} and ${s.salesInvoices.paymentStatus} is distinct from 'paid' and ${s.salesInvoices.status} is distinct from 'cancelled' and ${s.salesInvoices.status} is distinct from 'refunded'`),
      db!.select().from(s.payments).where(eq(s.payments.customer, customer)).orderBy(desc(s.payments.date)).limit(15),
    ])
    const lifetimeValue = Math.round(orders.reduce((a, o) => a + Number(o.value ?? 0), 0) * 100) / 100
    const outstanding = Math.round(dues.reduce((a, i) => a + Number(i.grandTotal ?? 0), 0) * 100) / 100
    res.json({
      customer,
      totalOrders: orders.length,
      lifetimeValue,
      outstanding,
      lastOrder: orders[0]?.date ?? null,
      lastInvoice: invoices[0]?.number ?? null,
      orders,
      invoices,
      payments: pays,
    })
  } catch (err) {
    logger.error({ err }, 'customer summary failed')
    res.status(500).json({ error: 'Failed to load customer summary' })
  }
})

// ─── Bulk order actions: status update + invoice creation ────────────────────
dbRouter.post('/sales-orders/bulk-status', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : []
    const status = String(req.body?.status ?? '').trim()
    const allowed = ['imported', 'confirmed', 'processing', 'fulfilled', 'cancelled']
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' })
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` })
    let updated = 0
    for (const id of ids) {
      const [row] = await db!.update(s.salesOrders).set({ status }).where(eq(s.salesOrders.id, id)).returning()
      if (row) {
        updated++
        await insertOrderEvent(id, 'Status Change', `Bulk status moved to ${status}`, actorFromRequest(req).userId ?? 'system')
        if (status === 'fulfilled') void import('../statusNotifications').then((m) => m.notifyOrderFulfilled(row)).catch(() => undefined)
      }
    }
    recordCrud('sales-orders', 'Updated', req, { bulkStatus: status, updated })
    res.json({ updated, status })
  } catch (err) {
    logger.error({ err }, 'bulk status failed')
    res.status(500).json({ error: 'Bulk status update failed' })
  }
})

dbRouter.post('/sales-orders/bulk-invoice', requirePermission('sales', 'create'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : []
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' })
    const { createInvoiceForOrderRow } = await import('../orderEmailIngest')
    let created = 0
    let alreadyInvoiced = 0
    let failed = 0
    const errors: string[] = []
    for (const id of ids) {
      const [order] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, id)).limit(1)
      if (!order) { failed++; errors.push(`${id}: not found`); continue }
      if (order.invoice) { alreadyInvoiced++; continue }
      try {
        const invoiceNumber = await createInvoiceForOrderRow(order)
        if (invoiceNumber) {
          created++
          await insertOrderEvent(id, 'Invoice Created', `Invoice ${invoiceNumber} generated (bulk)`, actorFromRequest(req).userId ?? 'system')
        } else { failed++; errors.push(`${order.internalId ?? order.id}: no convertible line items`) }
      } catch (e) {
        failed++
        errors.push(`${order.internalId ?? order.id}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
    recordCrud('sales-orders', 'Updated', req, { bulkInvoice: true, created })
    res.json({ created, alreadyInvoiced, failed, errors })
  } catch (err) {
    logger.error({ err }, 'bulk invoice failed')
    res.status(500).json({ error: 'Bulk invoicing failed' })
  }
})

// ─── Dispatch / shipments ─────────────────────────────────────────────────

dbRouter.get('/shipments', requirePermission('sales', 'view'), async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.select().from(s.shipments).orderBy(desc(s.shipments.createdAt)).limit(300)
    res.json({ data: rows })
  } catch (err) {
    logger.error({ err }, 'shipments load failed')
    res.status(500).json({ error: 'Failed to load shipments' })
  }
})

dbRouter.post('/shipments/dispatch', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const orderId = String(req.body?.orderId ?? '').trim()
    if (!orderId) return res.status(400).json({ error: 'orderId is required' })
    const [order] = await db!.select().from(s.salesOrders).where(eq(s.salesOrders.id, orderId)).limit(1)
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const courier = String(req.body?.courier ?? '').trim() || null
    const trackingNumber = String(req.body?.trackingNumber ?? '').trim() || null
    const expected = req.body?.expectedDelivery ? String(req.body.expectedDelivery).slice(0, 10) : null
    const notes = String(req.body?.notes ?? '').trim() || null
    const [existing] = await db!.select().from(s.shipments).where(eq(s.shipments.orderId, orderId)).limit(1)
    const values = {
      orderRef: order.internalId ?? order.shopifyId ?? orderId,
      customer: order.customer,
      courier,
      trackingNumber,
      status: 'dispatched',
      dispatchedAt: new Date().toISOString(),
      expectedDelivery: expected,
      notes,
    }
    if (existing) {
      await db!.update(s.shipments).set(values).where(eq(s.shipments.id, existing.id))
    } else {
      await db!.insert(s.shipments).values({ id: randomUUID(), orderId, ...values })
    }
    // Keep order fulfillment in sync
    if (order.status !== 'cancelled') {
      await db!.update(s.salesOrders).set({ fulfillment: 'fulfilled', status: order.status === 'imported' ? 'processing' : order.status }).where(eq(s.salesOrders.id, orderId))
    }
    await insertOrderEvent(orderId, 'Dispatched', `Dispatched via ${courier ?? 'courier'}${trackingNumber ? ` — tracking ${trackingNumber}` : ''}`, actorFromRequest(req).userId ?? 'system')
    // Customer notification with tracking details
    void import('../statusNotifications').then((m) => m.notifyOrderFulfilled({ ...order, trackingId: trackingNumber, carrier: courier })).catch(() => undefined)
    recordCrud('sales-orders', 'Updated', req, { id: orderId, dispatched: true })
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'dispatch failed')
    res.status(500).json({ error: 'Dispatch failed' })
  }
})

dbRouter.post('/shipments/:id/delivered', requirePermission('sales', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [ship] = await db!.update(s.shipments).set({ status: 'delivered', deliveredAt: new Date().toISOString() }).where(eq(s.shipments.id, req.params.id)).returning()
    if (!ship) return res.status(404).json({ error: 'Shipment not found' })
    await insertOrderEvent(ship.orderId, 'Delivered', `Delivery confirmed${ship.trackingNumber ? ` (tracking ${ship.trackingNumber})` : ''}`, actorFromRequest(req).userId ?? 'system')
    // Customer notification (fire-and-forget)
    void import('../statusNotifications').then((m) => m.notifyOrderDelivered({
      internalId: ship.orderRef,
      customer: ship.customer,
      trackingId: ship.trackingNumber,
      courier: ship.courier,
    })).catch(() => undefined)
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'delivery confirm failed')
    res.status(500).json({ error: 'Failed to confirm delivery' })
  }
})

// ─── Notification log (audit + resend) ────────────────────────────────────

dbRouter.get('/notifications/log', requirePermission('system', 'view'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 300)
    const rows = await db!.select().from(s.notificationLog).orderBy(desc(s.notificationLog.createdAt)).limit(limit)
    res.json({ data: rows })
  } catch (err) {
    logger.error({ err }, 'notification log load failed')
    res.status(500).json({ error: 'Failed to load notification log' })
  }
})

dbRouter.post('/notifications/resend', requirePermission('system', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const id = String(req.body?.id ?? '').trim()
    const [entry] = await db!.select().from(s.notificationLog).where(eq(s.notificationLog.id, id)).limit(1)
    if (!entry) return res.status(404).json({ error: 'Notification not found' })
    if (!entry.recipient) return res.status(400).json({ error: 'Original recipient unknown — cannot resend' })
    const ref = entry.ref ?? ''
    const { sendEmail } = await import('../notifications')
    const { sendWhatsAppMessage } = await import('../whatsapp')
    let ok = false
    if (entry.channel === 'email') {
      ok = await sendEmail({ to: entry.recipient, subject: `[Re-send] ${ref} — Opal Line`, html: `<p>Re-sent notification for <strong>${ref}</strong>.</p><p>Please contact us for the full details.</p>` })
    } else {
      ok = (await sendWhatsAppMessage(entry.recipient, `Re-sent notification for ${ref}. — Opal Line`)) !== null
    }
    await logResend(entry, ok)
    res.json({ ok })
  } catch (err) {
    logger.error({ err }, 'notification resend failed')
    res.status(500).json({ error: 'Resend failed' })
  }
})

async function logResend(entry: typeof s.notificationLog.$inferSelect, ok: boolean): Promise<void> {
  try {
    await db!.insert(s.notificationLog).values({
      id: randomUUID(),
      kind: entry.kind,
      channel: entry.channel,
      recipient: entry.recipient,
      ref: entry.ref,
      status: ok ? 'sent' : 'failed',
      error: ok ? 'manual resend' : 'manual resend failed',
      createdAt: new Date().toISOString(),
    })
  } catch { /* non-fatal */ }
}

// ─── Auto reorder suggestions: sales velocity vs. stock on hand ─────────────
dbRouter.get('/inventory/reorder-suggestions', requirePermission('inventory', 'view'), async (_req, res) => {
  if (!requireDb(res)) return
  try {
    // Sales per SKU over the last 90 days from order line items (JSONB)
    const salesRows = await db!.execute(sql`
      SELECT li->>'sku' AS sku,
             sum((li->>'quantity')::numeric) AS qty_sold
      FROM sales_orders, jsonb_array_elements(line_items) AS li
      WHERE date > now() - interval '90 days'
        AND li->>'sku' IS NOT NULL AND li->>'sku' <> ''
      GROUP BY li->>'sku'
    `)
    const soldMap = new Map<string, number>()
    for (const row of salesRows as any[]) {
      soldMap.set(String(row.sku), Number(row.qty_sold ?? 0))
    }

    const prods = await db!.select().from(s.products)
    const suggestions: Array<{
      id: string; name: string; sku: string; supplier: string | null; stock: number
      reorderLevel: number; sold90d: number; weeklyVelocity: number; weeksOfCover: number
      suggestedQty: number; priority: 'urgent' | 'soon' | 'ok'
    }> = []
    for (const p of prods) {
      if (p.trackInventory === false) continue
      const sold90d = soldMap.get(p.sku) ?? 0
      const weeklyVelocity = Math.round((sold90d / 13) * 100) / 100 // 13 weeks ≈ 90 days
      const stock = p.stock ?? 0
      const weeksOfCover = weeklyVelocity > 0 ? Math.round((stock / weeklyVelocity) * 10) / 10 : 99
      const target = Math.max(p.reorderLevel ?? 5, Math.ceil(weeklyVelocity * 8)) // 8 weeks of stock
      if (stock <= (p.reorderLevel ?? 5) || weeksOfCover < 4) {
        suggestions.push({
          id: p.id, name: p.name, sku: p.sku, supplier: p.supplier,
          stock, reorderLevel: p.reorderLevel ?? 5, sold90d, weeklyVelocity,
          weeksOfCover,
          suggestedQty: Math.max(target - stock, 1),
          priority: stock <= 0 || weeksOfCover < 1 ? 'urgent' : weeksOfCover < 2 ? 'soon' : 'ok',
        })
      }
    }
    suggestions.sort((a, b) => {
      const rank = { urgent: 0, soon: 1, ok: 2 } as const
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority]
      return a.weeksOfCover - b.weeksOfCover
    })
    res.json({ data: suggestions, generatedAt: new Date().toISOString() })
  } catch (err) {
    logger.error({ err }, 'reorder suggestions failed')
    res.status(500).json({ error: 'Failed to generate reorder suggestions' })
  }
})

dbRouter.get('/purchase-invoices', listOf(s.purchaseInvoices, s.purchaseInvoices.date))
dbRouter.get('/purchase-invoices/:id', oneOf(s.purchaseInvoices, s.purchaseInvoices.id))

dbRouter.get('/sales-returns', listOf(s.salesReturns, s.salesReturns.date))
dbRouter.get('/sales-returns/:id', oneOf(s.salesReturns, s.salesReturns.id))

dbRouter.get('/purchase-returns', listOf(s.purchaseReturns, s.purchaseReturns.date))
dbRouter.get('/purchase-returns/:id', oneOf(s.purchaseReturns, s.purchaseReturns.id))

dbRouter.get('/inventory/locations', listOf(s.inventoryLocations, s.inventoryLocations.name))
dbRouter.get('/inventory/locations/:id', oneOf(s.inventoryLocations, s.inventoryLocations.id))

dbRouter.get('/inventory/transfers', listOf(s.stockTransfers, s.stockTransfers.date))
dbRouter.get('/inventory/transfers/:id', oneOf(s.stockTransfers, s.stockTransfers.id))

dbRouter.get('/bank-accounts', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const result = await paginate(s.bankAccounts, req.query, s.bankAccounts.name, req)
    result.data = result.data.map(stripHash).map(maskBankAccount)
    res.json(result)
  } catch { res.status(500).json({ error: 'Internal server error' }) }
})
dbRouter.get('/bank-accounts/:id', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.select().from(s.bankAccounts).where(eq(s.bankAccounts.id, req.params.id)).limit(1)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(maskBankAccount(stripHash(rows[0])))
  } catch { res.status(500).json({ error: 'Internal server error' }) }
})

dbRouter.get('/ledger', listOf(s.ledgerEntries, s.ledgerEntries.date))
dbRouter.get('/ledger/:id', oneOf(s.ledgerEntries, s.ledgerEntries.id))

dbRouter.get('/expenses', listOf(s.expenses, s.expenses.date))
dbRouter.get('/expenses/:id', oneOf(s.expenses, s.expenses.id))

dbRouter.get('/payments', listOf(s.payments, s.payments.date))
dbRouter.get('/payments/:id', oneOf(s.payments, s.payments.id))

dbRouter.get('/users', requirePermission('system', 'view'), listOf(s.users, s.users.name))
dbRouter.get('/users/:id', requirePermission('system', 'view'), oneOf(s.users, s.users.id))

dbRouter.get('/audit-logs', listOf(s.auditLogs, s.auditLogs.timestamp))
dbRouter.get('/audit-logs/:id', oneOf(s.auditLogs, s.auditLogs.id))

dbRouter.get('/activity-logs', listOf(s.activityLogs, s.activityLogs.timestamp))
dbRouter.get('/activity-logs/:id', oneOf(s.activityLogs, s.activityLogs.id))

dbRouter.get('/sync-logs', listOf(s.syncLogs, desc(s.syncLogs.time)))
dbRouter.get('/sync-logs/:id', oneOf(s.syncLogs, s.syncLogs.id))

dbRouter.get('/silver-rates', listOf(s.silverRates, s.silverRates.updatedAt))
dbRouter.get('/silver-rates/:id', oneOf(s.silverRates, s.silverRates.id))

const SETTINGS_ID = 'app'

// Encrypted credential columns must never be returned by the generic GET /settings
// (they are only surfaced through /settings/connections which masks them).
const SETTINGS_SECRET_COLUMNS = new Set([
  'shopifyStoreUrlEncrypted',
  'shopifyAccessTokenEncrypted',
  'webhookSecretEncrypted',
  'dbHostEncrypted',
  'dbPortEncrypted',
  'dbDatabaseEncrypted',
  'dbUserEncrypted',
  'dbPasswordEncrypted',
])

dbRouter.get('/settings', requirePermission('system', 'view'), async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.select().from(s.settings).where(eq(s.settings.id, SETTINGS_ID)).limit(1)
    const row = rows[0] ? { ...rows[0] } : null
    if (row) {
      for (const k of SETTINGS_SECRET_COLUMNS) delete row[k as keyof typeof row]
    }
    res.json(row ?? null)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dbRouter.put('/settings', requirePermission('system', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const body = sanitize(req.body ?? {}, s.settings)
    delete body.id
    // Never allow writing encrypted credential columns through the generic
    // settings endpoint; connection secrets are managed via /settings/connections.
    for (const k of SETTINGS_SECRET_COLUMNS) delete body[k as keyof typeof body]
    body.updatedAt = new Date().toISOString()
    const [row] = await db!
      .insert(s.settings)
      .values({ id: SETTINGS_ID, ...body })
      .onConflictDoUpdate({ target: s.settings.id, set: body })
      .returning()
    const actor = actorFromRequest(req)
    void recordActivity({
      action: 'Updated Settings',
      module: 'system',
      entity: 'Settings',
      details: `Business settings updated (${Object.keys(body).filter((k) => k !== 'updatedAt').join(', ')})`,
      userId: actor.userId,
      ip: actor.ip,
    })
    res.json(row)
  } catch (err) {
    res.status(400).json({ error: 'Failed to update settings' })
  }
})

dbRouter.get('/settings/connections', requirePermission('system', 'view'), async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!.select().from(s.settings).where(eq(s.settings.id, SETTINGS_ID)).limit(1)
    const row = rows[0]
    if (!row) {
      res.json({
        shopifyStoreUrl: shopifyConfig.shop || '',
        shopifyAccessToken: shopifyConfig.accessToken ? '••••••••' : '',
        shopifyApiVersion: shopifyConfig.apiVersion || '2025-10',
        webhookSecret: '',
        shopifyConfigured: isShopifyConfigured(),
        dbHost: '',
        dbPort: '5432',
        dbDatabase: 'opal_line',
        dbUser: '',
        dbPassword: '',
        dbConfigured: false,
      })
      return
    }

    let shopifyStoreUrl = ''
    let shopifyAccessToken = ''
    let webhookSecret = ''
    try { if (row.shopifyStoreUrlEncrypted) shopifyStoreUrl = decrypt(row.shopifyStoreUrlEncrypted) } catch { /* */ }
    try { if (row.shopifyAccessTokenEncrypted) shopifyAccessToken = decrypt(row.shopifyAccessTokenEncrypted) } catch { /* */ }
    try { if (row.webhookSecretEncrypted) webhookSecret = decrypt(row.webhookSecretEncrypted) } catch { /* */ }

    let dbHost = ''
    let dbPort = '5432'
    let dbDatabase = 'opal_line'
    let dbUser = ''
    let dbPassword = ''
    try { if (row.dbHostEncrypted) dbHost = decrypt(row.dbHostEncrypted) } catch { /* */ }
    try { if (row.dbPortEncrypted) dbPort = decrypt(row.dbPortEncrypted) } catch { /* */ }
    try { if (row.dbDatabaseEncrypted) dbDatabase = decrypt(row.dbDatabaseEncrypted) } catch { /* */ }
    try { if (row.dbUserEncrypted) dbUser = decrypt(row.dbUserEncrypted) } catch { /* */ }
    try { if (row.dbPasswordEncrypted) dbPassword = decrypt(row.dbPasswordEncrypted) } catch { /* */ }

    res.json({
      shopifyStoreUrl: shopifyStoreUrl ? '••••••••' : '',
      shopifyAccessToken: mask(shopifyAccessToken),
      shopifyApiVersion: row.shopifyApiVersion ?? '2025-10',
      webhookSecret: mask(webhookSecret),
      shopifyConfigured: isShopifyConfigured() || Boolean(shopifyStoreUrl && shopifyAccessToken),
      dbHost: dbHost ? '••••••••' : '',
      dbPort: dbPort ? '••••' : '',
      dbDatabase: dbDatabase ? '••••••••' : '',
      dbUser: dbUser ? '••••••••' : '',
      dbPassword: mask(dbPassword),
      dbConfigured: Boolean(dbHost && dbUser && dbPassword),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load connection settings' })
  }
})

const MASKED_VALUE_PATTERN = /^[•*]+$/

dbRouter.put('/settings/connections', requirePermission('system', 'edit'), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const { shopifyStoreUrl, shopifyAccessToken, shopifyApiVersion, webhookSecret, dbHost, dbPort, dbDatabase, dbUser, dbPassword } = req.body ?? {}
    const body: Record<string, unknown> = { updatedAt: new Date().toISOString() }

    const isMasked = (value: unknown): boolean => typeof value === 'string' && MASKED_VALUE_PATTERN.test(value)

    if (typeof shopifyStoreUrl === 'string' && shopifyStoreUrl.length > 0 && !isMasked(shopifyStoreUrl)) {
      body.shopifyStoreUrlEncrypted = encrypt(normalizeShopDomain(shopifyStoreUrl))
    } else if (shopifyStoreUrl === '') {
      body.shopifyStoreUrlEncrypted = null
    }

    if (typeof shopifyAccessToken === 'string' && shopifyAccessToken.length > 0 && !isMasked(shopifyAccessToken)) {
      body.shopifyAccessTokenEncrypted = encrypt(shopifyAccessToken)
    }

    if (typeof shopifyApiVersion === 'string') {
      body.shopifyApiVersion = shopifyApiVersion
    }

    if (typeof webhookSecret === 'string' && webhookSecret.length > 0 && !isMasked(webhookSecret)) {
      body.webhookSecretEncrypted = encrypt(webhookSecret)
    } else if (webhookSecret === '') {
      body.webhookSecretEncrypted = null
    }

    if (typeof dbHost === 'string' && dbHost.length > 0 && !isMasked(dbHost)) {
      body.dbHostEncrypted = encrypt(dbHost)
    }
    if (typeof dbPort === 'string' && dbPort.length > 0 && !isMasked(dbPort)) {
      body.dbPortEncrypted = encrypt(dbPort)
    }
    if (typeof dbDatabase === 'string' && dbDatabase.length > 0 && !isMasked(dbDatabase)) {
      body.dbDatabaseEncrypted = encrypt(dbDatabase)
    }
    if (typeof dbUser === 'string' && dbUser.length > 0 && !isMasked(dbUser)) {
      body.dbUserEncrypted = encrypt(dbUser)
    }
    if (typeof dbPassword === 'string' && dbPassword.length > 0 && !isMasked(dbPassword)) {
      body.dbPasswordEncrypted = encrypt(dbPassword)
    }

    const [row] = await db!
      .insert(s.settings)
      .values({ id: SETTINGS_ID, ...body })
      .onConflictDoUpdate({ target: s.settings.id, set: body })
      .returning()

    const actor = actorFromRequest(req)
    void recordActivity({
      action: 'Updated Connection Settings',
      module: 'system',
      entity: 'Settings',
      details: 'Connection settings updated',
      userId: actor.userId,
      ip: actor.ip,
    })

    // If DB credentials changed, reconnect
    if (typeof dbHost === 'string' && typeof dbPassword === 'string' && typeof dbUser === 'string' && dbHost && dbUser && dbPassword && !isMasked(dbPassword)) {
      const { reconnect } = await import('../db/client')
      const port = (typeof dbPort === 'string' && dbPort) ? dbPort : '5432'
      const database = (typeof dbDatabase === 'string' && dbDatabase) ? dbDatabase : 'opal_line'
      const host = typeof dbHost === 'string' ? dbHost.replace(/[^\w.-]/g, '') : ''
      if (!host || !/^[a-zA-Z0-9._-]+$/.test(host)) {
        res.status(400).json({ error: 'Invalid database host' })
        return
      }
      const dbPortNum = parseInt(port, 10)
      if (isNaN(dbPortNum) || dbPortNum < 1 || dbPortNum > 65535) {
        res.status(400).json({ error: 'Invalid database port' })
        return
      }
      if (!/^[a-zA-Z0-9_]+$/.test(dbUser)) {
        res.status(400).json({ error: 'Invalid database user' })
        return
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(database)) {
        res.status(400).json({ error: 'Invalid database name' })
        return
      }
      const url = `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`
      const result = await reconnect(url)
      if (!result.ok) {
        res.json({ ok: true, reconnectError: result.error })
        return
      }
    }

    // Reload secrets into runtime config
    const { loadSecretsFromDb } = await import('../config')
    await loadSecretsFromDb()

    // Persist Shopify config to the .env file (encrypted) so it drives the app on next start too
    if (typeof shopifyStoreUrl === 'string' && shopifyStoreUrl.length > 0 && !isMasked(shopifyStoreUrl)) {
      upsertEnvVar('SHOPIFY_STORE_URL', encryptSecret(normalizeShopDomain(shopifyStoreUrl)))
    }
    if (typeof shopifyAccessToken === 'string' && shopifyAccessToken.length > 0 && !isMasked(shopifyAccessToken)) {
      upsertEnvVar('SHOPIFY_ACCESS_TOKEN', encryptSecret(shopifyAccessToken))
    }
    if (typeof shopifyApiVersion === 'string' && shopifyApiVersion.length > 0) {
      upsertEnvVar('SHOPIFY_API_VERSION', shopifyApiVersion)
    }
    if (typeof webhookSecret === 'string' && webhookSecret.length > 0 && !isMasked(webhookSecret)) {
      upsertEnvVar('SHOPIFY_WEBHOOK_SECRET', encryptSecret(webhookSecret))
    }

    // Test the Shopify connection and report the result to the caller
    const { testShopifyConnection } = await import('../shopify')
    const shopify = await testShopifyConnection()
    if (shopify.ok) {
      logger.info('Shopify connection verified on save')
    } else {
      logger.warn({ error: shopify.error }, 'Shopify connection test failed on save')
    }

    res.json({ ok: true, shopify })
  } catch (err) {
    res.status(400).json({ error: 'Failed to save connection settings' })
  }
})

dbRouter.get('/settings/db-status', requirePermission('system', 'view'), async (_req, res) => {
  try {
    const { isDbConnected } = await import('../db/client')
    if (!isDbConnected()) {
      res.json({ connected: false, error: 'Not connected' })
      return
    }
    const health = await checkDbHealth()
    const url = process.env.DATABASE_URL ?? ''
    let host = '', port = '5432', dbname = '', user = ''
    try {
      const u = new URL(url)
      host = u.hostname
      port = u.port || '5432'
      dbname = u.pathname.replace(/^\//, '')
      user = u.username
    } catch { /* */ }

    res.json({
      connected: health.healthy,
      latencyMs: health.latencyMs,
      error: health.error,
      host: host ? '••••••••' : '',
      port: port ? '••••' : '',
      database: dbname ? '••••••••' : '',
      user: user ? '••••••••' : '',
    })
  } catch {
    res.json({ connected: false, error: 'Health check failed' })
  }
})

const resources: Record<string, any> = {
  products: s.products,
  customers: s.customers,
  suppliers: s.suppliers,
  'sales-orders': s.salesOrders,
  'purchase-orders': s.purchaseOrders,
  'purchase-invoices': s.purchaseInvoices,
  'sales-returns': s.salesReturns,
  'purchase-returns': s.purchaseReturns,
  'inventory/locations': s.inventoryLocations,
  'inventory/transfers': s.stockTransfers,
  'bank-accounts': s.bankAccounts,
  ledger: s.ledgerEntries,
  expenses: s.expenses,
  payments: s.payments,
  users: s.users,
  'audit-logs': s.auditLogs,
  'sync-logs': s.syncLogs,
  'silver-rates': s.silverRates,
}

const resourceModule: Record<string, string> = {
  products: 'inventory',
  customers: 'sales',
  suppliers: 'purchase',
  'sales-orders': 'sales',
  invoices: 'sales',
  'purchase-orders': 'purchase',
  'purchase-invoices': 'purchase',
  'sales-returns': 'sales',
  'purchase-returns': 'purchase',
  'inventory/locations': 'inventory',
  'inventory/transfers': 'inventory',
  'bank-accounts': 'accounts',
  ledger: 'accounts',
  expenses: 'accounts',
  payments: 'accounts',
  users: 'system',
  'audit-logs': 'system',
  'sync-logs': 'shopify',
  'silver-rates': 'silver-rate',
}

const RESOURCE_LABELS: Record<string, string> = {
  products: 'Product',
  customers: 'Customer',
  suppliers: 'Supplier',
  'sales-orders': 'Sales Order',
  invoices: 'Invoice',
  'purchase-orders': 'Purchase Order',
  'purchase-invoices': 'Purchase Invoice',
  'sales-returns': 'Sales Return',
  'purchase-returns': 'Purchase Return',
  'inventory/locations': 'Inventory Location',
  'inventory/transfers': 'Stock Transfer',
  'bank-accounts': 'Bank Account',
  ledger: 'Ledger Entry',
  expenses: 'Expense',
  payments: 'Payment',
  users: 'User',
  'audit-logs': 'Audit Log',
  'sync-logs': 'Sync Log',
  'silver-rates': 'Silver Rate',
}

function entityDisplayName(row: Record<string, unknown> | null): string {
  if (!row) return ''
  const name = String(row.name ?? row.number ?? row.ref ?? row.title ?? row.sku ?? row.description ?? '').trim()
  return name || String(row.id ?? '')
}

function recordCrud(name: string, action: string, req: Request, row: Record<string, unknown> | null) {
  const label = RESOURCE_LABELS[name] ?? name
  const entity = `${label} ${entityDisplayName(row)}`.trim()
  const actor = actorFromRequest(req)
  void recordActivity({
    action,
    module: resourceModule[name] ?? 'system',
    entity,
    details: undefined,
    userId: actor.userId,
    ip: actor.ip,
  })
}

for (const [name, table] of Object.entries(resources)) {
  dbRouter.post(`/${name}`, requirePermission(resourceModule[name], 'create'), async (req, res) => {
    if (!requireDb(res)) return
    try {
      const isUser = name === 'users'
      const isBankAccount = name === 'bank-accounts'
      let body = isUser ? await prepareUserBody(req.body ?? {}) : sanitize(req.body ?? {}, table)
      if (isBankAccount && body.accountNumber && typeof body.accountNumber === 'string') {
        body.accountNumberEncrypted = encrypt(body.accountNumber)
        delete body.accountNumber
      }
      if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No valid fields provided' })
      if (!body.id) body.id = randomUUID()
      const [row] = await db!.insert(table).values(body).returning()
      recordCrud(name, 'Created', req, row)
      res.status(201).json(stripHash(row))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('password') || msg.includes('Password')) {
        res.status(400).json({ error: msg })
      } else {
        res.status(400).json({ error: 'Failed to create resource' })
      }
    }
  })

  dbRouter.patch(`/${name}/:id`, requirePermission(resourceModule[name], 'edit'), async (req, res) => {
    if (!requireDb(res)) return
    try {
      const isUser = name === 'users'
      if (isUser && req.params.id === req.userId) {
        return res.status(403).json({ error: 'Cannot modify your own account' })
      }
      const isBankAccount = name === 'bank-accounts'
      let body = isUser ? await prepareUserBody(req.body ?? {}, true) : sanitize(req.body ?? {}, table)
      if (isBankAccount && body.accountNumber && typeof body.accountNumber === 'string') {
        body.accountNumberEncrypted = encrypt(body.accountNumber)
        delete body.accountNumber
      }
      delete body.id
      if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No valid fields provided' })
      const [row] = await db!.update(table).set(body).where(eq(table.id, req.params.id)).returning()
      if (!row) return res.status(404).json({ error: 'Not found' })
      recordCrud(name, 'Updated', req, row)
      res.json(stripHash(row))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('password') || msg.includes('Password')) {
        res.status(400).json({ error: msg })
      } else {
        res.status(400).json({ error: 'Failed to update resource' })
      }
    }
  })

  dbRouter.delete(`/${name}/:id`, requirePermission(resourceModule[name], 'delete'), async (req, res) => {
    if (!requireDb(res)) return
    try {
      if (name === 'users' && req.params.id === req.userId) {
        return res.status(400).json({ error: 'You cannot delete your own account' })
      }
      const [existing] = await db!.select().from(table).where(eq(table.id, req.params.id)).limit(1)
      if (!existing) return res.status(404).json({ error: 'Not found' })
      await db!.delete(table).where(eq(table.id, req.params.id))
      recordCrud(name, 'Deleted', req, existing)
      res.json({ ok: true, id: req.params.id })
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete resource' })
    }
  })
}

dbRouter.get('/stats', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const [productCount] = await db!.select({ count: sql<number>`count(*)` }).from(s.products)
    const [customerCount] = await db!.select({ count: sql<number>`count(*)` }).from(s.customers)
    const [supplierCount] = await db!.select({ count: sql<number>`count(*)` }).from(s.suppliers)
    const [invoiceCount] = await db!.select({ count: sql<number>`count(*)` }).from(s.salesInvoices)
    const stock = await db!.select({ qty: sql<number>`coalesce(sum(stock),0)` }).from(s.products)
    res.json({
      totalProducts: Number(productCount.count),
      activeProducts: Number((await db!.select({ count: sql<number>`count(*)` }).from(s.products).where(eq(s.products.status, 'active')))[0].count),
      totalCustomers: Number(customerCount.count),
      totalSuppliers: Number(supplierCount.count),
      totalInvoices: Number(invoiceCount.count),
      totalStockQty: Number(stock[0].qty),
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dbRouter.get('/search', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 100)
    if (!q) return res.json({ products: [], customers: [], invoices: [], suppliers: [], salesOrders: [], purchaseInvoices: [], payments: [] })
    const escaped = q.replace(/[%_]/g, (ch) => `\\${ch}`)
    const like = `%${escaped}%`
    const [products, customers, invoices, suppliers, salesOrders, purchaseInvoices, payments] = await Promise.all([
      db!.select().from(s.products).where(ilike(s.products.name, like)).limit(8),
      db!.select().from(s.customers).where(ilike(s.customers.name, like)).limit(8),
      db!.select().from(s.salesInvoices).where(ilike(s.salesInvoices.number, like)).limit(8),
      db!.select().from(s.suppliers).where(ilike(s.suppliers.name, like)).limit(8),
      db!.select().from(s.salesOrders).where(ilike(s.salesOrders.shopifyId, like)).limit(8),
      db!.select().from(s.purchaseInvoices).where(ilike(s.purchaseInvoices.number, like)).limit(8),
      db!.select().from(s.payments).where(ilike(s.payments.ref, like)).limit(8),
    ])
    res.json({ products, customers, invoices, suppliers, salesOrders, purchaseInvoices, payments })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Record a payment against a customer's outstanding invoices ───────────

dbRouter.post('/dues/pay', requirePermission('sales', 'edit'), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not configured' })
    const customer = String(req.body?.customer ?? '').trim()
    const amount = Number(req.body?.amount ?? 0)
    const method = String(req.body?.method ?? 'cash').trim().toLowerCase()
    const allocate = Array.isArray(req.body?.allocate) ? req.body.allocate : null
    if (!customer) return res.status(400).json({ error: 'customer required' })
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' })

    // Open (unpaid, non-cancelled/refunded) invoices for this customer, oldest first
    const open = await db
      .select()
      .from(schema.salesInvoices)
      .where(
        sql`${schema.salesInvoices.customer} = ${customer} and ${schema.salesInvoices.paymentStatus} is distinct from 'paid' and ${schema.salesInvoices.status} is distinct from 'cancelled' and ${schema.salesInvoices.status} is distinct from 'refunded'`,
      )
      .orderBy(sql`${schema.salesInvoices.date} asc`)
    const outstanding = open.reduce((a, inv) => a + Number(inv.grandTotal ?? 0), 0)
    if (open.length === 0) return res.status(400).json({ error: 'No outstanding invoices for this customer' })
    if (amount > outstanding + 0.01) return res.status(400).json({ error: `Amount exceeds outstanding (${outstanding.toFixed(2)})` })

    // Allocation: explicit invoice list or FIFO across oldest first
    let remaining = amount
    const settled: string[] = []
    const touched: Array<{ inv: typeof open[number]; applied: number }> = []
    const plan = allocate
      ? open.filter((inv) => allocate.map(String).includes(inv.id))
      : open
    for (const inv of plan) {
      if (remaining <= 0) break
      const due = Number(inv.grandTotal ?? 0)
      const applied = Math.min(due, remaining)
      if (applied <= 0) continue
      remaining = Math.round((remaining - applied) * 100) / 100
      touched.push({ inv, applied })
      if (applied >= due - 0.01) {
        await db.update(schema.salesInvoices).set({ paymentStatus: 'paid', status: 'paid' }).where(eq(schema.salesInvoices.id, inv.id))
        settled.push(inv.number)
      } else {
        await db.update(schema.salesInvoices).set({ paymentStatus: 'partial' }).where(eq(schema.salesInvoices.id, inv.id))
      }
    }

    const ref = `PAY-${Date.now().toString(36).toUpperCase()}`
    await db.insert(schema.payments).values({
      id: randomUUID(),
      ref,
      invoice: touched[0]?.inv.number ?? null,
      customer,
      amount,
      method,
      gateway: method === 'razorpay' ? 'razorpay' : null,
      status: 'success',
      date: new Date().toISOString(),
      reconciled: true,
    } as any)

    const actor = actorFromRequest(req)
    void recordActivity({
      action: 'Recorded Payment',
      module: 'sales',
      entity: customer,
      details: `${ref} · ₹${amount} (${method})${settled.length ? ` · settled ${settled.join(', ')}` : ''}`,
      userId: actor.userId,
      ip: actor.ip,
    })
    logger.info({ ref, customer, amount, method, settled }, 'Payment recorded from Dues page')
    res.json({ ok: true, ref, settled, remainingOutstanding: Math.round((outstanding - amount) * 100) / 100 })
  } catch (err) {
    logger.error({ err }, 'Record payment failed')
    res.status(500).json({ error: 'Failed to record payment' })
  }
})

// ─── Dues: outstanding summary + on-demand statement email ────────────────

dbRouter.get('/dues', requirePermission('sales', 'view'), async (_req, res) => {
  try {
    const { collectDues } = await import('../statements')
    const dues = await collectDues()
    const total = dues.reduce((a, d) => a + d.total, 0)
    res.json({ dues, total, customerCount: dues.length })
  } catch (err) {
    logger.error({ err }, 'Dues collection failed')
    res.status(500).json({ error: 'Failed to collect dues' })
  }
})

dbRouter.post('/dues/email', requirePermission('sales', 'view'), async (req, res) => {
  try {
    const [settingsRow] = await db!.select().from(schema.settings).where(eq(schema.settings.id, 'app')).limit(1)
    const recipient = String(req.body?.to || '').trim() || process.env.NOTIFICATION_EMAIL?.trim() || settingsRow?.email?.trim()
    if (!recipient) return res.status(400).json({ error: 'No recipient (no "to", NOTIFICATION_EMAIL, or settings.email)' })
    const { collectDues, generateDuesStatementPDF } = await import('../statements')
    const statement = await generateDuesStatementPDF()
    if (!statement) return res.status(200).json({ sent: false, reason: 'No outstanding dues — nothing to send' })
    const { notifyDuesStatement } = await import('../notifications')
    const sent = await notifyDuesStatement(recipient, statement)
    if (sent) logger.info({ recipient }, 'On-demand dues statement emailed')
    res.json({ sent, recipient, total: statement.totalDue, customerCount: statement.customerCount })
  } catch (err) {
    logger.error({ err }, 'Dues statement email failed')
    res.status(500).json({ error: 'Failed to send dues statement' })
  }
})

// ─── Customer account statements (PDF download + email) ───────────────────

dbRouter.get('/customers/:name/statement', requirePermission('sales', 'view'), async (req, res) => {
  try {
    const customer = decodeURIComponent(req.params.name)
    const { generateCustomerStatementPDF } = await import('../statements')
    const statement = await generateCustomerStatementPDF(customer)
    if (!statement) return res.status(404).json({ error: 'No invoices found for this customer' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="statement-${customer.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf"`)
    res.send(statement.buffer)
  } catch (err) {
    logger.error({ err }, 'Customer statement PDF failed')
    res.status(500).json({ error: 'Statement generation failed' })
  }
})

dbRouter.post('/customers/:name/statement/email', requirePermission('sales', 'edit'), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not configured' })
    const customer = decodeURIComponent(req.params.name)
    const to = String(req.body?.to ?? '').trim()
    if (!to) return res.status(400).json({ error: 'Recipient "to" required' })
    const { generateCustomerStatementPDF } = await import('../statements')
    const statement = await generateCustomerStatementPDF(customer)
    if (!statement) return res.status(404).json({ error: 'No invoices found for this customer' })
    const { notifyCustomerStatement } = await import('../notifications')
    const sent = await notifyCustomerStatement(to, customer, statement)
    const actor = actorFromRequest(req)
    void recordActivity({
      action: 'Emailed Customer Statement',
      module: 'sales',
      entity: customer,
      details: `Statement sent to ${to} (${statement.invoiceCount} invoices)`,
      userId: actor.userId,
      ip: actor.ip,
    })
    res.json({ sent, invoiceCount: statement.invoiceCount, outstanding: statement.outstanding })
  } catch (err) {
    logger.error({ err }, 'Customer statement email failed')
    res.status(500).json({ error: 'Statement email failed' })
  }
})

// ─── Razorpay payment link ───────────────────────────────────────────────

dbRouter.post('/dues/payment-link', requirePermission('sales', 'edit'), async (req, res) => {
  try {
    const { createRazorpayPaymentLink, isRazorpayConfigured } = await import('../paymentLinks')
    if (!isRazorpayConfigured()) return res.status(400).json({ error: 'Razorpay not configured (set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET)', configured: false })
    const customer = String(req.body?.customer ?? '').trim()
    const amount = Number(req.body?.amount ?? 0)
    if (!customer) return res.status(400).json({ error: 'customer required' })
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' })
    const link = await createRazorpayPaymentLink({
      amount,
      customer,
      description: `Outstanding dues for ${customer} — Opal Line`,
      referenceId: `OL-${customer.slice(0, 20).replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36).toUpperCase()}`,
    })
    if (!link) return res.status(500).json({ error: 'Failed to create payment link' })
    res.json({ url: link.url, id: link.id, configured: true })
  } catch (err) {
    logger.error({ err }, 'Razorpay payment link failed')
    res.status(500).json({ error: 'Payment link generation failed' })
  }
})

// ─── WhatsApp send (server-side) ────────────────────────────────────────────

dbRouter.post('/send-whatsapp', requirePermission('sales', 'edit'), async (req, res) => {
  try {
    const { sendWhatsAppMessage, isWhatsAppConfigured } = await import('../whatsapp')
    if (!isWhatsAppConfigured()) return res.status(400).json({ error: 'WhatsApp Business API not configured', configured: false })
    const phone = String(req.body?.phone ?? '').trim()
    const message = String(req.body?.message ?? '').trim()
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' })
    const result = await sendWhatsAppMessage(phone, message)
    if (!result) return res.status(500).json({ error: 'WhatsApp send failed', configured: true })
    const actor = actorFromRequest(req)
    void recordActivity({ action: 'Sent WhatsApp', module: 'sales', entity: phone, details: message.slice(0, 100), userId: actor.userId, ip: actor.ip })
    res.json({ ok: true, messageId: result.messageId, configured: true })
  } catch (err) {
    logger.error({ err }, 'WhatsApp send endpoint failed')
    res.status(500).json({ error: 'WhatsApp send failed' })
  }
})

// ─── Supplier purchase invoice aging (outstanding dues) ────────────────────

dbRouter.get('/supplier-dues', requirePermission('purchase', 'view'), async (_req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not configured' })
    const rows = await db
      .select({
        supplier: schema.purchaseInvoices.supplier,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${schema.purchaseInvoices.total}), 0)::float`,
        oldestDate: sql<string | null>`min(${schema.purchaseInvoices.date})::text`,
      })
      .from(schema.purchaseInvoices)
      .where(sql`${schema.purchaseInvoices.status} is distinct from 'paid'`)
      .groupBy(schema.purchaseInvoices.supplier)
      .orderBy(sql`coalesce(sum(${schema.purchaseInvoices.total}), 0) desc`)
    const total = rows.reduce((a, r) => a + Number(r.total ?? 0), 0)
    res.json({ dues: rows.map((r) => ({ supplier: r.supplier ?? 'Unknown', count: Number(r.count ?? 0), total: Number(r.total ?? 0), oldestDate: r.oldestDate })), total, supplierCount: rows.length })
  } catch (err) {
    logger.error({ err }, 'Supplier dues query failed')
    res.status(500).json({ error: 'Failed to load supplier dues' })
  }
})

// ─── Notification settings ─────────────────────────────────────────────────

dbRouter.get('/settings/notifications', requirePermission('system', 'view'), async (_req, res) => {
  try {
    const [row] = await db!.select().from(schema.settings).where(sql`${schema.settings.id} = 'app'`).limit(1)
    const notif = (row as any)?.notificationSettings ?? {
      dailySummaryEnabled: true,
      monthlyStatementsEnabled: true,
      dueRemindersEnabled: true,
      weeklyReportEnabled: true,
      recipientEmail: process.env.NOTIFICATION_EMAIL ?? '',
    }
    res.json(notif)
  } catch (err) {
    logger.error({ err }, 'Notification settings load failed')
    res.status(500).json({ error: 'Failed to load notification settings' })
  }
})

dbRouter.put('/settings/notifications', requirePermission('system', 'edit'), async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const [row] = await db!.select().from(schema.settings).where(sql`${schema.settings.id} = 'app'`).limit(1)
    const existing = (row as any)?.notificationSettings ?? {}
    const merged = { ...existing, ...body }
    await db!.update(schema.settings).set({ notificationSettings: merged } as any).where(sql`${schema.settings.id} = 'app'`)
    const actor = actorFromRequest(req)
    void recordActivity({ action: 'Updated Notification Settings', module: 'system', entity: 'Notifications', details: Object.keys(body).join(', '), userId: actor.userId, ip: actor.ip })
    res.json(merged)
  } catch (err) {
    logger.error({ err }, 'Notification settings update failed')
    res.status(500).json({ error: 'Failed to update notification settings' })
  }
})

// ─── Invoice PDF Download ──────────────────────────────────────────────────

dbRouter.get('/invoices/:id/pdf', requirePermission('sales', 'view'), async (req, res) => {
  try {
    const { generateInvoicePDF } = await import('../invoicePdf')
    const pdf = await generateInvoicePDF(req.params.id)
    if (!pdf) return res.status(404).json({ error: 'Invoice not found or PDF generation failed' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.id}.pdf"`)
    res.send(pdf)
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed' })
  }
})

// ─── Credit Note PDF Download (for a sales return) ──────────────────────────

dbRouter.get('/credit-notes/:id/pdf', requirePermission('sales', 'view'), async (req, res) => {
  try {
    const { generateCreditNotePDF } = await import('../creditNotePdf')
    const pdf = await generateCreditNotePDF(req.params.id)
    if (!pdf) return res.status(404).json({ error: 'Credit note not found or PDF generation failed' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="credit-note-${req.params.id}.pdf"`)
    res.send(pdf)
  } catch (err) {
    res.status(500).json({ error: 'Credit note PDF generation failed' })
  }
})


