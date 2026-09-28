// ─── Reports: HSN summary, GST reconciliation, sales/purchase registers, TDS ───
// Extracted verbatim from index.ts; same paths, same guards.
import { Router, type Request, type Response } from 'express'
import { getRawClient } from '../db/client'
import { requirePermission } from '../rbac'
import { requireAuth } from '../sessions'
import { logger } from '../logger'

export const reportsRouter = Router()

function requireDbReports(res: Response): boolean {
  const client = getRawClient()
  if (!client) {
    res.status(503).json({ error: 'Database is temporarily unavailable' })
    return false
  }
  return true
}

function parseReportDates(req: Request): { from: string; to: string } | null {
  const from = String(req.query.from ?? '').trim()
  const to = String(req.query.to ?? '').trim()
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null
  }
  return { from, to }
}

// GET /api/v1/reports/hsn-summary
reportsRouter.get('/hsn-summary', requireAuth, requirePermission('reports', 'view'), async (req, res) => {
  if (!requireDbReports(res)) return
  const dates = parseReportDates(req)
  if (!dates) return res.status(400).json({ error: 'Invalid or missing "from" / "to" query parameters (YYYY-MM-DD)' })

  try {
    const client = getRawClient()!
    const rows = await client.unsafe(`
      SELECT
        p.hsn AS hsn_code,
        p.name AS product_name,
        SUM(ii.qty) AS total_quantity,
        SUM(ii.amount) AS taxable_value,
        SUM(ii.tax) AS gst_amount,
        p.gst AS gst_rate
      FROM sales_invoice_items ii
      JOIN products p ON ii.sku = p.sku
      WHERE ii.invoice_id IN (
        SELECT id FROM sales_invoices
        WHERE date BETWEEN $1 AND $2
      )
      GROUP BY p.hsn, p.name, p.gst
      ORDER BY taxable_value DESC
    `, [dates.from + 'T00:00:00', dates.to + 'T23:59:59'])

    const summary = rows.map((r: any) => ({
      hsnCode: r.hsn_code ?? null,
      productName: r.product_name ?? null,
      totalQuantity: Number(r.total_quantity ?? 0),
      taxableValue: Number(r.taxable_value ?? 0),
      gstAmount: Number(r.gst_amount ?? 0),
      gstRate: Number(r.gst_rate ?? 0),
    }))

    const totals = summary.reduce(
      (acc, row) => ({
        taxableValue: acc.taxableValue + row.taxableValue,
        gstAmount: acc.gstAmount + row.gstAmount,
        totalQuantity: acc.totalQuantity + row.totalQuantity,
      }),
      { taxableValue: 0, gstAmount: 0, totalQuantity: 0 },
    )

    res.json({ items: summary, totals })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err: message }, 'HSN summary report failed')
    res.status(500).json({ error: message })
  }
})

// GET /api/v1/reports/gst-reconciliation
reportsRouter.get('/gst-reconciliation', requireAuth, requirePermission('reports', 'view'), async (req, res) => {
  if (!requireDbReports(res)) return
  const dates = parseReportDates(req)
  if (!dates) return res.status(400).json({ error: 'Invalid or missing "from" / "to" query parameters (YYYY-MM-DD)' })

  try {
    const client = getRawClient()!
    const range = [dates.from + 'T00:00:00', dates.to + 'T23:59:59']

    // Sales totals
    const [salesTotals] = await client.unsafe(`
      SELECT
        COALESCE(SUM(subtotal), 0) AS taxable_value,
        COALESCE(SUM(gst_amount), 0) AS gst_amount,
        COALESCE(SUM(grand_total), 0) AS grand_total,
        COUNT(*) AS invoice_count
      FROM sales_invoices
      WHERE date BETWEEN $1 AND $2
    `, range) as any[]

    // Sales breakup by GST rate
    const salesByRate = await client.unsafe(`
      SELECT
        p.gst AS gst_rate,
        SUM(ii.amount) AS taxable_value,
        SUM(ii.tax) AS gst_amount
      FROM sales_invoice_items ii
      JOIN products p ON ii.sku = p.sku
      WHERE ii.invoice_id IN (
        SELECT id FROM sales_invoices
        WHERE date BETWEEN $1 AND $2
      )
      GROUP BY p.gst
      ORDER BY p.gst
    `, range) as any[]

    // Purchase totals
    const [purchaseTotals] = await client.unsafe(`
      SELECT
        COALESCE(SUM(cost), 0) AS total_cost,
        COALESCE(SUM(tax), 0) AS total_tax,
        COALESCE(SUM(total), 0) AS grand_total,
        COUNT(*) AS invoice_count
      FROM purchase_invoices
      WHERE date BETWEEN $1 AND $2
    `, range) as any[]

    const totalSalesGST = Number(salesTotals?.gst_amount ?? 0)
    const totalPurchaseITC = Number(purchaseTotals?.total_tax ?? 0)
    const netGstPayable = totalSalesGST - totalPurchaseITC

    res.json({
      period: { from: dates.from, to: dates.to },
      sales: {
        invoiceCount: Number(salesTotals?.invoice_count ?? 0),
        taxableValue: Number(salesTotals?.taxable_value ?? 0),
        gstAmount: totalSalesGST,
        grandTotal: Number(salesTotals?.grand_total ?? 0),
        cgst: Math.round(totalSalesGST / 2 * 100) / 100,
        sgst: Math.round(totalSalesGST / 2 * 100) / 100,
        igst: 0,
      },
      purchases: {
        invoiceCount: Number(purchaseTotals?.invoice_count ?? 0),
        totalCost: Number(purchaseTotals?.total_cost ?? 0),
        itc: totalPurchaseITC,
        grandTotal: Number(purchaseTotals?.grand_total ?? 0),
      },
      netGstPayable,
      rateBreakup: salesByRate.map((r: any) => ({
        gstRate: Number(r.gst_rate ?? 0),
        taxableValue: Number(r.taxable_value ?? 0),
        gstAmount: Number(r.gst_amount ?? 0),
        cgst: Math.round(Number(r.gst_amount ?? 0) / 2 * 100) / 100,
        sgst: Math.round(Number(r.gst_amount ?? 0) / 2 * 100) / 100,
        igst: 0,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err: message }, 'GST reconciliation report failed')
    res.status(500).json({ error: message })
  }
})

// GET /api/v1/reports/sales-register
reportsRouter.get('/sales-register', requireAuth, requirePermission('reports', 'view'), async (req, res) => {
  if (!requireDbReports(res)) return
  const dates = parseReportDates(req)
  if (!dates) return res.status(400).json({ error: 'Invalid or missing "from" / "to" query parameters (YYYY-MM-DD)' })

  try {
    const client = getRawClient()!
    const rows = await client.unsafe(`
      SELECT
        number AS invoice_number,
        date AS invoice_date,
        customer AS customer_name,
        subtotal AS taxable_amount,
        gst_amount,
        grand_total AS total_amount,
        tds_amount,
        payment_status
      FROM sales_invoices
      WHERE date BETWEEN $1 AND $2
      ORDER BY date DESC
    `, [dates.from + 'T00:00:00', dates.to + 'T23:59:59'])

    res.json({
      items: rows.map((r: any) => ({
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        customerName: r.customer_name,
        taxableAmount: Number(r.taxable_amount ?? 0),
        gstAmount: Number(r.gst_amount ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
        tdsAmount: Number(r.tds_amount ?? 0),
        paymentStatus: r.payment_status,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err: message }, 'Sales register report failed')
    res.status(500).json({ error: message })
  }
})

// GET /api/v1/reports/purchase-register
reportsRouter.get('/purchase-register', requireAuth, requirePermission('reports', 'view'), async (req, res) => {
  if (!requireDbReports(res)) return
  const dates = parseReportDates(req)
  if (!dates) return res.status(400).json({ error: 'Invalid or missing "from" / "to" query parameters (YYYY-MM-DD)' })

  try {
    const client = getRawClient()!
    const rows = await client.unsafe(`
      SELECT
        number AS invoice_number,
        date AS invoice_date,
        supplier AS supplier_name,
        cost AS taxable_amount,
        tax AS gst_amount,
        total AS total_amount
      FROM purchase_invoices
      WHERE date BETWEEN $1 AND $2
      ORDER BY date DESC
    `, [dates.from + 'T00:00:00', dates.to + 'T23:59:59'])

    res.json({
      items: rows.map((r: any) => ({
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        supplierName: r.supplier_name,
        taxableAmount: Number(r.taxable_amount ?? 0),
        gstAmount: Number(r.gst_amount ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err: message }, 'Purchase register report failed')
    res.status(500).json({ error: message })
  }
})

// GET /api/v1/reports/tds-report
reportsRouter.get('/tds-report', requireAuth, requirePermission('reports', 'view'), async (req, res) => {
  if (!requireDbReports(res)) return
  const dates = parseReportDates(req)
  if (!dates) return res.status(400).json({ error: 'Invalid or missing "from" / "to" query parameters (YYYY-MM-DD)' })

  try {
    const client = getRawClient()!
    const rows = await client.unsafe(`
      SELECT
        customer AS customer_name,
        buyer_gstin AS pan,
        tds_section AS section,
        subtotal AS amount,
        tds_amount
      FROM sales_invoices
      WHERE date BETWEEN $1 AND $2
        AND tds_type IS NOT NULL
        AND tds_type != 'none'
        AND COALESCE(tds_amount, 0) > 0
      ORDER BY date DESC
    `, [dates.from + 'T00:00:00', dates.to + 'T23:59:59'])

    res.json({
      items: rows.map((r: any) => ({
        customerName: r.customer_name,
        pan: r.pan,
        section: r.section,
        amount: Number(r.amount ?? 0),
        tdsAmount: Number(r.tds_amount ?? 0),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err: message }, 'TDS report failed')
    res.status(500).json({ error: message })
  }
})
