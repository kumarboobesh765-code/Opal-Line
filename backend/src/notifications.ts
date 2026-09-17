import { Resend } from 'resend'
import { logger } from './logger'

let resendClient: Resend | null = null

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return null
  if (!resendClient) resendClient = new Resend(apiKey)
  return resendClient
}

export interface EmailAttachment {
  filename: string
  content: Buffer
}

export interface NotificationOptions {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

/**
 * Send an email notification. Returns silently if RESEND_API_KEY is not set
 * (graceful degradation — notifications are optional).
 */
let gmailTransport: import('nodemailer').Transporter | null = null // kept for backward compat; port-fallback transports are built per-send
void gmailTransport

/**
 * Gmail SMTP fallback using the same ORDER_EMAIL_* app-password credentials
 * the order-email ingest already uses. Lets notifications work without a
 * separate Resend account.
 *
 * Networks often block SMTP port 465, so we resolve the host to IPv4
 * ourselves (IPv6 is frequently unreachable) and automatically fall back
 * from 465 (implicit TLS) to 587 (STARTTLS) when the connection times out.
 */
let resolvedHost: string | null = null

async function resolveIpv4(host: string): Promise<string> {
  if (resolvedHost) return resolvedHost
  try {
    const dns = require('node:dns') as typeof import('node:dns')
    const addrs = await dns.promises.resolve4(host)
    if (addrs?.length) resolvedHost = addrs[0]
  } catch { /* fall back to hostname */ }
  return resolvedHost ?? host
}

async function buildGmailTransport(port: number): Promise<import('nodemailer').Transporter | null> {
  const user = process.env.ORDER_EMAIL_ADDRESS?.trim()
  const passEnc = process.env.ORDER_EMAIL_PASSWORD?.trim()
  if (!user || !passEnc) return null
  const nodemailer = require('nodemailer') as typeof import('nodemailer')
  const { decryptSecret } = require('./lib/crypto') as typeof import('./lib/crypto')
  const host = process.env.NOTIFICATION_SMTP_HOST?.trim() || 'smtp.gmail.com'
  const connectHost = await resolveIpv4(host)
  return nodemailer.createTransport({
    host: connectHost,
    port,
    secure: port === 465,
    tls: { servername: host },
    connectionTimeout: 10_000,
    auth: { user, pass: decryptSecret(passEnc) },
  })
}

async function sendViaGmail(opts: NotificationOptions): Promise<boolean> {
  const ports = [Number(process.env.NOTIFICATION_SMTP_PORT ?? 465), 587].filter((p, i, a) => a.indexOf(p) === i)
  for (const port of ports) {
    const transport = await buildGmailTransport(port)
    if (!transport) return false
    try {
      const user = process.env.ORDER_EMAIL_ADDRESS!.trim()
      await transport.sendMail({
        from: process.env.EMAIL_FROM || `Opal Line ERP <${user}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      })
      return true
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      logger.warn({ err: { code, message: err instanceof Error ? err.message : 'unknown' }, port }, 'Gmail SMTP attempt failed on this port')
      // Try the next port on connect-level failures only
      if (!['ESOCKET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return false
    }
  }
  return false
}

export async function sendEmail(opts: NotificationOptions): Promise<boolean> {
  const client = getClient()
  if (client) {
    try {
      const from = process.env.EMAIL_FROM || 'Opal Line <notifications@opalline.in>'
      const { error } = await client.emails.send({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
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
  // Fallback: Gmail SMTP with the ingest app password
  return sendViaGmail(opts)
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

/** Standalone dues statement email (used by the Dues page "Email Statement" action). */
export async function notifyDuesStatement(
  recipientEmail: string,
  statement: { buffer: Buffer; totalDue: number; customerCount: number },
): Promise<boolean> {
  const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return sendEmail({
    to: recipientEmail,
    subject: `💳 Outstanding Dues Statement — ${money(statement.totalDue)} across ${statement.customerCount} customer${statement.customerCount === 1 ? '' : 's'}`,
    attachments: [{ filename: `dues-statement-${new Date().toISOString().slice(0, 10)}.pdf`, content: statement.buffer }],
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color:#dc2626;">💳 Outstanding Dues Statement</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 12px; color: #666;">Total Outstanding</td><td style="padding: 12px; font-weight: bold; font-size: 18px; color: #dc2626;">${money(statement.totalDue)}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Customers with dues</td><td style="padding: 12px; font-weight: bold;">${statement.customerCount}</td></tr>
        </table>
        <p style="color:#666;">The full per-customer breakdown is attached as a PDF.</p>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Dues Statement</p>
      </div>
    `,
  })
}

/** Per-customer account statement email (statement PDF attached). */
export async function notifyCustomerStatement(
  recipientEmail: string,
  customer: string,
  statement: { buffer: Buffer; invoiceCount: number; totalBilled: number; totalPaid: number; outstanding: number },
): Promise<boolean> {
  const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const balance = statement.outstanding > 0 ? `Outstanding balance: <b style="color:#dc2626">${money(statement.outstanding)}</b>` : 'Account fully settled — thank you!'
  return sendEmail({
    to: recipientEmail,
    subject: `Your Opal Line Account Statement — ${statement.invoiceCount} invoice${statement.invoiceCount === 1 ? '' : 's'}`,
    attachments: [{ filename: `statement-${customer.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`, content: statement.buffer }],
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color:#2563eb;">Account Statement — ${customer}</h2>
        <p style="color:#666;">Hi ${customer}, please find your account statement attached.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 12px; color: #666;">Invoices</td><td style="padding: 8px 12px; font-weight: bold;">${statement.invoiceCount}</td></tr>
          <tr><td style="padding: 8px 12px; color: #666;">Total billed</td><td style="padding: 8px 12px; font-weight: bold;">${money(statement.totalBilled)}</td></tr>
          <tr><td style="padding: 8px 12px; color: #666;">Total paid</td><td style="padding: 8px 12px; font-weight: bold; color: #16a34a;">${money(statement.totalPaid)}</td></tr>
          <tr><td style="padding: 8px 12px; color: #666;">Balance</td><td style="padding: 8px 12px; font-weight: bold;">${statement.outstanding > 0 ? money(statement.outstanding) : '₹0.00'}</td></tr>
        </table>
        <p>${balance}</p>
        <p style="color: #999; font-size: 12px;">Opal Line ERP</p>
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
    duesTotal?: number
    duesCustomers?: number
    attachment?: { filename: string; content: Buffer }
  }
): Promise<boolean> {
  const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const duesRow =
    opts.duesTotal != null && opts.duesTotal > 0
      ? `\n        <tr><td style="padding: 12px; color: #666;">Outstanding Dues</td><td style="padding: 12px; font-weight: bold; color: #dc2626;">${money(opts.duesTotal)} <span style="font-weight: normal; color: #999;">(${opts.duesCustomers ?? 0} customers — see attached statement)</span></td></tr>`
      : ''
  return sendEmail({
    to: recipientEmail,
    subject: `📊 Daily Summary — ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    attachments: opts.attachment ? [opts.attachment] : undefined,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">📊 Daily Business Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 12px; color: #666;">Today's Sales</td><td style="padding: 12px; font-weight: bold; font-size: 18px;">₹${opts.todaySales.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Orders Today</td><td style="padding: 12px; font-weight: bold;">${opts.todayOrders}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Pending Payments</td><td style="padding: 12px; color: ${opts.pendingPayments > 0 ? '#dc2626' : '#16a34a'};">${opts.pendingPayments}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Low Stock Items</td><td style="padding: 12px; color: ${opts.lowStockCount > 0 ? '#dc2626' : '#16a34a'};">${opts.lowStockCount}</td></tr>${duesRow}
        </table>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Daily Summary</p>
      </div>
    `,
  })
}