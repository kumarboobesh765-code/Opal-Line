import QRCode from 'qrcode'
import { db, schema } from './db/client'

/**
 * Build the UPI payment QR string for an invoice. Mirrors the PDF path
 * (invoicePdf.ts): payee VPA from Settings, amount = grand total.
 * Returns null when no UPI ID is configured — callers skip the QR slot.
 */
export async function buildUpiQrDataUrl(
  grandTotal: number,
  businessName?: string | null,
): Promise<string | null> {
  if (!db) return null
  try {
    const [settings] = await db.select().from(schema.settings).limit(1)
    const upiId = settings?.upiId?.trim()
    if (!upiId) return null
    const payee = (businessName ?? settings.businessName ?? 'Opal Line').slice(0, 40)
    const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${Number(grandTotal).toFixed(2)}&cu=INR`
    return await QRCode.toDataURL(upiString, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
  } catch {
    return null
  }
}
