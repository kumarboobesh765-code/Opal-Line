import QRCode from 'qrcode'
import PDFDocument from 'pdfkit'
import { getRawClient } from './db/client'
import { logger } from './logger'

interface ProductLabel {
  name: string
  sku: string
  barcode?: string
  price: number
  weight?: number
  category?: string
  hsn?: string
}

interface LabelOptions {
  width: number       // mm
  height: number      // mm
  columns: number
  rows: number
  showPrice: boolean
  showWeight: boolean
  showQR: boolean
  showBarcode: boolean
  businessName: string
}

const DEFAULT_OPTIONS: LabelOptions = {
  width: 50,
  height: 30,
  columns: 4,
  rows: 7,
  showPrice: true,
  showWeight: true,
  showQR: true,
  showBarcode: true,
  businessName: 'Opal Line',
}

// ─── Common label sizes ───────────────────────────────────────────
export const LABEL_PRESETS: Record<string, Partial<LabelOptions>> = {
  'avery-5160': { width: 63.5, height: 25.4, columns: 3, rows: 10 },
  'avery-8160': { width: 38.1, height: 21.2, columns: 4, rows: 12 },
  'dymo-30256': { width: 51, height: 25, columns: 3, rows: 8 },
  'zlabel-50x30': { width: 50, height: 30, columns: 4, rows: 7 },
  'zlabel-40x25': { width: 40, height: 25, columns: 4, rows: 8 },
}

export async function fetchProductLabels(productIds: string[]): Promise<ProductLabel[]> {
  const client = getRawClient()
  if (!client) return []
  try {
    const products = await client.unsafe(
      `SELECT name, sku, barcode, selling_price, net_weight, category, hsn FROM products WHERE id = ANY($1)`,
      [productIds]
    )
    return products.map((p: any) => ({
      name: p.name || 'Product',
      sku: p.sku || '',
      barcode: p.barcode || undefined,
      price: Number(p.selling_price || 0),
      weight: Number(p.net_weight || 0),
      category: p.category || undefined,
      hsn: p.hsn || '7113',
    }))
  } catch (err) {
    logger.error({ err }, 'Failed to fetch product labels')
    return []
  }
}

export async function fetchAllProductLabels(): Promise<ProductLabel[]> {
  const client = getRawClient()
  if (!client) return []
  try {
    const products = await client.unsafe(
      `SELECT name, sku, barcode, selling_price, net_weight, category, hsn FROM products ORDER BY name`
    )
    return products.map((p: any) => ({
      name: p.name || 'Product',
      sku: p.sku || '',
      barcode: p.barcode || undefined,
      price: Number(p.selling_price || 0),
      weight: Number(p.net_weight || 0),
      category: p.category || undefined,
      hsn: p.hsn || '7113',
    }))
  } catch (err) {
    logger.error({ err }, 'Failed to fetch all product labels')
    return []
  }
}

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
}

async function generateQRBuffer(data: string, size: number): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(data, {
      width: size,
      margin: 0,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    })
  } catch {
    return null
  }
}

export async function generateLabelsPDF(
  products: ProductLabel[],
  options: Partial<LabelOptions> = {}
): Promise<Buffer | null> {
  if (products.length === 0) return null

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const labelW = mmToPt(opts.width)
  const labelH = mmToPt(opts.height)
  const margin = 6
  const qrSize = Math.min(labelH - 14, 50)

  // Pre-generate all QR codes
  const qrBuffers: (Buffer | null)[] = []
  if (opts.showQR) {
    for (const product of products) {
      const qrData = JSON.stringify({ sku: product.sku, name: product.name, price: product.price })
      qrBuffers.push(await generateQRBuffer(qrData, qrSize))
    }
  }

  return new Promise((resolve) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))

    const startX = 20
    const startY = 20
    let col = 0
    let row = 0

    for (let i = 0; i < products.length; i++) {
      const product = products[i]

      // Check if we need a new page
      if (row >= opts.rows) {
        doc.addPage()
        col = 0
        row = 0
      }

      const actualY = startY + row * labelH
      const actualX = startX + col * labelW

      // Draw label border
      doc.save()
      doc.roundedRect(actualX + 1, actualY + 1, labelW - 2, labelH - 2, 2).lineWidth(0.3).stroke('#e5e7eb')
      doc.restore()

      // QR Code
      if (opts.showQR && qrBuffers[i]) {
        doc.image(qrBuffers[i]!, actualX + margin, actualY + margin, {
          width: qrSize,
          height: qrSize,
        })
      }

      // Text content
      const textX = opts.showQR ? actualX + margin + qrSize + 4 : actualX + margin
      const textW = labelW - (opts.showQR ? margin + qrSize + 8 : margin * 2)

      // Product name
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1f2937')
      doc.text(product.name, textX, actualY + margin, { width: textW, height: 16, ellipsis: true })

      // SKU
      doc.fontSize(5.5).font('Helvetica').fillColor('#6b728b')
      doc.text(`SKU: ${product.sku}`, textX, actualY + margin + 16, { width: textW })

      // Category
      if (product.category) {
        doc.fontSize(5).fillColor('#9ca3af')
        doc.text(product.category, textX, actualY + margin + 24, { width: textW })
      }

      // Price
      if (opts.showPrice) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#059669')
        doc.text(`\u20B9${product.price.toLocaleString('en-IN')}`, textX, actualY + labelH - margin - 10, { width: textW })
      }

      // Weight
      if (opts.showWeight && product.weight) {
        doc.fontSize(5).font('Helvetica').fillColor('#6b728b')
        doc.text(`${product.weight}g`, textX, actualY + labelH - margin - 2, { width: textW, align: 'right' })
      }

      // Advance position
      col++
      if (col >= opts.columns) {
        col = 0
        row++
      }
    }

    doc.end()
  }) as any
}