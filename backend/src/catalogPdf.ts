import PDFDocument from 'pdfkit'
import { db, schema } from './db/client'
import { desc } from 'drizzle-orm'

/** Branded product catalog / price list PDF for sharing with customers. */

interface CatalogRow {
  sku: string
  name: string
  category: string | null
  grossWeight: number | null
  netWeight: number | null
  makingCharge: number | null
  sellingPrice: number | null
  stock: number | null
  huid: string | null
}

export async function generateCatalogPDF(): Promise<Buffer | null> {
  if (!db) return null
  try {
    const rows = (await db
      .select({
        sku: schema.products.sku,
        name: schema.products.name,
        category: schema.products.category,
        grossWeight: schema.products.grossWeight,
        netWeight: schema.products.netWeight,
        makingCharge: schema.products.makingCharge,
        sellingPrice: schema.products.sellingPrice,
        stock: schema.products.stock,
        huid: schema.products.huid,
      })
      .from(schema.products)
      .orderBy(desc(schema.products.sellingPrice))) as CatalogRow[]

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    // Header
    doc.rect(0, 0, doc.page.width, 90).fill('#1a1a2e')
    doc.fill('#c8a951').font('Helvetica-Bold').fontSize(22).text('OPAL LINE', 40, 28)
    doc.fill('#ffffff').font('Helvetica').fontSize(11).text('Silver Jewelry Catalog & Price List', 40, 58)
    doc.fontSize(9).text(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }), 40, 74)
    doc.moveDown(2)

    let y = 110
    const drawHeader = (yy: number): number => {
      doc.rect(40, yy, doc.page.width - 80, 20).fill('#f1f0fb')
      doc.fill('#1a1a2e').font('Helvetica-Bold').fontSize(9)
      doc.text('SKU', 46, yy + 6, { width: 90 })
      doc.text('Product', 140, yy + 6, { width: 150 })
      doc.text('Net Wt (g)', 295, yy + 6, { width: 55, align: 'right' })
      doc.text('Making/g', 355, yy + 6, { width: 50, align: 'right' })
      doc.text('Price', 410, yy + 6, { width: 65, align: 'right' })
      doc.text('Stock', 480, yy + 6, { width: 40, align: 'right' })
      doc.text('HUID', 525, yy + 6, { width: 30 })
      return yy + 26
    }
    y = drawHeader(y)
    doc.font('Helvetica').fontSize(9)

    for (const r of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage()
        y = 40
        y = drawHeader(y)
        doc.font('Helvetica').fontSize(9)
      }
      doc.fill('#1f2937')
      doc.text(r.sku ?? '', 46, y, { width: 90, ellipsis: true })
      doc.text(r.name ?? '', 140, y, { width: 150, ellipsis: true })
      doc.text(r.netWeight ? r.netWeight.toFixed(1) : '—', 295, y, { width: 55, align: 'right' })
      doc.text(r.makingCharge ? `₹${r.makingCharge.toFixed(0)}` : '—', 355, y, { width: 50, align: 'right' })
      doc.font('Helvetica-Bold').text(r.sellingPrice ? `₹${r.sellingPrice.toLocaleString('en-IN')}` : '—', 410, y, { width: 65, align: 'right' })
      doc.font('Helvetica').text(String(r.stock ?? 0), 480, y, { width: 40, align: 'right' })
      doc.text(r.huid ?? '', 525, y, { width: 30, ellipsis: true })
      y += 18
      doc.moveTo(40, y - 4).lineTo(doc.page.width - 40, y - 4).lineWidth(0.3).strokeColor('#e5e7eb').stroke()
    }

    // Footer on every page
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.fill('#9ca3af').fontSize(8).text(
        `Prices are indicative and subject to daily silver rate. GST extra as applicable. — Opal Line`,
        40, doc.page.height - 34, { width: doc.page.width - 120 },
      )
    }

    doc.end()
    return done
  } catch (err) {
    return null
  }
}
