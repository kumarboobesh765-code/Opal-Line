import PDFDocument from 'pdfkit'
import { getRawClient } from './db/client'

interface CreditNoteData {
  creditNoteNumber: string
  returnDate: string
  invoiceNumber: string
  invoiceDate: string
  customer: string
  customerAddress?: string
  restocked: boolean
  items: Array<{ product: string | null; sku: string | null; qty: number; amount: number }>
  total: number
  businessName: string
  businessGstin: string
  businessAddress: string
}

/**
 * Generates a tax credit note PDF for a sales return (GSTR-1 style, mirrors the invoice design).
 */
export async function generateCreditNotePDF(returnId: string): Promise<Buffer | null> {
  const client = getRawClient()
  if (!client) return null
  try {
    const returns = await client.unsafe(`SELECT * FROM sales_returns WHERE id = $1`, [returnId])
    if (returns.length === 0) return null
    const ret = returns[0] as any

    const invoices = ret.invoice_id
      ? await client.unsafe(`SELECT * FROM sales_invoices WHERE id = $1`, [ret.invoice_id])
      : []
    const inv = invoices[0] as any
    const [settings] = (await client.unsafe(`SELECT * FROM settings LIMIT 1`)) as any[]

    const returnItems = Array.isArray(ret.return_items) ? ret.return_items : []
    const items = returnItems.map((it: any) => ({
      product: it.product ?? 'Item',
      sku: it.sku ?? '',
      qty: Number(it.qty ?? 0),
      amount: Number(it.amount ?? 0),
    }))
    if (items.length === 0) return null

    const fmtDate = (d: unknown) =>
      d ? new Date(d as any).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

    const data: CreditNoteData = {
      creditNoteNumber: ret.credit_note_number ?? ret.number ?? returnId,
      returnDate: fmtDate(ret.date),
      invoiceNumber: inv?.number ?? '—',
      invoiceDate: fmtDate(inv?.date),
      customer: ret.customer ?? inv?.customer ?? 'Customer',
      customerAddress: [inv?.customer_address, inv?.customer_city, inv?.customer_state, inv?.customer_pincode]
        .filter(Boolean).join(', ') || undefined,
      restocked: Boolean(ret.restocked),
      items,
      total: Number(ret.amount ?? items.reduce((a: number, i: { amount: number }) => a + i.amount, 0)),
      businessName: settings?.businessName ?? 'Opal Line',
      businessGstin: settings?.gstin ?? '',
      businessAddress: [settings?.address, settings?.phone].filter(Boolean).join(' · '),
    }

    const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    // Header
    doc.roundedRect(50, 40, 495, 70, 8).fill('#1a1a2e')
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(data.businessName, 66, 55)
    doc.fillColor('#a0aec0').font('Helvetica').fontSize(9).text(data.businessAddress || '', 66, 78)
    doc.roundedRect(455, 55, 80, 26, 4).fill('#c8a951')
    doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(9).text('CREDIT NOTE', 455, 63, { width: 80, align: 'center' })
    doc.y = 130

    // Meta boxes
    const metaY = doc.y
    doc.roundedRect(50, metaY, 240, 58, 6).fill('#f8f9fa')
    doc.fillColor('#6b7280').fontSize(8).font('Helvetica-Bold').text('CREDIT NOTE NO.', 62, metaY + 10)
    doc.fillColor('#1f2937').fontSize(12).text(data.creditNoteNumber, 62, metaY + 24)
    doc.fillColor('#6b7280').fontSize(8).text(`DATE: ${data.returnDate}`, 62, metaY + 44)
    doc.roundedRect(305, metaY, 240, 58, 6).fill('#f8f9fa')
    doc.fillColor('#6b7280').fontSize(8).font('Helvetica-Bold').text('AGAINST INVOICE', 317, metaY + 10)
    doc.fillColor('#1f2937').fontSize(12).text(data.invoiceNumber, 317, metaY + 24)
    doc.fillColor('#6b7280').fontSize(8).text(`INVOICE DATE: ${data.invoiceDate}`, 317, metaY + 44)
    doc.y = metaY + 74

    // Customer
    doc.fillColor('#6b7280').fontSize(8).font('Helvetica-Bold').text('CREDIT TO', 50, doc.y)
    doc.moveDown(0.4)
    doc.fillColor('#1f2937').fontSize(12).font('Helvetica-Bold').text(data.customer)
    if (data.customerAddress) {
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(data.customerAddress)
    }
    doc.moveDown(1)

    // Items table
    const tableTop = doc.y
    doc.roundedRect(50, tableTop, 495, 20, 3).fill('#1a1a2e')
    const cols = [
      { label: 'ITEM', x: 58, w: 220, align: 'left' as const },
      { label: 'SKU', x: 280, w: 100, align: 'left' as const },
      { label: 'QTY', x: 400, w: 50, align: 'right' as const },
      { label: 'AMOUNT', x: 455, w: 82, align: 'right' as const },
    ]
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
    for (const c of cols) doc.text(c.label, c.x, tableTop + 7, { width: c.w, align: c.align })

    doc.y = tableTop + 26
    let alt = false
    for (const it of items) {
      const rowY = doc.y
      if (alt) { doc.save(); doc.rect(50, rowY - 2, 495, 18).fill('#f8f9fa'); doc.restore() }
      alt = !alt
      doc.fillColor('#1f2937').font('Helvetica').fontSize(9)
      doc.text(it.product, cols[0].x, rowY, { width: cols[0].w })
      doc.fillColor('#6b7280').text(it.sku, cols[1].x, rowY, { width: cols[1].w })
      doc.text(String(it.qty), cols[2].x, rowY, { width: cols[2].w, align: 'right' })
      doc.font('Helvetica-Bold').fillColor('#1f2937').text(money(it.amount), cols[3].x, rowY, { width: cols[3].w, align: 'right' })
      doc.y = rowY + 18
    }
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
    doc.y += 10

    // Totals
    const totalY = doc.y
    doc.roundedRect(345, totalY, 200, 34, 6).fill('#eef2ff')
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9).text('TOTAL CREDIT', 357, totalY + 8)
    doc.fillColor('#312e81').font('Helvetica-Bold').fontSize(14).text(money(data.total), 357, totalY + 18)
    doc.y = totalY + 50

    // Footer notes
    doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
    doc.text(`Items ${data.restocked ? 'have been restocked into inventory.' : 'have not been restocked.'}`, 50, doc.y)
    doc.text('This credit note adjusts the customer account against the referenced invoice. GST credit is reversed proportionally as per GSTR-1 CDNR.', 50, doc.y + 12, { width: 495 })
    doc.text(`GSTIN: ${data.businessGstin || '—'}`, 50, doc.y + 26)

    // Finalize
    doc.end()
    return done
  } catch (err) {
    return null
  }
}
