import { logger } from './logger'

interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
}

function getConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!token || !phoneId) return null
  return { accessToken: token, phoneNumberId: phoneId }
}

/**
 * Send a WhatsApp message via Meta Cloud API.
 * Returns the message ID on success, null if not configured or failed.
 */
export async function sendWhatsAppMessage(to: string, message: string): Promise<{ messageId: string } | null> {
  const config = getConfig()
  if (!config) {
    logger.debug('WhatsApp Business API not configured')
    return null
  }
  const digits = to.replace(/\D/g, '')
  const withCc = digits.length === 10 ? '91' + digits : digits
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: withCc,
        type: 'text',
        text: { body: message },
      }),
    })
    const data = await res.json() as Record<string, unknown>
    if (res.ok && data.messages) {
      const msgs = data.messages as Array<{ id: string }>
      return { messageId: msgs[0]?.id ?? '' }
    }
    logger.warn({ status: res.status, error: data }, 'WhatsApp send failed')
    return null
  } catch (err) {
    logger.error({ err }, 'WhatsApp API request failed')
    return null
  }
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim())
}

export function buildWaMeLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCc = digits.length === 10 ? '91' + digits : digits
  return `https://wa.me/${withCc}?text=${encodeURIComponent(text)}`
}

// ── High-level WhatsApp notification helpers (called by backup.ts) ─────────

export async function sendInvoiceWhatsApp(phone: string, opts: { invoiceNumber: string; customerName: string; grandTotal: number; itemCount: number }): Promise<boolean> {
  const text = `Invoice ${opts.invoiceNumber} — ₹${opts.grandTotal.toLocaleString('en-IN')}\nCustomer: ${opts.customerName}\n${opts.itemCount} item${opts.itemCount === 1 ? '' : 's'}\n\nThank you for shopping with Opal Line ✨`
  const result = await sendWhatsAppMessage(phone, text)
  return result !== null
}

export async function sendOrderConfirmationWhatsApp(phone: string, opts: { orderNumber: string; customerName: string; totalAmount: number; itemCount: number }): Promise<boolean> {
  const text = `Order ${opts.orderNumber} confirmed!\n${opts.itemCount} item${opts.itemCount === 1 ? '' : 's'}\nTotal: ₹${opts.totalAmount.toLocaleString('en-IN')}\n\nWe'll notify you when it ships. — Opal Line`
  const result = await sendWhatsAppMessage(phone, text)
  return result !== null
}

export async function sendShippingUpdateWhatsApp(phone: string, opts: { orderNumber: string; customerName: string; trackingId: string; carrier?: string }): Promise<boolean> {
  const text = `Your order ${opts.orderNumber} has shipped!\nTracking: ${opts.trackingId}${opts.carrier ? ` (${opts.carrier})` : ''}\n\nTrack at https://track.zeptonow.com — Opal Line`
  const result = await sendWhatsAppMessage(phone, text)
  return result !== null
}

export async function sendLowStockWhatsApp(phone: string, products: Array<{ name: string; stock: number }>): Promise<boolean> {
  if (products.length === 0) return false
  const list = products.slice(0, 10).map((p) => `• ${p.name}: ${p.stock} left`).join('\n')
  const more = products.length > 10 ? `\n...and ${products.length - 10} more` : ''
  const text = `⚠️ Low stock alert:\n${list}${more}\n\nPlease reorder soon. — Opal Line`
  const result = await sendWhatsAppMessage(phone, text)
  return result !== null
}

export async function sendPaymentReminderWhatsApp(phone: string, customer: string, amount: number, invoiceNumber: string): Promise<boolean> {
  const text = `Dear ${customer},\n\nGentle reminder: your outstanding balance with Opal Line is ₹${amount.toLocaleString('en-IN')} (Invoice: ${invoiceNumber}).\n\nKindly arrange the payment. — Opal Line`
  const result = await sendWhatsAppMessage(phone, text)
  return result !== null
}
