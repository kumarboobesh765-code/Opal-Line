import { Resend } from 'resend'
import { logger } from './logger'

let resendClient: Resend | null = null

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return null
  if (!resendClient) resendClient = new Resend(apiKey)
  return resendClient
}

export interface NotificationOptions {
  to: string
  subject: string
  html: string
}

/**
 * Send an email notification. Returns silently if RESEND_API_KEY is not set
 * (graceful degradation — notifications are optional).
 */
export async function sendEmail(opts: NotificationOptions): Promise<boolean> {
  const client = getClient()
  if (!client) {
    logger.debug('Email skipped — RESEND_API_KEY not configured')
    return false
  }
  try {
    const from = process.env.EMAIL_FROM || 'Opal Line <notifications@opalline.in>'
    const { error } = await client.emails.send({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    })
    if (error) {
      logger.error({ error: error.message }, 'Email send failed')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'Email send exception')
    return false
  }
}

// ─── Pre-built notification templates ───────────────────────────────

export async function notifyBackupComplete(
  recipientEmail: string,
  opts: { type: string; tables: number; fileName: string; recordCount?: number }
): Promise<boolean> {
  return sendEmail({
    to: recipientEmail,
    subject: `✅ Backup Complete — ${opts.type} (${opts.tables} tables)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">✅ Backup Completed</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #666;">Type</td><td style="padding: 8px; font-weight: bold;">${opts.type}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Tables</td><td style="padding: 8px;">${opts.tables}</td></tr>
          ${opts.recordCount ? `<tr><td style="padding: 8px; color: #666;">Records</td><td style="padding: 8px;">${opts.recordCount}</td></tr>` : ''}
          <tr><td style="padding: 8px; color: #666;">File</td><td style="padding: 8px; font-family: monospace; font-size: 13px;">${opts.fileName}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Time</td><td style="padding: 8px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Auto Backup Notification</p>
      </div>
    `,
  })
}

export async function notifyLowStock(
  recipientEmail: string,
  products: Array<{ name: string; sku: string; stock: number; reorderLevel: number }>
): Promise<boolean> {
  if (products.length === 0) return false
  const rows = products
    .map(
      (p) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; font-family: monospace;">${p.sku}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; color: #dc2626; font-weight: bold;">${p.stock}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.reorderLevel}</td>
      </tr>`
    )
    .join('')

  return sendEmail({
    to: recipientEmail,
    subject: `⚠️ Low Stock Alert — ${products.length} product(s) below reorder level`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">⚠️ Low Stock Alert</h2>
        <p>The following products are below their reorder level and need restocking:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #eee;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px; text-align: left;">Product</th>
              <th style="padding: 8px; text-align: left;">SKU</th>
              <th style="padding: 8px; text-align: center;">Stock</th>
              <th style="padding: 8px; text-align: center;">Reorder At</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Low Stock Notification</p>
      </div>
    `,
  })
}

export async function notifyDailySummary(
  recipientEmail: string,
  opts: {
    todaySales: number
    todayOrders: number
    pendingPayments: number
    lowStockCount: number
  }
): Promise<boolean> {
  return sendEmail({
    to: recipientEmail,
    subject: `📊 Daily Summary — ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">📊 Daily Business Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 12px; color: #666;">Today's Sales</td><td style="padding: 12px; font-weight: bold; font-size: 18px;">₹${opts.todaySales.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Orders Today</td><td style="padding: 12px; font-weight: bold;">${opts.todayOrders}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Pending Payments</td><td style="padding: 12px; color: ${opts.pendingPayments > 0 ? '#dc2626' : '#16a34a'};">${opts.pendingPayments}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Low Stock Items</td><td style="padding: 12px; color: ${opts.lowStockCount > 0 ? '#dc2626' : '#16a34a'};">${opts.lowStockCount}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Daily Summary</p>
      </div>
    `,
  })
}