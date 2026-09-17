import { db, schema } from './db/client'
import { eq } from 'drizzle-orm'
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
}

function orderRef(o: OrderLike): string {
  return o.internalId || o.shopifyId || 'your order'
}

async function findCustomerContact(name: string | null | undefined): Promise<{ email: string | null; phone: string | null }> {
  if (!db || !name) return { email: null, phone: null }
  try {
    const [c] = await db.select({ email: schema.customers.email, phone: schema.customers.phone }).from(schema.customers).where(eq(schema.customers.name, name)).limit(1)
    return { email: c?.email ?? null, phone: c?.phone ?? null }
  } catch (err) {
    logger.warn({ err }, 'status notification: customer lookup failed')
    return { email: null, phone: null }
  }
}

function fmtAmount(v: number | string | null | undefined): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '0'
}

/** Notify the customer that their order has been fulfilled/shipped. */
export async function notifyOrderFulfilled(order: OrderLike): Promise<void> {
  try {
    const ref = orderRef(order)
    const name = order.customer ?? 'Customer'
    const { email, phone } = await findCustomerContact(order.customer)
    const subject = `Your order ${ref} is on its way! — Opal Line`
    const html = `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">Good news, ${name}! 🎉</h2>
      <p>Your order <strong>${ref}</strong>${order.items ? ` (${order.items} item${order.items === 1 ? '' : 's'})` : ''} worth <strong>₹${fmtAmount(order.value)}</strong> has been packed and is on its way to you.</p>
      <p style="color:#64748b;font-size:13px">Thank you for shopping with Opal Line.</p>
    </div>`
    if (email) await sendEmail({ to: email, subject, html })
    if (phone && isWhatsAppConfigured()) {
      await sendWhatsAppMessage(phone, `Good news, ${name}! Your order ${ref} (₹${fmtAmount(order.value)}) has been fulfilled and is on its way. — Opal Line`)
    }
    logger.info({ ref, emailed: Boolean(email), whatsapped: Boolean(phone) }, 'Order fulfilled notification processed')
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
    if (email) await sendEmail({ to: email, subject, html })
    if (phone && isWhatsAppConfigured()) {
      await sendWhatsAppMessage(phone, `Return processed for invoice ${opts.invoiceNumber}: ₹${opts.amount.toLocaleString('en-IN')} credited${opts.creditNoteNumber ? ` (Credit note ${opts.creditNoteNumber})` : ''}. — Opal Line`)
    }
    logger.info({ invoice: opts.invoiceNumber, emailed: Boolean(email), whatsapped: Boolean(phone) }, 'Return notification processed')
  } catch (err) {
    logger.warn({ err }, 'notifyReturnProcessed failed (non-fatal)')
  }
}
