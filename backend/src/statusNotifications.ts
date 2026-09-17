import { db, schema } from './db/client'
import { eq, sql, desc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { logger } from './logger'
import { sendEmail } from './notifications'
import { sendWhatsAppMessage, isWhatsAppConfigured } from './whatsapp'

/**
 * Customer status notifications — fire-and-forget. Orders carry only a
 * customer *name*, so contact info is looked up from the customers table.
 * Every helper fails silently: notifications must never break a transaction.
 */

interface OrderLike {
  internalId?: string | null
  shopifyId?: string | null
  customer?: string | null
  value?: number | string | null
  items?: number | null
  shippingAddress?: unknown
  billingAddress?: unknown
}

function orderRef(o: OrderLike): string {
  return o.internalId || o.shopifyId || 'your order'
}

async function findCustomerContact(name: string | null | undefined): Promise<{ email: string | null; phone: string | null }> {
  if (!db || !name) return { email: null, phone: null }
  try {
    // Several customer rows can share a name; prefer ones that actually have
    // contact details rather than a random LIMIT 1 match.
    const rows = await db
      .select({ email: schema.customers.email, phone: schema.customers.phone })
      .from(schema.customers)
      .where(eq(schema.customers.name, name))
      .orderBy(desc(sql`(${schema.customers.email} IS NOT NULL)::int + (${schema.customers.phone} IS NOT NULL)::int`))
      .limit(1)
    return { email: rows[0]?.email ?? null, phone: rows[0]?.phone ?? null }
  } catch (err) {
    logger.warn({ err }, 'status notification: customer lookup failed')
    return { email: null, phone: null }
  }
}

/**
 * Fallback: pull the phone from the order's own shipping/billing address.
 * Shopify dev stores redact customer PII, but the address phone usually
 * survives — and this is also the only source when the customer row is missing.
 */
function phoneFromAddresses(order: OrderLike): string | null {
  for (const addr of [order.shippingAddress, order.billingAddress]) {
    if (addr && typeof addr === 'object') {
      const phone = (addr as Record<string, unknown>).phone
      if (typeof phone === 'string' && phone.replace(/\D/g, '').length >= 10) return phone
    }
  }
  return null
}

function fmtAmount(v: number | string | null | undefined): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '0'
}

/** Persist every send attempt so admins can audit / resend later. */
async function logNotification(entry: { kind: string; channel: 'email' | 'whatsapp'; recipient: string | null; ref: string; ok: boolean; error?: string }): Promise<void> {
  if (!db) return
  try {
    await db.insert(schema.notificationLog).values({
      id: randomUUID(),
      kind: entry.kind,
      channel: entry.channel,
      recipient: entry.recipient,
      ref: entry.ref,
      status: entry.ok ? 'sent' : 'failed',
      error: entry.error ?? null,
      createdAt: new Date().toISOString(),
    })
  } catch {
    // logging must never throw
  }
}

/** Read per-type notification toggles from settings (default ON). */
async function prefsEnabled(keys: Array<'orderFulfilledEmail' | 'orderFulfilledWhatsapp' | 'returnProcessedEmail' | 'returnProcessedWhatsapp'>): Promise<{ email: boolean; whatsapp: boolean }> {
  const out = { email: true, whatsapp: true }
  if (!db) return out
  try {
    const [row] = await db.select({ notificationSettings: schema.settings.notificationSettings }).from(schema.settings).where(sql`${schema.settings.id} = 'app'`).limit(1)
    const n = (row?.notificationSettings ?? {}) as Record<string, unknown>
    for (const k of keys) {
      if (k.endsWith('Email') && n[k] === false) out.email = false
      if (k.endsWith('Whatsapp') && n[k] === false) out.whatsapp = false
    }
  } catch {
    // settings unavailable — default to sending
  }
  return out
}

/** Notify the customer that their order has been fulfilled/shipped. */
export async function notifyOrderFulfilled(order: OrderLike & { trackingId?: string | null; carrier?: string | null }): Promise<void> {
  try {
    const prefs = await prefsEnabled(['orderFulfilledEmail', 'orderFulfilledWhatsapp'])
    if (!prefs.email && !prefs.whatsapp) return
    const ref = orderRef(order)
    const name = order.customer ?? 'Customer'
    const { email, phone: custPhone } = await findCustomerContact(order.customer)
    const phone = custPhone ?? phoneFromAddresses(order)
    const trackingLine = order.trackingId
      ? `Tracking: <strong>${order.trackingId}</strong>${order.carrier ? ` (${order.carrier})` : ''}<br/>`
      : ''
    const subject = `Your order ${ref} is on its way! — Opal Line`
    const trackingUrl = order.trackingId
      ? `https://trackcourier.pythonanywhere.com/Search/AWB/${encodeURIComponent(order.trackingId)}`
      : null
    const html = `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">Good news, ${name}! 🎉</h2>
      <p>Your order <strong>${ref}</strong>${order.items ? ` (${order.items} item${order.items === 1 ? '' : 's'})` : ''} worth <strong>₹${fmtAmount(order.value)}</strong> has been packed and is on its way to you.</p>
      ${trackingLine}
      ${trackingUrl ? `<p><a href="${trackingUrl}">Track your shipment</a></p>` : ''}
      <p style="color:#64748b;font-size:13px">Thank you for shopping with Opal Line.</p>
    </div>`
    let emailOk = false
    let waOk = false
    if (prefs.email && email) {
      emailOk = await sendEmail({ to: email, subject, html })
      await logNotification({ kind: 'order_fulfilled', channel: 'email', recipient: email, ref, ok: emailOk, error: emailOk ? undefined : 'send failed' })
    }
    if (prefs.whatsapp && phone && isWhatsAppConfigured()) {
      const trackSuffix = order.trackingId
        ? `\nTrack: ${trackingUrl}`
        : ''
      const wa = await sendWhatsAppMessage(phone, `Good news, ${name}! Your order ${ref} (₹${fmtAmount(order.value)}) has been fulfilled and is on its way.${order.trackingId ? `\nTracking: ${order.trackingId}${order.carrier ? ` (${order.carrier})` : ''}${trackSuffix}` : ''}\n\n— Opal Line`)
      waOk = wa !== null
      await logNotification({ kind: 'order_fulfilled', channel: 'whatsapp', recipient: phone, ref, ok: waOk, error: waOk ? undefined : 'API send failed' })
    }
    logger.info({ ref, emailed: emailOk, whatsapped: waOk }, 'Order fulfilled notification processed')
  } catch (err) {
    logger.warn({ err }, 'notifyOrderFulfilled failed (non-fatal)')
  }
}

/** Notify the customer that a return has been processed for their invoice. */
export async function notifyReturnProcessed(opts: {
  customer?: string | null
  invoiceNumber: string
  amount: number
  restocked: boolean
  creditNoteNumber?: string
}): Promise<void> {
  try {
    const prefs = await prefsEnabled(['returnProcessedEmail', 'returnProcessedWhatsapp'])
    if (!prefs.email && !prefs.whatsapp) return
    const name = opts.customer ?? 'Customer'
    const { email, phone } = await findCustomerContact(opts.customer)
    const subject = `Return processed for invoice ${opts.invoiceNumber} — Opal Line`
    const html = `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">Return processed</h2>
      <p>Dear ${name},</p>
      <p>We've processed your return for invoice <strong>${opts.invoiceNumber}</strong>.</p>
      <ul>
        <li>Credit amount: <strong>₹${opts.amount.toLocaleString('en-IN')}</strong></li>
        ${opts.creditNoteNumber ? `<li>Credit note: <strong>${opts.creditNoteNumber}</strong></li>` : ''}
        <li>Items ${opts.restocked ? 'have been returned to stock' : 'were not restocked'}</li>
      </ul>
      <p style="color:#64748b;font-size:13px">If you have any questions, just reply to this email.</p>
    </div>`
    if (prefs.email && email) {
      const ok = await sendEmail({ to: email, subject, html })
      await logNotification({ kind: 'return_processed', channel: 'email', recipient: email, ref: opts.invoiceNumber, ok, error: ok ? undefined : 'send failed' })
    }
    if (prefs.whatsapp && phone && isWhatsAppConfigured()) {
      const wa = await sendWhatsAppMessage(phone, `Return processed for invoice ${opts.invoiceNumber}: ₹${opts.amount.toLocaleString('en-IN')} credited${opts.creditNoteNumber ? ` (Credit note ${opts.creditNoteNumber})` : ''}. — Opal Line`)
      await logNotification({ kind: 'return_processed', channel: 'whatsapp', recipient: phone, ref: opts.invoiceNumber, ok: wa !== null, error: wa === null ? 'API send failed' : undefined })
    }
    logger.info({ invoice: opts.invoiceNumber, emailed: Boolean(email && prefs.email), whatsapped: Boolean(phone && prefs.whatsapp) }, 'Return notification processed')
  } catch (err) {
    logger.warn({ err }, 'notifyReturnProcessed failed (non-fatal)')
  }
}
