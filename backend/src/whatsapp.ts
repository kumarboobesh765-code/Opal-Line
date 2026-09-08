import { logger } from './logger'

/**
 * WhatsApp Business API integration.
 * Supports the Meta WhatsApp Business Cloud API.
 *
 * To enable:
 * 1. Create a Meta Business account at business.facebook.com
 * 2. Set up WhatsApp Business API at developers.facebook.com
 * 3. Add these env vars:
 *    - WHATSAPP_API_KEY: Your API access token
 *    - WHATSAPP_PHONE_NUMBER_ID: Your WhatsApp Business phone number ID
 *    - WHATSAPP_BUSINESS_ACCOUNT_ID: Your WhatsApp Business Account ID
 */

interface WhatsAppConfig {
  apiKey: string
  phoneNumberId: string
  businessAccountId: string
}

function getConfig(): WhatsAppConfig | null {
  const apiKey = process.env.WHATSAPP_API_KEY?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()
  if (!apiKey || !phoneNumberId) return null
  return { apiKey, phoneNumberId, businessAccountId: businessAccountId || '' }
}

async function sendTemplateMessage(
  config: WhatsAppConfig,
  to: string,
  templateName: string,
  languageCode: string,
  components: any[] = []
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components,
          },
        }),
      }
    )

    const result = await response.json()
    if (!response.ok) {
      logger.error({ status: response.status, error: result }, 'WhatsApp API error')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'WhatsApp send failed')
    return false
  }
}

async function sendTextMessage(
  config: WhatsAppConfig,
  to: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    )

    const result = await response.json()
    if (!response.ok) {
      logger.error({ status: response.status, error: result }, 'WhatsApp text message error')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'WhatsApp text send failed')
    return false
  }
}

// ─── Pre-built notification messages ──────────────────────────────

export async function sendInvoiceWhatsApp(
  phoneNumber: string,
  opts: {
    invoiceNumber: string
    customerName: string
    grandTotal: number
    itemCount: number
    businessName?: string
  }
): Promise<boolean> {
  const config = getConfig()
  if (!config) {
    logger.debug('WhatsApp skipped — WHATSAPP_API_KEY not configured')
    return false
  }

  // Clean phone number (remove spaces, dashes, leading +)
  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '')
  const phone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`

  const message = [
    `🧾 *Invoice ${opts.invoiceNumber}*`,
    ``,
    `Hi ${opts.customerName},`,
    `Your invoice from ${opts.businessName || 'Opal Line'} is ready.`,
    ``,
    `📦 Items: ${opts.itemCount}`,
    `💰 Total: ₹${opts.grandTotal.toLocaleString('en-IN')}`,
    ``,
    `Thank you for your purchase! 🙏`,
    ``,
    `_This is a computer-generated message._`,
  ].join('\n')

  return sendTextMessage(config, phone, message)
}

export async function sendOrderConfirmationWhatsApp(
  phoneNumber: string,
  opts: {
    orderNumber: string
    customerName: string
    totalAmount: number
    itemCount: number
    businessName?: string
  }
): Promise<boolean> {
  const config = getConfig()
  if (!config) return false

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '')
  const phone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`

  const message = [
    `✅ *Order Confirmed!*`,
    ``,
    `Hi ${opts.customerName},`,
    `Your order ${opts.orderNumber} with ${opts.businessName || 'Opal Line'} has been confirmed.`,
    ``,
    `📦 Items: ${opts.itemCount}`,
    `💰 Total: ₹${opts.totalAmount.toLocaleString('en-IN')}`,
    ``,
    `We'll notify you when it ships. 🚚`,
  ].join('\n')

  return sendTextMessage(config, phone, message)
}

export async function sendShippingUpdateWhatsApp(
  phoneNumber: string,
  opts: {
    orderNumber: string
    customerName: string
    trackingId?: string
    carrier?: string
    businessName?: string
  }
): Promise<boolean> {
  const config = getConfig()
  if (!config) return false

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '')
  const phone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`

  const message = [
    `🚚 *Order Shipped!*`,
    ``,
    `Hi ${opts.customerName},`,
    `Your order ${opts.orderNumber} has been shipped.`,
    opts.trackingId ? `📋 Tracking: ${opts.trackingId}` : '',
    opts.carrier ? `📦 Carrier: ${opts.carrier}` : '',
    ``,
    `Thank you for shopping with ${opts.businessName || 'Opal Line'}! 🙏`,
  ].filter(Boolean).join('\n')

  return sendTextMessage(config, phone, message)
}

export async function sendLowStockWhatsApp(
  phoneNumber: string,
  products: Array<{ name: string; stock: number }>
): Promise<boolean> {
  const config = getConfig()
  if (!config) return false

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '')
  const phone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`

  const productList = products.map((p) => `• ${p.name}: ${p.stock} left`).join('\n')
  const message = [
    `⚠️ *Low Stock Alert*`,
    ``,
    `The following products need restocking:`,
    ``,
    productList,
    ``,
    `_Opal Line ERP — Inventory Alert_`,
  ].join('\n')

  return sendTextMessage(config, phone, message)
}

export async function sendPaymentReminderWhatsApp(
  phoneNumber: string,
  opts: {
    invoiceNumber: string
    customerName: string
    amount: number
    dueDate?: string
    businessName?: string
  }
): Promise<boolean> {
  const config = getConfig()
  if (!config) return false

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '')
  const phone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`

  const message = [
    `💰 *Payment Reminder*`,
    ``,
    `Hi ${opts.customerName},`,
    `This is a friendly reminder for invoice ${opts.invoiceNumber}.`,
    ``,
    `Amount Due: ₹${opts.amount.toLocaleString('en-IN')}`,
    opts.dueDate ? `Due Date: ${opts.dueDate}` : '',
    ``,
    `Please make the payment at your earliest convenience.`,
    `Thank you! 🙏`,
  ].filter(Boolean).join('\n')

  return sendTextMessage(config, phone, message)
}

export function isWhatsAppConfigured(): boolean {
  return getConfig() !== null
}