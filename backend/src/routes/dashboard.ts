import { Router, type Response } from 'express'
import { and, desc, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { CONSTANTS } from '../constants'

export const dashboardRouter = Router()

function requireDb(res: Response) {
  if (!db) {
    res.status(503).json({ error: 'Database is temporarily unavailable' })
    return false
  }
  return true
}

const round2 = (n: number) => Math.round(n * 100) / 100

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const compactInr = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`
  return `₹${Math.round(n)}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function localDayStart(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`
}

function localMonthStart(offsetMonths = 0) {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() + offsetMonths)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01T00:00:00`
}

const num = (v: unknown): number => Number(v ?? 0) || 0

const PENDING_STATUS = new Set(['pending', 'partial'])
const OUTSTANDING_SQL = sql`(payment_status in ('pending','partial') or status = 'overdue')`

async function loadInvoices() {
  return db!.select().from(schema.salesInvoices).where(sql`true`).limit(10000)
}

function dayBucket(invDate: string | null) {
  return String(invDate ?? '').slice(0, 10)
}

function hourOf(invDate: string | null) {
  return String(invDate ?? '').slice(11, 13)
}

function pct(part: number, whole: number) {
  if (!whole) return '—'
  const v = Math.round((part / whole) * 1000) / 10
  return `${v}%`
}

const iconFor = (name: string, category: string | null): string => {
  const n = `${name} ${category ?? ''}`.toLowerCase()
  if (/ring|band/.test(n)) return 'ring'
  if (/chain|necklace|mala|locket/.test(n)) return 'chain'
  if (/bracelet|bangle/.test(n)) return 'bracelet'
  if (/pendant|lock/.test(n)) return 'pendant'
  if (/earring|jhumka/.test(n)) return 'earrings'
  return 'package'
}

dashboardRouter.get('/dashboard/kpis', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const invoices = await loadInvoices()
    const orders = await db!.select({ date: schema.salesOrders.date }).from(schema.salesOrders)
    const todayStart = localDayStart(0)
    const todayEnd = localDayStart(1)
    const yesterdayStart = localDayStart(-1)
    const yesterdayEnd = todayStart

    const today = invoices.filter((i) => String(i.date ?? '') >= todayStart && String(i.date ?? '') < todayEnd)
    const yesterday = invoices.filter((i) => String(i.date ?? '') >= yesterdayStart && String(i.date ?? '') < yesterdayEnd)
    const todayOrders = orders.filter((o) => String(o.date ?? '') >= todayStart && String(o.date ?? '') < todayEnd).length
    const yesterdayOrders = orders.filter((o) => String(o.date ?? '') >= yesterdayStart && String(o.date ?? '') < yesterdayEnd).length
    const sum = (rows: typeof today) => rows.reduce((a, r) => a + num(r.grandTotal), 0)
    const sumProfit = (rows: typeof today) => rows.reduce((a, r) => a + (num(r.grandTotal) - num(r.silverValue) - num(r.makingCharge)), 0)

    const todaySales = sum(today)
    const yesterdaySales = sum(yesterday)
    const todayInvoices = today.length
    const yesterdayInvoices = yesterday.length
    const grossProfit = sumProfit(today)
    const grossProfitPrev = sumProfit(yesterday)
    const outstanding = invoices.filter((i) => PENDING_STATUS.has(String(i.paymentStatus ?? '')) || String(i.status ?? '') === 'overdue').reduce((a, r) => a + num(r.grandTotal), 0)

    const [{ lowStock }] = await db!.select({ lowStock: sql<number>`count(*)` }).from(schema.products).where(sql`stock is not null and reorder_level is not null and stock <= reorder_level`)

    const delta = (cur: number, prev: number) => (prev > 0 ? `${Math.round((((cur - prev) / prev) * 100) * 10) / 10}%` : '—')
    const trend = (cur: number, prev: number): 'up' | 'down' | 'flat' => (cur > prev ? 'up' : cur < prev ? 'down' : 'flat')

    res.json([
      { key: 'todaySales', label: "Today's Sales", value: inr(todaySales), trend: trend(todaySales, yesterdaySales), delta: delta(todaySales, yesterdaySales), deltaLabel: 'vs yesterday', icon: 'indian-rupee', accent: 'purple' },
      { key: 'todayOrders', label: "Today's Orders", value: String(todayOrders), trend: trend(todayOrders, yesterdayOrders), delta: delta(todayOrders, yesterdayOrders), deltaLabel: 'vs yesterday', icon: 'shopping-bag', accent: 'blue' },
      { key: 'todayInvoices', label: "Today's Invoices", value: String(todayInvoices), trend: trend(todayInvoices, yesterdayInvoices), delta: delta(todayInvoices, yesterdayInvoices), deltaLabel: 'vs yesterday', icon: 'file-text', accent: 'green' },
      { key: 'grossProfit', label: 'Gross Profit', value: inr(grossProfit), trend: trend(grossProfit, grossProfitPrev), delta: delta(grossProfit, grossProfitPrev), deltaLabel: 'vs yesterday', icon: 'trending-up', accent: 'orange' },
      { key: 'outstanding', label: 'Outstanding', value: inr(outstanding), trend: 'flat', delta: '—', deltaLabel: `${invoices.filter((i) => PENDING_STATUS.has(String(i.paymentStatus ?? '')) || String(i.status ?? '') === 'overdue').length} invoices`, icon: 'clock', accent: 'red' },
      { key: 'lowStock', label: 'Low Stock Items', value: String(lowStock), trend: 'flat', delta: '—', deltaLabel: 'Needs Reorder', icon: 'package-x', accent: 'slate' },
    ])
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/summary', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const [products, customers, suppliers, expenses, invoices] = await Promise.all([
      db!.select().from(schema.products),
      db!.select().from(schema.customers),
      db!.select().from(schema.suppliers),
      db!.select().from(schema.expenses),
      loadInvoices(),
    ])

    const todayStart = localDayStart(0)
    const todayEnd = localDayStart(1)
    const todayExpenses = expenses.filter((e) => String(e.date ?? '') >= todayStart && String(e.date ?? '') < todayEnd).reduce((a, e) => a + num(e.amount), 0)
    const pendingPayments = invoices.filter((i) => PENDING_STATUS.has(String(i.paymentStatus ?? '')) || String(i.status ?? '') === 'overdue').reduce((a, r) => a + num(r.grandTotal), 0)

    res.json({
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.status === 'active').length,
      totalCustomers: customers.length,
      activeCustomers: customers.filter((c) => c.status === 'active').length,
      totalSuppliers: suppliers.length,
      activeSuppliers: suppliers.filter((s) => s.status === 'active').length,
      totalStockQty: products.reduce((a, p) => a + num(p.stock), 0),
      totalStockWeight: round2(products.reduce((a, p) => a + num(p.stock) * num(p.netWeight), 0)),
      todayExpenses: round2(todayExpenses),
      pendingPayments: round2(pendingPayments),
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/sales-overview', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const invoices = await loadInvoices()
    const period = String(req.query.period ?? 'week')

    if (period === 'today') {
      const points: { date: string; label: string; revenue: number; orders: number }[] = []
      for (let h = 0; h < 24; h++) {
        const hh = pad(h)
        const day = localDayStart(0).slice(0, 10)
        const key = `${day}T${hh}`
        const bucket = invoices.filter((i) => String(i.date ?? '').startsWith(key))
        points.push({
          date: `${day}T${hh}:00:00`,
          label: `${hh}:00`,
          revenue: round2(bucket.reduce((a, r) => a + num(r.grandTotal), 0)),
          orders: bucket.length,
        })
      }
      return res.json(points)
    }

    if (period === 'month') {
      const points = []
      const today = new Date()
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        const bucket = invoices.filter((inv) => dayBucket(inv.date) === key)
        points.push({
          date: key,
          label: `${key.slice(8, 10)} ${d.toLocaleDateString('en-IN', { month: 'short' })}`,
          revenue: round2(bucket.reduce((a, r) => a + num(r.grandTotal), 0)),
          orders: bucket.length,
        })
      }
      return res.json(points)
    }

    if (period === 'year') {
      const points = []
      const today = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
        const bucket = invoices.filter((inv) => String(inv.date ?? '').startsWith(key))
        points.push({
          date: `${key}-01`,
          label: d.toLocaleDateString('en-IN', { month: 'short' }),
          revenue: round2(bucket.reduce((a, r) => a + num(r.grandTotal), 0)),
          orders: bucket.length,
        })
      }
      return res.json(points)
    }

    if (period === 'custom') {
      const startParam = String(req.query.start ?? '')
      const endParam = String(req.query.end ?? '')
      const start = startParam ? new Date(`${startParam}T00:00:00`) : null
      const end = endParam ? new Date(`${endParam}T00:00:00`) : null
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Valid start and end dates (YYYY-MM-DD) are required for custom period' })
      }
      start.setHours(0, 0, 0, 0)
      end.setHours(0, 0, 0, 0)
      const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
      if (totalDays < 1) {
        return res.status(400).json({ error: 'End date must be on or after start date' })
      }
      if (totalDays > 366) {
        return res.status(400).json({ error: 'Custom range cannot exceed 366 days' })
      }
      const points = []
      const cursor = new Date(start)
      for (let i = 0; i < totalDays; i++) {
        const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`
        const bucket = invoices.filter((inv) => dayBucket(inv.date) === key)
        points.push({
          date: key,
          label: `${cursor.toLocaleDateString('en-IN', { weekday: 'short' })} ${key.slice(8, 10)}`,
          revenue: round2(bucket.reduce((a, r) => a + num(r.grandTotal), 0)),
          orders: bucket.length,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
      return res.json(points)
    }

    const points = []
    const today = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const bucket = invoices.filter((inv) => dayBucket(inv.date) === key)
      points.push({
        date: key,
        label: `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${key.slice(8, 10)}`,
        revenue: round2(bucket.reduce((a, r) => a + num(r.grandTotal), 0)),
        orders: bucket.length,
      })
    }
    res.json(points)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/top-products', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const [items, products] = await Promise.all([db!.select().from(schema.salesInvoiceItems), db!.select().from(schema.products)])
    const bySku = new Map<string, { id: string; name: string; category: string | null }>()
    for (const p of products) bySku.set(String(p.sku ?? '').toLowerCase(), { id: p.id, name: p.name, category: p.category })

    const agg = new Map<string, { id: string; name: string; sku: string; qty: number; weight: number; revenue: number; icon: string }>()
    for (const it of items) {
      const sku = String(it.sku ?? '')
      if (!sku) continue
      const key = sku.toLowerCase()
      const meta = bySku.get(key)
      const entry = agg.get(key) ?? {
        id: meta?.id ?? it.sku ?? '',
        name: meta?.name ?? it.product ?? sku,
        sku,
        qty: 0,
        weight: 0,
        revenue: 0,
        icon: iconFor(meta?.name ?? it.product ?? '', meta?.category ?? null),
      }
      entry.qty += num(it.qty)
      entry.weight = round2(entry.weight + num(it.weight))
      entry.revenue = round2(entry.revenue + num(it.amount))
      agg.set(key, entry)
    }

    res.json([...agg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5))
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/payment-status', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const invoices = await loadInvoices()
    const segment = (pred: (i: typeof invoices[number]) => boolean) => {
      const rows = invoices.filter(pred)
      return { value: round2(rows.reduce((a, r) => a + num(r.grandTotal), 0)), count: rows.length }
    }
    const paid = segment((i) => String(i.paymentStatus ?? '') === 'paid' && String(i.status ?? '') !== 'overdue')
    const pending = segment((i) => PENDING_STATUS.has(String(i.paymentStatus ?? '')))
    const failed = segment((i) => String(i.paymentStatus ?? '') === 'failed' || String(i.status ?? '') === 'overdue')
    const total = round2(invoices.reduce((a, r) => a + num(r.grandTotal), 0))

    res.json({
      segments: [
        { status: 'paid', label: 'Paid', ...paid },
        { status: 'pending', label: 'Pending', ...pending },
        { status: 'failed', label: 'Failed / Overdue', ...failed },
      ],
      total,
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/low-stock', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!
      .select()
      .from(schema.products)
      .where(sql`stock is not null and reorder_level is not null and stock <= reorder_level`)
      .orderBy(sql`stock asc`)

    res.json(
      rows.map((p) => ({
        id: p.id,
        product: p.name,
        sku: p.sku,
        stock: num(p.stock),
        reorderLevel: num(p.reorderLevel),
        status: num(p.stock) === 0 || num(p.stock) * 2 <= num(p.reorderLevel) ? ('critical' as const) : ('low' as const),
      })),
    )
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

const IST_TIMEZONE = 'Asia/Kolkata'

function parseTimestamp(value: string): Date {
  const s = value.trim()
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) return new Date(s)
  const body = s.includes('T') ? s : s.replace(' ', 'T')
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(body) ? `${body}T00:00:00Z` : `${body}Z`)
}

const istDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function istDayKey(d: Date): string {
  return istDayKeyFormatter.format(d).replace(/-/g, '-')
}

const istTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const istDayFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short' })

function friendlyTime(iso: string | null) {
  if (!iso) return ''
  const d = parseTimestamp(iso)
  if (Number.isNaN(d.getTime())) return iso
  const sameDay = istDayKey(d) === istDayKey(new Date())
  const hm = istTimeFormatter.format(d)
  if (sameDay) return `Today, ${hm}`
  return `${istDayFormatter.format(d)}, ${hm}`
}

function activityType(module: string | null, action: string | null): string {
  const m = String(module ?? '').toLowerCase()
  const a = String(action ?? '').toLowerCase()
  if (/silver/.test(m)) return 'silver-rate'
  if (/payment/.test(m) || /reconcil/.test(a)) return 'payment'
  if (/invoice|sales/.test(m)) return 'invoice'
  if (/product/.test(m)) return 'product'
  if (/shopify|sync/.test(m)) return a.includes('failed') ? 'sync' : 'shopify-import'
  if (/purchase/.test(m)) return 'purchase'
  if (/user/.test(m)) return 'user'
  return 'sync'
}

dashboardRouter.get('/dashboard/activities', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const logs = await db!.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.timestamp)).limit(10)
    res.json(
      logs.map((l) => ({
        id: l.id,
        type: activityType(l.module, l.action),
        title: `${l.action ?? 'Activity'}${l.entity && !String(l.action ?? '').includes(l.entity) ? ` · ${l.entity}` : ''}`,
        detail: l.changes ?? undefined,
        actor: l.user ?? 'System',
        time: friendlyTime(l.timestamp),
      })),
    )
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/analytics', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const invoices = await loadInvoices()
    const returns = await db!.select({ amount: schema.salesReturns.amount }).from(schema.salesReturns)
    const products = await db!.select({ stock: schema.products.stock, sellingPrice: schema.products.sellingPrice }).from(schema.products)

    const monthStart = localMonthStart(0)
    const prevMonthStart = localMonthStart(-1)
    const inMonth = (i: typeof invoices[number]) => String(i.date ?? '') >= monthStart
    const inPrevMonth = (i: typeof invoices[number]) => String(i.date ?? '') >= prevMonthStart && String(i.date ?? '') < monthStart

    const summarize = (rows: typeof invoices) => {
      const sales = rows.reduce((a, r) => a + num(r.grandTotal), 0)
      const count = rows.length
      const cost = rows.reduce((a, r) => a + (num(r.silverValue) + num(r.makingCharge)), 0)
      return { sales, count, margin: sales > 0 ? (sales - cost) / sales : 0 }
    }

    const cur = summarize(invoices.filter(inMonth))
    const prev = summarize(invoices.filter(inPrevMonth))
    const totalSales = invoices.reduce((a, r) => a + num(r.grandTotal), 0)
    const returnRate = totalSales > 0 ? (returns.reduce((a, r) => a + num(r.amount), 0) / totalSales) * 100 : 0
    const inventoryValue = products.reduce((a, p) => a + num(p.stock) * num(p.sellingPrice), 0)

    const pctDelta = (a: number, b: number) => (b > 0 ? `${Math.round((((a - b) / b) * 100) * 10) / 10}%` : '—')

    res.json([
      { label: 'Total Sales (This Month)', value: inr(cur.sales), delta: pctDelta(cur.sales, prev.sales), trend: cur.sales >= prev.sales ? 'up' : 'down' },
      { label: 'Total Orders (This Month)', value: String(cur.count), delta: pctDelta(cur.count, prev.count), trend: cur.count >= prev.count ? 'up' : 'down' },
      { label: 'Average Order Value', value: cur.count > 0 ? inr(cur.sales / cur.count) : inr(0), delta: pctDelta(cur.count ? cur.sales / cur.count : 0, prev.count ? prev.sales / prev.count : 0), trend: cur.count && prev.count && cur.sales / cur.count >= prev.sales / prev.count ? 'up' : 'down' },
      { label: 'Return Rate', value: `${round2(returnRate)}%`, delta: `${round2(returnRate)}%`, trend: 'down' },
      { label: 'Gross Profit Margin', value: `${round2(cur.margin * 100)}%`, delta: pctDelta(cur.margin, prev.margin), trend: cur.margin >= prev.margin ? 'up' : 'down' },
      { label: 'Inventory Value', value: inr(inventoryValue) },
    ])
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/inventory-overview', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const products = await db!.select().from(schema.products)
    res.json({
      totalProducts: products.length,
      totalQuantity: products.reduce((a, p) => a + num(p.stock), 0),
      totalWeight: round2(products.reduce((a, p) => a + num(p.stock) * num(p.netWeight), 0)),
      inventoryValue: round2(products.reduce((a, p) => a + num(p.stock) * num(p.sellingPrice), 0)),
      lowStock: products.filter((p) => num(p.stock) <= num(p.reorderLevel)).length,
      outOfStock: products.filter((p) => num(p.stock) === 0).length,
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/stock-categories', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const rows = await db!
      .select({
        category: schema.products.category,
        products: sql<number>`count(*)::int`,
        qty: sql<number>`coalesce(sum(stock),0)::int`,
        weight: sql<number>`coalesce(sum(stock * coalesce(net_weight,0)),0)`,
        value: sql<number>`coalesce(sum(stock * coalesce(selling_price,0)),0)`,
      })
      .from(schema.products)
      .where(and(ne(schema.products.category, '')))
      .groupBy(schema.products.category)
    res.json(rows.sort((a, b) => b.qty - a.qty))
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/reports/gst', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const [invoices, purchaseInvoices] = await Promise.all([loadInvoices(), db!.select().from(schema.purchaseInvoices)])

    const monthParam = Number(req.query.month)
    const target = Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : new Date().getMonth() + 1
    const yearParam = Number(req.query.year)
    const year = Number.isFinite(yearParam) && yearParam >= 2000 && yearParam <= 2200 ? yearParam : new Date().getFullYear()
    const prefix = `${year}-${pad(target)}`
    const rows = invoices.filter((i) => String(i.date ?? '').startsWith(prefix))

    const isBusiness = (name: string) => /house|jewels|llp|pvt|ltd|exports|trading|industries|firm|company|corp/i.test(name)
    const b2b = rows.filter((i) => isBusiness(String(i.customer ?? '')))
    const b2c = rows.filter((i) => !isBusiness(String(i.customer ?? '')))
    const taxableOf = (r: typeof rows) => r.reduce((a, i) => a + (num(i.subtotal) - num(i.discount)), 0)
    const gstOf = (r: typeof rows) => r.reduce((a, i) => a + num(i.gstAmount), 0)

    const taxable = taxableOf(rows)
    const outputGst = gstOf(rows)
    const inputGst = purchaseInvoices.filter((p) => String(p.date ?? '').startsWith(prefix)).reduce((a, p) => a + num(p.tax), 0)
    const netGst = Math.max(0, round2(outputGst - inputGst))
    const itcUtilised = round2(Math.min(inputGst, outputGst))

    const months: { label: string; gst: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const p = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      months.push({
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        gst: round2(gstOf(invoices.filter((inv) => String(inv.date ?? '').startsWith(p)))),
      })
    }

    const filingMonths: { month: string; status: string; variant: 'warning' | 'success' | 'muted' }[] = []
    const invoiceDates = invoices.map((i) => String(i.date ?? '').slice(0, 7))
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      const hasInvoices = invoiceDates.some((dt) => dt.startsWith(key))
      filingMonths.push({
        month: label,
        status: i === 0 ? 'In Progress' : hasInvoices ? 'Filed' : 'No Data',
        variant: i === 0 ? 'warning' : hasInvoices ? 'success' : 'muted',
      })
    }

    res.json({
      summary: { taxable: round2(taxable), outputGst: round2(outputGst), inputGst: round2(inputGst), netGst, itcUtilised, cgst: round2(netGst / 2), sgst: round2(netGst / 2) },
      gstr1: {
        b2b: { invoices: b2b.length, taxable: round2(taxableOf(b2b)) },
        b2c: { invoices: b2c.length, taxable: round2(taxableOf(b2c)) },
        exports: { invoices: 0, taxable: 0 },
        notes: { invoices: rows.filter((i) => i.status === 'refunded' || i.status === 'cancelled').length, taxable: 0 },
        nilRated: { invoices: rows.filter((i) => !num(i.grandTotal)).length, taxable: 0 },
      },
      monthly: months,
      filing: filingMonths,
      gstin: CONSTANTS.GSTIN_DEFAULT,
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

dashboardRouter.get('/dashboard/stock-running', async (_req, res) => {
  if (!requireDb(res)) return
  try {
    const [items, products] = await Promise.all([
      db!.select().from(schema.salesInvoiceItems),
      db!.select().from(schema.products),
    ])

    const salesBySku = new Map<string, number>()
    for (const it of items) {
      const sku = String(it.sku ?? '').toLowerCase()
      if (!sku) continue
      salesBySku.set(sku, (salesBySku.get(sku) ?? 0) + num(it.qty))
    }

    const now = Date.now()
    const msPerDay = 86400000

    const results = products.map((p) => {
      const sku = String(p.sku ?? '').toLowerCase()
      const totalSold = salesBySku.get(sku) ?? 0
      const createdAt = p.createdAt ? new Date(String(p.createdAt)) : null
      const daysSinceCreation = createdAt && !Number.isNaN(createdAt.getTime()) ? Math.max(1, Math.floor((now - createdAt.getTime()) / msPerDay)) : 1
      const avgDailySales = totalSold / daysSinceCreation
      const stock = num(p.stock)
      const daysOfStock = avgDailySales > 0 ? Math.round(stock / avgDailySales) : 999
      const demandLevel: 'high' | 'medium' | 'low' | 'none' = avgDailySales >= 2 ? 'high' : avgDailySales >= 0.5 ? 'medium' : avgDailySales > 0 ? 'low' : 'none'
      const stockValue = round2(stock * num(p.sellingPrice))

      return {
        id: p.id,
        name: p.name,
        sku: p.sku ?? '',
        category: p.category ?? '',
        currentStock: stock,
        reorderLevel: num(p.reorderLevel),
        totalSold,
        avgDailySales: round2(avgDailySales),
        daysOfStock,
        demandLevel,
        stockValue,
      }
    })

    results.sort((a, b) => b.avgDailySales - a.avgDailySales)
    const top50 = results.slice(0, 50)

    const highDemand = top50.filter((p) => p.demandLevel === 'high').length
    const mediumDemand = top50.filter((p) => p.demandLevel === 'medium').length
    const atRisk = top50.filter((p) => p.avgDailySales > 0 && p.daysOfStock <= 7).length
    const totalStockValue = round2(top50.reduce((a, p) => a + p.stockValue, 0))

    res.json({
      products: top50,
      summary: {
        totalProducts: top50.length,
        highDemand,
        mediumDemand,
        atRisk,
        totalStockValue,
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})
