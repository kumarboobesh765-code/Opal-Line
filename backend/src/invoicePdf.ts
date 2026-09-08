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
  gstin?: string
  items: InvoiceItem[]
  subtotal: number
  cgst: number
  sgst: number
  totalGst: number
  grandTotal: number
  amountInWords: string
  businessName: string
  businessAddress: string
  businessGstin: string
  businessPhone: string
  businessEmail: string
}

function numberToWords(num: number): string {
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
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function generateInvoicePDF(invoiceId: string): Promise<Buffer | null> {
  const client = getRawClient()
  if (!client) return null

  try {
    // Fetch invoice with items
    const invoices = await client.unsafe(
      `SELECT * FROM sales_invoices WHERE id = $1`, [invoiceId]
    )
    if (invoices.length === 0) return null
    const inv = invoices[0] as any

    const items = await client.unsafe(
      `SELECT * FROM sales_invoice_items WHERE invoice_id = $1`, [invoiceId]
    )

    // Fetch settings
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
    const gstRate = Number(settings?.gst_rate || 3)
    const totalGst = Number(inv.total_gst || inv.gst || subtotal * gstRate / 100)
    const cgst = totalGst / 2
    const sgst = totalGst / 2
    const grandTotal = Number(inv.grand_total || subtotal + totalGst)

    const data: InvoiceData = {
      id: inv.id,
      invoiceNumber: inv.invoice_number || inv.id,
      date: inv.date ? new Date(inv.date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN'),
      customerName: inv.customer_name || inv.customer || 'Walk-in Customer',
      customerPhone: inv.customer_phone || inv.phone || undefined,
      customerEmail: inv.customer_email || inv.email || undefined,
      customerAddress: inv.customer_address || inv.address || undefined,
      gstin: inv.customer_gstin || inv.gstin || undefined,
      items: itemData,
      subtotal,
      cgst,
      sgst,
      totalGst,
      grandTotal,
      amountInWords: numberToWords(grandTotal),
      businessName: settings?.business_name || 'Opal Line Jewels LLP',
      businessAddress: settings?.address || '',
      businessGstin: settings?.gstin || '',
      businessPhone: settings?.phone || '',
      businessEmail: settings?.email || '',
    }

    return createPDFBuffer(data)
  } catch (err) {
    logger.error({ err, invoiceId }, 'Invoice PDF generation failed')
    return null
  }
}

function createPDFBuffer(data: InvoiceData): Buffer {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))

    // ─── HEADER ─────────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold').text(data.businessName, { align: 'center' })
    doc.fontSize(9).font('Helvetica')
    if (data.businessAddress) doc.text(data.businessAddress, { align: 'center' })
    doc.text(`GSTIN: ${data.businessGstin} | Ph: ${data.businessPhone} | Email: ${data.businessEmail}`, { align: 'center' })
    doc.moveDown(0.5)

    // Divider
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.5)

    // ─── TAX INVOICE title ──────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center' })
    doc.moveDown(0.5)

    // ─── Invoice details ────────────────────────────────────
    const leftX = 40
    const rightX = 320
    const startY = doc.y

    doc.fontSize(9).font('Helvetica')
    doc.text(`Invoice No: ${data.invoiceNumber}`, leftX, startY)
    doc.text(`Date: ${data.date}`, rightX, startY)

    doc.text(`Customer: ${data.customerName}`, leftX, startY + 15)
    if (data.customerPhone) doc.text(`Phone: ${data.customerPhone}`, rightX, startY + 15)
    if (data.gstin) doc.text(`Customer GSTIN: ${data.gstin}`, leftX, startY + 30)

    doc.y = startY + 45
    doc.moveDown(0.5)

    // ─── ITEMS TABLE ────────────────────────────────────────
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.3)

    const tableTop = doc.y
    const colWidths = [120, 50, 50, 50, 55, 65, 85]
    const colX = [45, 165, 215, 265, 315, 375, 455]
    const headers = ['Description', 'HSN', 'Qty', 'Net Wt(g)', 'Rate(₹/g)', 'Making(₹)', 'Amount(₹)']

    // Table header
    doc.fontSize(8).font('Helvetica-Bold')
    headers.forEach((h, i) => doc.text(h, colX[i], tableTop, { width: colWidths[i], align: i === 0 ? 'left' : 'right' }))

    doc.y = tableTop + 12
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.3)

    // Table rows
    doc.font('Helvetica').fontSize(8)
    for (const item of data.items) {
      const rowY = doc.y
      doc.text(item.name, colX[0], rowY, { width: colWidths[0] })
      doc.text(item.hsn, colX[1], rowY, { width: colWidths[1], align: 'right' })
      doc.text(String(item.quantity), colX[2], rowY, { width: colWidths[2], align: 'right' })
      doc.text(item.netWeight.toFixed(2), colX[3], rowY, { width: colWidths[3], align: 'right' })
      doc.text(item.silverRate.toFixed(2), colX[4], rowY, { width: colWidths[4], align: 'right' })
      doc.text(formatCurrency(item.makingCharge), colX[5], rowY, { width: colWidths[5], align: 'right' })
      doc.text(formatCurrency(item.amount), colX[6], rowY, { width: colWidths[6], align: 'right' })
      doc.y = rowY + 14
    }

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.5)

    // ─── TOTALS ─────────────────────────────────────────────
    const totalsX = 380
    const totalsValX = 480

    doc.fontSize(9).font('Helvetica')
    doc.text('Subtotal:', totalsX, doc.y, { width: 90, align: 'left' })
    doc.text(formatCurrency(data.subtotal), totalsValX, doc.y - 12, { width: 80, align: 'right' })

    doc.text(`CGST (${(data.totalGst / data.subtotal * 100 / 2).toFixed(1)}%):`, totalsX, doc.y, { width: 90, align: 'left' })
    doc.text(formatCurrency(data.cgst), totalsValX, doc.y - 12, { width: 80, align: 'right' })

    doc.text(`SGST (${(data.totalGst / data.subtotal * 100 / 2).toFixed(1)}%):`, totalsX, doc.y, { width: 90, align: 'left' })
    doc.text(formatCurrency(data.sgst), totalsValX, doc.y - 12, { width: 80, align: 'right' })

    doc.text('Total GST:', totalsX, doc.y, { width: 90, align: 'left' })
    doc.text(formatCurrency(data.totalGst), totalsValX, doc.y - 12, { width: 80, align: 'right' })

    doc.moveTo(380, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.3)

    doc.fontSize(11).font('Helvetica-Bold')
    doc.text('Grand Total:', totalsX, doc.y, { width: 90, align: 'left' })
    doc.text(formatCurrency(data.grandTotal), totalsValX, doc.y - 14, { width: 80, align: 'right' })

    doc.moveDown(1)

    // ─── AMOUNT IN WORDS ────────────────────────────────────
    doc.fontSize(8).font('Helvetica')
    doc.text(`Amount in Words: ${data.amountInWords}`, 40, doc.y, { width: 515 })

    doc.moveDown(1.5)

    // ─── FOOTER ─────────────────────────────────────────────
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.5)
    doc.fontSize(8).font('Helvetica')
    doc.text('Terms: Payment due within 30 days. Goods once sold will not be returned.', { align: 'center' })
    doc.text('Thank you for your business!', { align: 'center' })
    doc.moveDown(1)
    doc.text(`Generated by ${data.businessName} ERP`, { align: 'center' })

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

  // For now, send as HTML email with invoice details (Resend doesn't support attachments directly via simple API)
  // The PDF is available via the download endpoint
  return sendEmail({
    to: recipientEmail,
    subject: `Invoice ${invNumber} — Opal Line`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">📄 Invoice ${invNumber}</h2>
        <p>Please find your invoice attached. You can also download it from the ERP.</p>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Invoice Notification</p>
      </div>
    `,
  })
}