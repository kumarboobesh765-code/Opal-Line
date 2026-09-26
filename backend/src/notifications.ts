import { Resend } from 'resend'
import { logger } from './logger'
import { escapeHtml } from './htmlEscape'

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
  products: Array<{
    name: string
    sku: string
    stock: number
    reorderLevel: number
    /** Optional detail columns for the richer alert. */
    category?: string | null
    sellingPrice?: number | null
    shopifyStatus?: string | null
    lastSoldDate?: string | null
    qtySold30d?: number
  }>
): Promise<boolean> {
  if (products.length === 0) return false
  const money = (n: number) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  // Severity split: already OUT of stock vs still above zero.
  const outOfStock = products.filter((p) => p.stock <= 0)
  const belowReorder = products.filter((p) => p.stock > 0)
  const row = (p: (typeof products)[number]) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(p.name)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; font-family: monospace;">${escapeHtml(p.sku)}</td>
        ${p.category ? `<td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(p.category)}</td>` : ''}
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; color: ${p.stock <= 0 ? '#dc2626' : '#b45309'}; font-weight: bold;">${p.stock}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.reorderLevel}</td>
        ${p.qtySold30d != null ? `<td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.qtySold30d}</td>` : ''}
        ${p.sellingPrice != null ? `<td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${money(p.sellingPrice)}</td>` : ''}
        ${p.shopifyStatus ? `<td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${escapeHtml(p.shopifyStatus)}</td>` : ''}
      </tr>`
  const columns =
    `<th style="padding: 8px; text-align: left;">Product</th>` +
    `<th style="padding: 8px; text-align: left;">SKU</th>` +
    (products.some((p) => p.category) ? `<th style="padding: 8px; text-align: left;">Category</th>` : '') +
    `<th style="padding: 8px; text-align: center;">In Stock</th>` +
    `<th style="padding: 8px; text-align: center;">Reorder At</th>` +
    (products.some((p) => p.qtySold30d != null) ? `<th style="padding: 8px; text-align: center;">Sold (30d)</th>` : '') +
    (products.some((p) => p.sellingPrice != null) ? `<th style="padding: 8px; text-align: right;">Price</th>` : '') +
    (products.some((p) => p.shopifyStatus) ? `<th style="padding: 8px; text-align: center;">Shopify</th>` : '')
  const section = (title: string, color: string, list: typeof products) =>
    list.length === 0
      ? ''
      : `<h3 style="color: ${color}; margin: 18px 0 6px;">${title} (${list.length})</h3>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee;">
        <thead><tr style="background: #f9fafb;">${columns}</tr></thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table>`

  return sendEmail({
    to: recipientEmail,
    subject: `⚠️ Low Stock Alert — ${outOfStock.length} out of stock, ${belowReorder.length} below reorder level`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">⚠️ Low Stock Alert</h2>
        <p>${products.length} product${products.length === 1 ? '' : 's'} need attention as of ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}:</p>
        ${section('🔴 Out of stock — lost sales until restocked', '#dc2626', outOfStock)}
        ${section('🟠 Below reorder level', '#b45309', belowReorder)}
        <p style="margin-top: 14px; color: #666; font-size: 12px;">"Sold (30d)" is units invoiced in the last 30 days — fast movers at the top of the restock queue first.</p>
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
    attachments: [{ filename: `statement-${customer.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`, content: statement.buffer }] as { filename: string; content: Buffer }[],
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color:#2563eb;">Account Statement — ${escapeHtml(customer)}</h2>
        <p style="color:#666;">Hi ${escapeHtml(customer)}, please find your account statement attached.</p>
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
    /** Extra detail blocks for the richer summary. */
    yesterdaySales?: number
    lowStockItems?: Array<{ name: string; sku: string; stock: number; reorderLevel: number; qtySold30d?: number }>
    topProducts?: Array<{ name: string; sku: string; qty: number; revenue: number; orders?: number }>
    mostSoldProduct?: { name: string; sku: string; qty: number; revenue: number; orders?: number } | null
    newCustomers?: number
    silverRate?: { rate: number; change: number; updatedAt: string | null } | null
  }
): Promise<boolean> {
  const money = (n: number) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const duesRow =
    opts.duesTotal != null && opts.duesTotal > 0
      ? `\n        <tr><td style="padding: 12px; color: #666;">Outstanding Dues</td><td style="padding: 12px; font-weight: bold; color: #dc2626;">${money(opts.duesTotal)} <span style="font-weight: normal; color: #999;">(${opts.duesCustomers ?? 0} customers — see attached statement)</span></td></tr>`
      : ''
  const delta = opts.yesterdaySales != null ? opts.todaySales - opts.yesterdaySales : null
  const deltaRow =
    delta != null
      ? `\n        <tr><td style="padding: 12px; color: #666;">vs Previous Day</td><td style="padding: 12px; font-weight: bold; color: ${delta >= 0 ? '#16a34a' : '#dc2626'};">${delta >= 0 ? '▲' : '▼'} ${money(Math.abs(delta))}</td></tr>`
      : ''
  const newCustRow =
    opts.newCustomers != null && opts.newCustomers > 0
      ? `\n        <tr><td style="padding: 12px; color: #666;">New Customers</td><td style="padding: 12px; font-weight: bold;">${opts.newCustomers}</td></tr>`
      : ''
  const silver = opts.silverRate
  const silverRow = silver
    ? `\n        <tr><td style="padding: 12px; color: #666;">Silver Rate</td><td style="padding: 12px; font-weight: bold;">₹${Number(silver.rate).toFixed(2)}/gm <span style="font-weight: normal; color: ${silver.change >= 0 ? '#16a34a' : '#dc2626'};">(${silver.change >= 0 ? '+' : ''}${Number(silver.change).toFixed(2)})</span></td></tr>`
    : ''

  const mostSold = opts.mostSoldProduct
  const mostSoldBlock = mostSold
    ? `\n        <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border-radius: 8px; padding: 14px 18px; margin: 16px 0;">
          <p style="margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #92400e; text-transform: uppercase;">🏆 Most Sold Product (last 30 days)</p>
          <p style="margin: 6px 0 2px; font-size: 16px; font-weight: 700; color: #78350f;">${escapeHtml(mostSold.name)}</p>
          <p style="margin: 0; font-size: 12px; color: #92400e;">SKU ${escapeHtml(mostSold.sku)} · <b>${mostSold.qty}</b> units sold · ${money(mostSold.revenue)} revenue${mostSold.orders != null ? ` · ${mostSold.orders} order${mostSold.orders === 1 ? '' : 's'}` : ''}</p>
        </div>`
    : ''

  const topRows = (opts.topProducts ?? [])
    .map(
      (p, i) => `\n          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #999; width: 28px;">${i + 1}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(p.name)}<br/><span style="font-family: monospace; font-size: 11px; color: #999;">${escapeHtml(p.sku)}</span></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold;">${p.qty}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${money(p.revenue)}</td>
          </tr>`,
    )
    .join('')
  const topBlock =
    topRows && topRows.length > 0
      ? `\n        <h3 style="color: #1f2937; margin: 20px 0 8px;">📈 Top 5 Products (last 30 days)</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee;">
          <thead><tr style="background: #f9fafb;"><th style="padding: 8px; text-align: left; width: 28px;">#</th><th style="padding: 8px; text-align: left;">Product</th><th style="padding: 8px; text-align: center;">Units</th><th style="padding: 8px; text-align: right;">Revenue</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table>`
      : ''

  const lowRows = (opts.lowStockItems ?? [])
    .slice(0, 10)
    .map(
      (p) => `\n          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(p.name)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 11px;">${escapeHtml(p.sku)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; color: ${p.stock <= 0 ? '#dc2626' : '#b45309'}; font-weight: bold;">${p.stock}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.reorderLevel}</td>
            ${p.qtySold30d != null ? `<td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.qtySold30d}</td>` : ''}
          </tr>`,
    )
    .join('')
  const lowBlock =
    lowRows && lowRows.length > 0
      ? `\n        <h3 style="color: #dc2626; margin: 20px 0 8px;">⚠️ Low Stock Detail (${opts.lowStockCount} total${(opts.lowStockItems?.length ?? 0) < opts.lowStockCount ? ` — first ${Math.min(10, opts.lowStockItems?.length ?? 0)} shown` : ''})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee;">
          <thead><tr style="background: #f9fafb;"><th style="padding: 8px; text-align: left;">Product</th><th style="padding: 8px; text-align: left;">SKU</th><th style="padding: 8px; text-align: center;">Stock</th><th style="padding: 8px; text-align: center;">Reorder At</th>${opts.lowStockItems?.some((p) => p.qtySold30d != null) ? '<th style="padding: 8px; text-align: center;">Sold (30d)</th>' : ''}</tr></thead>
          <tbody>${lowRows}</tbody>
        </table>`
      : ''

  return sendEmail({
    to: recipientEmail,
    subject: `📊 Daily Summary — ${money(opts.todaySales)} · ${opts.todayOrders} order${opts.todayOrders === 1 ? '' : 's'}${mostSold ? ` · Top: ${mostSold.name}` : ''}`,
    attachments: opts.attachment ? [opts.attachment] : undefined,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">📊 Daily Business Summary</h2>
        <p style="color: #666;">${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' })}</p>
        ${mostSoldBlock}
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 12px; color: #666;">Today's Sales</td><td style="padding: 12px; font-weight: bold; font-size: 18px;">${money(opts.todaySales)}</td></tr>${deltaRow}
          <tr><td style="padding: 12px; color: #666;">Orders Today</td><td style="padding: 12px; font-weight: bold;">${opts.todayOrders}</td></tr>${newCustRow}
          <tr><td style="padding: 12px; color: #666;">Pending Payments</td><td style="padding: 12px; color: ${opts.pendingPayments > 0 ? '#dc2626' : '#16a34a'};">${opts.pendingPayments}</td></tr>
          <tr><td style="padding: 12px; color: #666;">Low Stock Items</td><td style="padding: 12px; color: ${opts.lowStockCount > 0 ? '#dc2626' : '#16a34a'};">${opts.lowStockCount}</td></tr>${silverRow}${duesRow}
        </table>${topBlock}${lowBlock}
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Daily Summary</p>
      </div>
    `,
  })
}
/**
 * Email one or more backup files as attachments. Used by the Backup & Restore
 * page "Email backup" action and by scheduled full-DB email delivery.
 * Gmail/G-suite attachment limit is 25 MB per message — the caller filters.
 */
export async function notifyBackupFiles(
  recipientEmail: string,
  files: Array<{ fileName: string; content: Buffer }>,
  meta: { scopeLabel: string; tableCount: number; recordCount: number; note?: string }
): Promise<boolean> {
  if (files.length === 0) return false
  const sizeOf = (b: Buffer) => (b.length / (1024 * 1024)).toFixed(2) + ' MB'
  const fileRows = files
    .map((f) => `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 12px;">${escapeHtml(f.fileName)}</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${sizeOf(f.content)}</td></tr>`)
    .join('')
  return sendEmail({
    to: recipientEmail,
    subject: `📦 Backup Files — ${meta.scopeLabel} (${files.length} file${files.length === 1 ? '' : 's'}, ${meta.recordCount.toLocaleString('en-IN')} records)`,
    attachments: files.map((f) => ({ filename: f.fileName, content: f.content })),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">📦 Backup Files Attached</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #666;">Scope</td><td style="padding: 8px; font-weight: bold;">${escapeHtml(meta.scopeLabel)}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Tables</td><td style="padding: 8px;">${meta.tableCount}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Records</td><td style="padding: 8px;">${meta.recordCount.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Time</td><td style="padding: 8px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
        </table>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee;">
          <thead><tr style="background: #f9fafb;"><th style="padding: 8px; text-align: left;">File</th><th style="padding: 8px; text-align: right;">Size</th></tr></thead>
          <tbody>${fileRows}</tbody>
        </table>
        ${meta.note ? `<p style="color: #666; font-size: 12px; margin-top: 12px;">${escapeHtml(meta.note)}</p>` : ''}
        <p style="color: #b45309; font-size: 12px; margin-top: 8px;">Keep these files safe — they contain business data. Restore them from Backup &amp; Restore → Restore from file.</p>
        <p style="color: #999; font-size: 12px;">Opal Line ERP — Backup Delivery</p>
      </div>
    `,
  })
}
