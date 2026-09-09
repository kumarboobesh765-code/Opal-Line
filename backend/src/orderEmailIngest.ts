import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import * as schema from './db/schema'
import { decryptSecret } from './lib/crypto'
import { logger } from './logger'

/**
 * Shopify Order Email Ingestion
 * ─────────────────────────────
 * Shopify's API/webhook responses can be redacted (Protected Customer Data on
 * dev/preview apps) but the store-owner "New Order" notification email is NOT
 * redacted — it always contains the full customer name, phone, email and
 * billing/shipping address.
 *
 * This module polls a dedicated IMAP mailbox, finds "New order" emails,
 * parses the customer data and merges it into sales_orders (matching by
 * Shopify order number). It can also create the order if the webhook missed it.
 *
 * Setup:
 *   1. Shopify Admin → Settings → Notifications → staff order notification →
 *      set to ORDER_EMAIL_ADDRESS (a dedicated mailbox, e.g. orders@…)
 *   2. Gmail: enable 2FA, create an App Password, enable IMAP.
 *   3. backend/.env:
 *        ORDER_EMAIL_ADDRESS=orders@yourdomain.com
 *        ORDER_EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx   (Gmail app password, encrypted)
 *        ORDER_EMAIL_HOST=imap.gmail.com
 *        ORDER_EMAIL_PORT=993
 *        ORDER_EMAIL_FOLDER=INBOX
 */

const POLL_INTERVAL_MS = 2 * 60 * 1000
const LOOKBACK_DAYS = 7
let pollTimer: NodeJS.Timeout | null = null
let running = false

export interface OrderEmailData {
  orderNumber: string
  customerName: string
  email: string
  phone: string
  billing: {
    name?: string
    address1?: string
    address2?: string
    city?: string
    province?: string
    zip?: string
    country?: string
    phone?: string
  } | null
  shipping: {
    name?: string
    address1?: string
    address2?: string
    city?: string
    province?: string
    zip?: string
    country?: string
    phone?: string
  } | null
  total: number
  items: Array<{ title: string; sku: string; quantity: number; price: number }>
  paymentMethod: string
  date: string
}

export function isEmailIngestConfigured(): boolean {
  const user = process.env.ORDER_EMAIL_ADDRESS?.trim()
  const pass = process.env.ORDER_EMAIL_PASSWORD?.trim()
  return Boolean(user && pass)
}

// ─── Email text parsing helpers ─────────────────────────────────────

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const cleanLines = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : []

// "Order #1042" / "New order #1042" / "Dev store order #1042" — capture digits.
const ORDER_NUM_RE = /#(\d{3,})/
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/
const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/

/** Subject like "New order #1042" or "Dev store order #1042". */
export function parseOrderNumberFromSubject(subject: string): string | null {
  const m = subject.match(ORDER_NUM_RE)
  return m ? m[1] : null
}

/**
 * Parse the plain-text part of a Shopify "New order" notification email.
 * Shopify templates include a "Customer" block with contact info and a
 * billing/shipping address block. This uses labeled line matching so it
 * survives minor template changes.
 */
export function parseOrderEmailText(text: string, subject: string): OrderEmailData | null {
  const orderNumber = parseOrderNumberFromSubject(subject)
  if (!orderNumber) return null

  const lines = cleanLines(text)
  const lower = lines.map((l) => l.toLowerCase())

  const lineAfter = (labelRe: RegExp): string => {
    const idx = lower.findIndex((l) => labelRe.test(l))
    return idx >= 0 && idx + 1 < lines.length ? clean(lines[idx + 1]) : ''
  }

  // Customer name: line after "Customer" label (skip the order-number line itself)
  let customerName = ''
  const custIdx = lower.findIndex((l) => /^customer\b/.test(l))
  if (custIdx >= 0) {
    for (let i = custIdx + 1; i < Math.min(custIdx + 4, lines.length); i++) {
      const v = clean(lines[i])
      if (!v || ORDER_NUM_RE.test(v)) continue
      if (EMAIL_RE.test(v) || PHONE_RE.test(v)) break
      customerName = v
      break
    }
  }
  if (!customerName) customerName = lineAfter(/^shipping address$/)

  const emailMatch = text.match(EMAIL_RE)
  const email = emailMatch ? emailMatch[0] : ''

  let phone = ''
  const phoneIdx = lower.findIndex((l) => /^phone number$/.test(l))
  if (phoneIdx >= 0) {
    phone = clean(lines[phoneIdx + 1] ?? '')
  }
  if (!phone) {
    const allPhones = text.match(new RegExp(PHONE_RE.source, 'g')) ?? []
    phone = clean(allPhones.find((p) => p.replace(/\D/g, '').length >= 10) ?? '')
  }

  // Address block: prefer Shipping Address, fall back to Billing Address.
  const parseAddr = (startRe: RegExp): OrderEmailData['shipping'] => {
    const start = lower.findIndex((l) => startRe.test(l))
    if (start < 0) return null
    const fields: { name?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; country?: string; phone?: string } = {}
    let addressLines: string[] = []
    let k = start + 1
    while (k < lines.length && k < start + 12) {
      const l = lines[k]
      const ll = lower[k]
      if (/^(billing address|shipping address|customer|payment method|note|items?)$/.test(ll)) break
      if (EMAIL_RE.test(l)) break
      if (PHONE_RE.test(l) && !fields.phone && addressLines.length > 0) {
        fields.phone = clean(l)
        k++
        continue
      }
      if (/^\d{5,6}(\s|,|-|$)/.test(l)) {
        // PIN code line often "400069" or "400069 MH" — the city/province precede it
        const prev = addressLines.length ? addressLines[addressLines.length - 1] : ''
        fields.zip = l
        if (prev) fields.city = prev
        k++
        continue
      }
      addressLines.push(l)
      k++
    }
    if (addressLines.length > 0) fields.name = addressLines.shift()
    if (addressLines.length > 0) fields.address1 = addressLines.shift()
    if (addressLines.length > 0) fields.address2 = addressLines.join(', ')
    return Object.values(fields).some(Boolean) ? fields : null
  }

  const shipping = parseAddr(/^shipping address$/) ?? parseAddr(/^billing address$/)
  const billing = parseAddr(/^billing address$/) ?? shipping

  // Items table (plain text): "1 × Silver Bangles 925 ₹3,200.00" variants
  const items: OrderEmailData['items'] = []
  const itemRe = /^\s*(\d+)\s*[×x]\s*(.+?)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*$/
  for (const l of lines) {
    const m = l.match(itemRe)
    if (m) {
      items.push({
        title: clean(m[2]),
        sku: '',
        quantity: Math.max(0, parseInt(m[1], 10) || 0),
        price: Math.round(Number(m[3].replace(/,/g, '')) * 100) / 100,
      })
    }
  }

  // Totals
  let total = 0
  const totalLine = [...lines].reverse().find((l) => /^total\b/i.test(l))
  if (totalLine) {
    const m = totalLine.match(/([\d,]+(?:\.\d+)?)/)
    if (m) total = Math.round(Number(m[1].replace(/,/g, '')) * 100) / 100
  }
  if (!total) {
    const rsTotal = text.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/g)
    if (rsTotal && rsTotal.length > 0) {
      const last = rsTotal[rsTotal.length - 1]
      const m = last.match(/([\d,]+(?:\.\d+)?)/)
      if (m) total = Math.round(Number(m[1].replace(/,/g, '')) * 100) / 100
    }
  }

  // Payment method: line after "Payment method" label
  let paymentMethod = ''
  const payIdx = lower.findIndex((l) => /^payment method$/.test(l))
  if (payIdx >= 0) paymentMethod = clean(lines[payIdx + 1] ?? '')

  const date = new Date().toISOString()
  if (!customerName && !email && !phone && !shipping && !billing) return null

  return {
    orderNumber,
    customerName: customerName || 'Guest',
    email,
    phone,
    billing,
    shipping,
    total,
    items,
    paymentMethod,
    date,
  }
}

/**
 * Parse from a full parsed email (html or text). Tries text first, then strips
 * tags from html as a fallback so rich-only templates still work.
 */
export function parseOrderEmail(mail: ParsedMail): OrderEmailData | null {
  const subject = clean(mail.subject)
  if (!parseOrderNumberFromSubject(subject)) return null
  if (mail.text) {
    const fromText = parseOrderEmailText(mail.text, subject)
    if (fromText) return fromText
  }
  if (mail.html) {
    const html = typeof mail.html === 'string' ? mail.html : false
    if (html) {
      const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#8377;|&rsquo;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
      const fromHtml = parseOrderEmailText(text, subject)
      if (fromHtml) return fromHtml
    }
  }
  return null
}

// ─── DB merge ───────────────────────────────────────────────────────

function normalizePayment(raw: string): string {
  const v = raw.toLowerCase()
  if (/cod|cash/.test(v)) return 'cod'
  if (/online|upi|card|razorpay|payu|paytm/.test(v)) return 'online'
  if (/bank|neft|imps|rtgs/.test(v)) return 'bank'
  return 'paid'
}

/** Merge parsed email data into sales_orders, creating the order if missing. */
export async function mergeOrderData(d: OrderEmailData): Promise<{ updated: boolean; created: boolean }> {
  if (!db) throw new Error('Database is not configured')
  const shopifyId = `#${d.orderNumber}`
  const billingAddress = d.billing ?? undefined
  const shippingAddress = d.shipping ?? undefined

  const [existing] = await db
    .select({ id: schema.salesOrders.id, customer: schema.salesOrders.customer, billingAddress: schema.salesOrders.billingAddress })
    .from(schema.salesOrders)
    .where(eq(schema.salesOrders.shopifyId, shopifyId))
    .limit(1)

  if (existing) {
    const curAddr = (existing.billingAddress ?? {}) as Record<string, unknown>
    const hasRealAddr = Boolean(curAddr && typeof curAddr === 'object' && (curAddr.address1 || curAddr.phone))
    const guestish = !existing.customer || existing.customer === 'Guest' || existing.customer === ''
    const needAddr = !hasRealAddr && billingAddress
    if (!guestish && hasRealAddr) {
      return { updated: false, created: false } // already complete
    }
    const newAddr = needAddr ? billingAddress : undefined
    const newCustomer = d.customerName && d.customerName !== 'Guest' ? d.customerName : undefined
    const newTotal = d.total > 0 ? d.total : undefined
    const newItems = d.items.length > 0 ? d.items.reduce((s, i) => s + i.quantity, 0) : undefined
    const newLineItems = d.items.length > 0 ? d.items : undefined
    if (!newAddr && !newCustomer && !newTotal && !newLineItems) {
      return { updated: false, created: false } // nothing meaningful to add
    }
    await db
      .update(schema.salesOrders)
      .set({
        customer: newCustomer,
        value: newTotal,
        items: newItems,
        lineItems: newLineItems,
        billingAddress: newAddr,
        shippingAddress: newAddr && shippingAddress ? shippingAddress : undefined,
      })
      .where(eq(schema.salesOrders.shopifyId, shopifyId))
    return { updated: true, created: false }
  }

  // Create the order if webhook missed it
  await db
    .insert(schema.salesOrders)
    .values({
      id: `email-${d.orderNumber}-${Date.now()}`,
      shopifyId,
      internalId: `SO-${d.orderNumber}`,
      customer: d.customerName || 'Guest',
      value: d.total,
      payment: normalizePayment(d.paymentMethod),
      fulfillment: 'unfulfilled',
      invoice: null,
      status: 'imported',
      date: d.date,
      items: d.items.reduce((s, i) => s + i.quantity, 0),
      lineItems: d.items.length > 0 ? d.items : null,
      billingAddress: billingAddress ?? undefined,
      shippingAddress: shippingAddress ?? undefined,
    })
    .onConflictDoNothing()
  return { updated: false, created: true }
}

// ─── IMAP polling ───────────────────────────────────────────────────

function emailConfig() {
  const passEnc = process.env.ORDER_EMAIL_PASSWORD?.trim() ?? ''
  const password = passEnc ? decryptSecret(passEnc) : ''
  return {
    user: process.env.ORDER_EMAIL_ADDRESS?.trim() ?? '',
    pass: password,
    host: process.env.ORDER_EMAIL_HOST?.trim() || 'imap.gmail.com',
    port: Number(process.env.ORDER_EMAIL_PORT ?? 993),
    folder: process.env.ORDER_EMAIL_FOLDER?.trim() || 'INBOX',
  }
}

export interface IngestResult {
  ok: boolean
  scanned: number
  parsed: number
  updated: number
  created: number
  errors: string[]
}

export async function pollOrderMailbox(): Promise<IngestResult> {
  const res: IngestResult = { ok: false, scanned: 0, parsed: 0, updated: 0, created: 0, errors: [] }
  if (!isEmailIngestConfigured()) {
    res.errors.push('Email ingestion not configured (ORDER_EMAIL_ADDRESS / ORDER_EMAIL_PASSWORD)')
    return res
  }
  if (running) {
    res.errors.push('Poll already in progress')
    return res
  }
  running = true
  const cfg = emailConfig()
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    emitLogs: false,
  })
  try {
    await client.connect()
    await client.mailboxOpen(cfg.folder)
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    for await (const msg of client.fetch({ since }, { envelope: true, source: true, uid: true })) {
      res.scanned++
      if (!msg.source) continue
      try {
        const parsed = await simpleParser(msg.source)
        const subject = clean(parsed.subject)
        // Only order notifications — skip shipping/refund/etc.
        if (!parseOrderNumberFromSubject(subject)) continue
        if (/refund|return|cancel|cxl|shipping|fulfill|delivery/i.test(subject)) continue
        const data = parseOrderEmail(parsed)
        if (!data) continue
        res.parsed++
        const merged = await mergeOrderData(data)
        if (merged.updated) res.updated++
        if (merged.created) res.created++
      } catch (err) {
        res.errors.push(err instanceof Error ? err.message : 'parse error')
      }
    }
    res.ok = true
    logger.info({ scanned: res.scanned, parsed: res.parsed, updated: res.updated, created: res.created }, 'Order email ingestion complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown IMAP error'
    res.errors.push(message)
    logger.error({ err: message }, 'Order email ingestion failed')
  } finally {
    try {
      await client.logout()
    } catch {
      try {
        client.close()
      } catch { /* already closed */ }
    }
    running = false
  }
  return res
}

export function startOrderEmailIngest(): void {
  if (pollTimer) return
  if (!isEmailIngestConfigured()) {
    logger.debug('Order email ingestion not configured — skipping scheduler')
    return
  }
  // Initial poll after a short delay so boot isn't blocked
  setTimeout(() => {
    pollOrderMailbox().catch(() => {})
  }, 15_000)
  pollTimer = setInterval(() => {
    pollOrderMailbox().catch(() => {})
  }, POLL_INTERVAL_MS)
  logger.info({ intervalMinutes: POLL_INTERVAL_MS / 60000 }, 'Order email ingestion scheduler started')
}

export function stopOrderEmailIngest(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
