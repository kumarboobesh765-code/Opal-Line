import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import argon2 from 'argon2'
import { desc, eq, ilike, inArray, sql } from 'drizzle-orm'
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
    const { fetchAllProductLabels, generateLabelsPDF, LABEL_PRESETS } = await import('../barcodeLabels')
    const preset = String(req.query.preset || 'zlabel-50x30')
    const showPrice = req.query.price !== 'false'
    const showWeight = req.query.weight !== 'false'
    const showQR = req.query.qr !== 'false'
    const products = await fetchAllProductLabels()
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
    }
    res.json({ created: Boolean(invoiceNumber) && !existing, invoiceNumber })
  } catch (err) {
    logger.error({ err }, 'create-invoice for order failed')
    res.status(500).json({ error: 'Failed to create invoice from order' })
  }
})

dbRouter.get('/purchase-orders', listOf(s.purchaseOrders, s.purchaseOrders.date))
dbRouter.get('/purchase-orders/:id', oneOf(s.purchaseOrders, s.purchaseOrders.id))

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


