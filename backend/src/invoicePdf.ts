import PDFDocument from 'pdfkit'
import { getRawClient } from './db/client'
import { logger } from './logger'

interface InvoiceItem {
  name: string
  hsn: string
  quantity: number
  grossWeight: number
  netWeight: number
  silverRate: number
  makingCharge: number
  amount: number
}

interface InvoiceData {
  id: string
  invoiceNumber: string
  date: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  customerAddress?: string
  customerGstin?: string
  customerState?: string
  customerStateCode?: string
  items: InvoiceItem[]
  subtotal: number
  discount: number
  cgst: number
  sgst: number
  totalGst: number
  grandTotal: number
  amountInWords: string
  businessName: string
  businessAddress: string
  businessGstin: string
  businessState: string
  businessStateCode: string
  businessPhone: string
  businessEmail: string
  paymentMethod: string
  paymentStatus: string
  shopifyOrder?: string
}

// ─── Color palette ────────────────────────────────────────────────
const COLORS = {
  primary: '#1a1a2e',
  accent: '#c8a951',
  border: '#d1d5db',
  lightBg: '#f8f9fa',
  headerBg: '#1a1a2e',
  headerText: '#ffffff',
  text: '#1f2937',
  muted: '#6b7280',
  success: '#059669',
  divider: '#e5e7eb',
}

function numberToIndianWords(num: number): string {
  if (num === 0) return 'Zero'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function convert(n: number): string {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '')
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '')
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '')
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '')
  }

  const rupees = Math.floor(num)
  const paise = Math.round((num - rupees) * 100)
  let result = convert(rupees) + ' Rupees'
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise'
  result += ' Only'
  return result
}

function formatCurrency(amount: number): string {
  return '\u20B9' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function drawRoundedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, r: number, fill: string) {
  doc.save()
  doc.roundedRect(x, y, w, h, r).fill(fill)
  doc.restore()
}

export async function generateInvoicePDF(invoiceId: string): Promise<Buffer | null> {
  const client = getRawClient()
  if (!client) return null

  try {
    const invoices = await client.unsafe(`SELECT * FROM sales_invoices WHERE id = $1`, [invoiceId])
    if (invoices.length === 0) return null
    const inv = invoices[0] as any

    const items = await client.unsafe(`SELECT * FROM sales_invoice_items WHERE invoice_id = $1`, [invoiceId])
    const [settings] = await client.unsafe(`SELECT * FROM settings LIMIT 1`) as any[]

    const itemData: InvoiceItem[] = items.map((item: any) => ({
      name: item.name || item.product_name || 'Item',
      hsn: item.hsn || '7113',
      quantity: Number(item.quantity || 1),
      grossWeight: Number(item.gross_weight || 0),
      netWeight: Number(item.net_weight || item.weight || 0),
      silverRate: Number(item.silver_rate || item.rate || 0),
      makingCharge: Number(item.making_charge || 0),
      amount: Number(item.amount || 0),
    }))

    const subtotal = Number(inv.subtotal || 0)
    const discount = Number(inv.discount || 0)
    const gstRate = Number(settings?.gst_rate || 3)
    const totalGst = Number(inv.total_gst || inv.gst || (subtotal - discount) * gstRate / 100)
    const cgst = Math.round((totalGst / 2) * 100) / 100
    const sgst = Math.round((totalGst / 2) * 100) / 100
    const grandTotal = Number(inv.grand_total || subtotal - discount + totalGst)

    const data: InvoiceData = {
      id: inv.id,
      invoiceNumber: inv.invoice_number || inv.id,
      date: inv.date ? new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      customerName: inv.customer_name || inv.customer || 'Walk-in Customer',
      customerPhone: inv.customer_phone || inv.phone || undefined,
      customerEmail: inv.customer_email || inv.email || undefined,
      customerAddress: inv.customer_address || inv.address || undefined,
      customerGstin: inv.customer_gstin || inv.gstin || undefined,
      customerState: inv.customer_state || 'Maharashtra',
      customerStateCode: inv.customer_state_code || '27',
      items: itemData,
      subtotal, discount, cgst, sgst, totalGst, grandTotal,
      amountInWords: numberToIndianWords(grandTotal),
      businessName: settings?.business_name || 'Opal Line Jewels LLP',
      businessAddress: settings?.address || 'Shop 4, Nariman Point, Mumbai - 400021',
      businessGstin: settings?.gstin || '27AAACO1234F1Z5',
      businessState: 'Maharashtra',
      businessStateCode: '27',
      businessPhone: settings?.phone || '+91 98200 00000',
      businessEmail: settings?.email || 'hello@opalline.in',
      paymentMethod: inv.payment_method || inv.payment || 'Online',
      paymentStatus: inv.payment_status || 'paid',
      shopifyOrder: inv.shopify_order || inv.shopifyOrder || undefined,
    }

    return createPDFBuffer(data)
  } catch (err) {
    logger.error({ err, invoiceId }, 'Invoice PDF generation failed')
    return null
  }
}

function createPDFBuffer(data: InvoiceData): Buffer {
  return new Promise((resolve) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 35, bottom: 35, left: 40, right: 40 },
      info: {
        Title: `Invoice ${data.invoiceNumber}`,
        Author: data.businessName,
        Subject: 'Tax Invoice',
      },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))

    const pageW = 595.28 // A4 width in points
    const left = 40
    const right = pageW - 40
    const contentW = right - left

    // ══════════════════════════════════════════════════════════════
    // HEADER — Dark banner with business name
    // ══════════════════════════════════════════════════════════════
    drawRoundedRect(doc, left, 30, contentW, 52, 4, COLORS.headerBg)
    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.headerText)
      .text(data.businessName, left + 16, 38, { width: contentW - 32 })
    doc.fontSize(8).font('Helvetica').fillColor('#a0aec0')
      .text(`${data.businessAddress}`, left + 16, 58, { width: contentW - 32 })
    doc.fontSize(7.5).fillColor('#a0aec0')
      .text(`GSTIN: ${data.businessGstin}  |  State: ${data.businessState} (${data.businessStateCode})  |  Ph: ${data.businessPhone}  |  ${data.businessEmail}`, left + 16, 68, { width: contentW - 32 })

    doc.y = 90

    // ══════════════════════════════════════════════════════════════
    // TAX INVOICE badge + Invoice details
    // ══════════════════════════════════════════════════════════════
    // Badge
    drawRoundedRect(doc, right - 110, 88, 110, 22, 3, COLORS.accent)
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.primary)
      .text('TAX INVOICE', right - 110, 92, { width: 110, align: 'center' })

    // Invoice info
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text)
    const infoY = 118
    doc.font('Helvetica-Bold').text('Invoice No:', left, infoY)
    doc.font('Helvetica').text(` ${data.invoiceNumber}`, left + 62, infoY)
    doc.font('Helvetica-Bold').text('Date:', left + 220, infoY)
    doc.font('Helvetica').text(` ${data.date}`, left + 245, infoY)

    doc.font('Helvetica-Bold').text('Payment:', left, infoY + 14)
    doc.font('Helvetica').text(` ${data.paymentMethod} (${data.paymentStatus})`, left + 52, infoY + 14)
    if (data.shopifyOrder) {
      doc.font('Helvetica-Bold').text('Order:', left + 220, infoY + 14)
      doc.font('Helvetica').text(` ${data.shopifyOrder}`, left + 245, infoY + 14)
    }

    doc.y = infoY + 34

    // ══════════════════════════════════════════════════════════════
    // BILL TO / SHIP TO
    // ══════════════════════════════════════════════════════════════
    const billY = doc.y
    drawRoundedRect(doc, left, billY, contentW, 52, 3, COLORS.lightBg)

    doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.muted)
      .text('BILL TO', left + 10, billY + 6)
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(data.customerName, left + 10, billY + 18, { width: 200 })
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
    let custDetails = ''
    if (data.customerPhone) custDetails += data.customerPhone
    if (data.customerEmail) custDetails += (custDetails ? '  |  ' : '') + data.customerEmail
    if (custDetails) doc.text(custDetails, left + 10, billY + 32, { width: 200 })
    if (data.customerGstin) doc.text(`GSTIN: ${data.customerGstin}`, left + 10, billY + 44, { width: 200 })

    doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.muted)
      .text('STATE', left + 300, billY + 6)
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
      .text(`${data.customerState} (${data.customerStateCode})`, left + 300, billY + 18)

    doc.y = billY + 60

    // ══════════════════════════════════════════════════════════════
    // ITEMS TABLE
    // ══════════════════════════════════════════════════════════════
    doc.y += 4
    const tableTop = doc.y

    // Table header
    drawRoundedRect(doc, left, tableTop, contentW, 18, 2, COLORS.headerBg)
    const cols = [
      { label: 'Description', x: left + 6, w: 140, align: 'left' as const },
      { label: 'HSN', x: left + 150, w: 45, align: 'center' as const },
      { label: 'Qty', x: left + 198, w: 35, align: 'center' as const },
      { label: 'Net Wt (g)', x: left + 236, w: 55, align: 'right' as const },
      { label: 'Rate (\u20B9/g)', x: left + 294, w: 55, align: 'right' as const },
      { label: 'Making (\u20B9)', x: left + 352, w: 60, align: 'right' as const },
      { label: 'Amount (\u20B9)', x: left + 416, w: 80, align: 'right' as const },
    ]

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(COLORS.headerText)
    for (const col of cols) {
      doc.text(col.label, col.x, tableTop + 5, { width: col.w, align: col.align })
    }

    doc.y = tableTop + 22

    // Table rows with alternating backgrounds
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.text)
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      const rowY = doc.y

      // Alternating row background
      if (i % 2 === 0) {
        doc.save()
        doc.rect(left, rowY - 2, contentW, 16).fill(COLORS.lightBg)
        doc.restore()
      }

      doc.fillColor(COLORS.text)
      doc.text(item.name, cols[0].x, rowY, { width: cols[0].w, align: cols[0].align })
      doc.text(item.hsn, cols[1].x, rowY, { width: cols[1].w, align: cols[1].align })
      doc.text(String(item.quantity), cols[2].x, rowY, { width: cols[2].w, align: cols[2].align })
      doc.text(item.netWeight.toFixed(2), cols[3].x, rowY, { width: cols[3].w, align: cols[3].align })
      doc.text(formatCurrency(item.silverRate), cols[4].x, rowY, { width: cols[4].w, align: cols[4].align })
      doc.text(formatCurrency(item.makingCharge), cols[5].x, rowY, { width: cols[5].w, align: cols[5].align })
      doc.font('Helvetica-Bold').text(formatCurrency(item.amount), cols[6].x, rowY, { width: cols[6].w, align: cols[6].align })
      doc.font('Helvetica')

      doc.y = rowY + 16
    }

    // Table bottom border
    doc.save().moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.5).stroke(COLORS.border).restore()
    doc.y += 8

    // ══════════════════════════════════════════════════════════════
    // TOTALS — Right-aligned box
    // ══════════════════════════════════════════════════════════════
    const totalsX = left + 300
    const totalsW = contentW - 300
    const totalsY = doc.y

    drawRoundedRect(doc, totalsX, totalsY, totalsW, data.discount > 0 ? 95 : 80, 3, COLORS.lightBg)

    const labelX = totalsX + 10
    const valX = totalsX + totalsW - 10
    let ty = totalsY + 8

    const gstRateHalf = data.subtotal > 0 ? ((data.totalGst / (data.subtotal - data.discount)) * 100 / 2).toFixed(1) : '1.5'

    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
    doc.text('Taxable Value', labelX, ty, { width: 140 }); doc.text(formatCurrency(data.subtotal - data.discount), valX - 80, ty, { width: 80, align: 'right' }); ty += 14
    doc.text(`CGST @ ${gstRateHalf}%`, labelX, ty, { width: 140 }); doc.text(formatCurrency(data.cgst), valX - 80, ty, { width: 80, align: 'right' }); ty += 14
    doc.text(`SGST @ ${gstRateHalf}%`, labelX, ty, { width: 140 }); doc.text(formatCurrency(data.sgst), valX - 80, ty, { width: 80, align: 'right' }); ty += 14

    if (data.discount > 0) {
      doc.fillColor('#dc2626').text('Discount', labelX, ty, { width: 140 })
      doc.text(`- ${formatCurrency(data.discount)}`, valX - 80, ty, { width: 80, align: 'right' }); ty += 14
    }

    // Grand total — highlighted
    ty += 2
    doc.save().moveTo(labelX, ty - 2).lineTo(valX, ty - 2).lineWidth(1).stroke(COLORS.accent).restore()
    ty += 4
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text('GRAND TOTAL', labelX, ty, { width: 140 })
    doc.fillColor(COLORS.accent).text(formatCurrency(data.grandTotal), valX - 80, ty, { width: 80, align: 'right' })

    doc.y = Math.max(doc.y, ty + 20)

    // ══════════════════════════════════════════════════════════════
    // AMOUNT IN WORDS
    // ══════════════════════════════════════════════════════════════
    doc.y += 4
    drawRoundedRect(doc, left, doc.y, contentW, 20, 2, '#fef3c7')
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#92400e')
      .text('Amount in Words:', left + 8, doc.y + 5)
    doc.fontSize(7.5).font('Helvetica').fillColor('#78350f')
      .text(data.amountInWords, left + 95, doc.y + 5 - 14, { width: contentW - 110 })

    doc.y += 28

    // ══════════════════════════════════════════════════════════════
    // DECLARATION + SIGNATURES
    // ══════════════════════════════════════════════════════════════
    doc.save().moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.5).stroke(COLORS.divider).restore()
    doc.y += 8

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
    doc.text('Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold will only be exchanged as per store policy. This is a computer-generated invoice.', left, doc.y, { width: contentW * 0.65 })

    // Signature area
    const sigY = doc.y + 30
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
    doc.text('Customer Signature', left, sigY, { width: 120, align: 'center' })
    doc.save().moveTo(left + 20, sigY + 14).lineTo(left + 100, sigY + 14).lineWidth(0.5).stroke(COLORS.border).restore()

    doc.text(`For ${data.businessName}`, left + contentW - 140, sigY, { width: 140, align: 'center' })
    doc.save().moveTo(left + contentW - 120, sigY + 14).lineTo(left + contentW - 20, sigY + 14).lineWidth(0.5).stroke(COLORS.border).restore()
    doc.fontSize(7).fillColor(COLORS.muted).text('Authorised Signatory', left + contentW - 140, sigY + 18, { width: 140, align: 'center' })

    doc.y = sigY + 35

    // ══════════════════════════════════════════════════════════════
    // FOOTER
    // ══════════════════════════════════════════════════════════════
    doc.save().moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.3).stroke(COLORS.divider).restore()
    doc.y += 6
    doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by ${data.businessName} ERP  |  opalline.in  |  This is a computer-generated invoice`, left, doc.y, { width: contentW, align: 'center' })

    doc.end()
  }) as any
}

export async function emailInvoicePDF(invoiceId: string, recipientEmail: string): Promise<boolean> {
  const { sendEmail } = await import('./notifications')
  const pdfBuffer = await generateInvoicePDF(invoiceId)
  if (!pdfBuffer) return false

  const client = getRawClient()
  if (!client) return false

  const [inv] = await client.unsafe(`SELECT invoice_number FROM sales_invoices WHERE id = $1`, [invoiceId]) as any[]
  const invNumber = inv?.invoice_number || invoiceId

  return sendEmail({
    to: recipientEmail,
    subject: `Invoice ${invNumber} — Opal Line`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">\uD83D\uDCC4 Invoice ${invNumber}</h2>
        <p>Please find your invoice attached. You can also download it from the ERP.</p>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Invoice Notification</p>
      </div>
    `,
  })
}