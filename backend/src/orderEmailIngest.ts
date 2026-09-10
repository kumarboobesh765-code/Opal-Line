import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import { eq, or } from 'drizzle-orm'
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

/** Which mailbox protocol to use: IMAP (Gmail etc.) or mail.tm REST API. */
function emailProvider(): 'imap' | 'mailtm' {
  const p = process.env.ORDER_EMAIL_PROVIDER?.trim().toLowerCase()
  if (p === 'mailtm' || p === 'mail.tm') return 'mailtm'
  if (p === 'imap') return 'imap'
  // Auto-detect: mail.tm domains end in .tm-hosted domains like uberip.com;
  // default to IMAP otherwise.
  const host = process.env.ORDER_EMAIL_HOST?.trim().toLowerCase() ?? ''
  if (host.includes('mail.tm')) return 'mailtm'
  return 'imap'
}

// ─── Email text parsing helpers ─────────────────────────────────────

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const cleanLines = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split('\n')
        .map((l) => l.trim())
        // Drop empty lines and dash/underscore separator rules — Gmail renders
        // CSS rules as dashes and templates use them as visual separators;
        // either way they must never be mistaken for values.
        .filter((l) => l && !/^[-=_*.\s]+$/.test(l))
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

  // Strip URLs before scanning — Shopify "View order" links contain long digit
  // runs (order IDs) that would otherwise be mistaken for phone numbers.
  const textNoUrls = text.replace(/https?:\/\/\S+/g, ' ')
  const lines = cleanLines(textNoUrls)
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
      if (!v || ORDER_NUM_RE.test(v) || /^[-=_*.\s]+$/.test(v)) continue
      if (EMAIL_RE.test(v) || PHONE_RE.test(v)) break
      customerName = v
      break
    }
  }
  // Customer name: "placed by <Name>" in the subject (Shopify staff notification)
  if (!customerName) {
    const m = subject.match(/placed by\s+(.+?)\s*(?:\(|$)/i)
    if (m) customerName = clean(m[1])
  }
  // Body: "Priya Raghavan placed order #1035 on Sep 10 ..."
  if (!customerName) {
    for (const l of lines) {
      const m = l.match(/^([A-Za-z][\w'.&-]*(?:\s+[A-Za-z][\w'.&-]*){0,4})\s+placed order\b/)
      if (m) { customerName = clean(m[1]); break }
    }
  }
  if (!customerName) customerName = lineAfter(/^shipping address/)

  // Email: prefer a labeled "Email:" line, fall back to first address in body
  let email = ''
  const emailLblIdx = lower.findIndex((l) => /^email(?: address)?:/.test(l) || /^email$/.test(l))
  if (emailLblIdx >= 0) {
    const inline = lines[emailLblIdx].split(/:\s*(.+)$/)[1]
    const v = clean(inline || (lines[emailLblIdx + 1] ?? ''))
    const m = v.match(EMAIL_RE)
    if (m) email = m[0]
  }
  if (!email) {
    const m = textNoUrls.match(EMAIL_RE)
    if (m) email = m[0]
  }
  if (email) email = email.replace(/\.+$/, '') // strip trailing sentence period

  let phone = ''
  const phoneIdx = lower.findIndex((l) => /^(phone|phone number|contact number):?\s*$/.test(l))
  if (phoneIdx >= 0) {
    const inline = lines[phoneIdx].split(/:\s*(.+)$/)[1]
    phone = clean(inline || (lines[phoneIdx + 1] ?? ''))
  }
  if (!phone) {
    const allPhones = textNoUrls.match(new RegExp(PHONE_RE.source, 'g')) ?? []
    phone = clean(allPhones.find((p) => {
      const digits = p.replace(/\D/g, '')
      return digits.length >= 10 && digits.length <= 13
    }) ?? '')
  }

  // Address block: prefer Shipping Address, fall back to Billing Address.
  // Supports "Shipping address" / "Shipping address:" / "Shipping:" label forms.
  const parseAddr = (startRe: RegExp): OrderEmailData['shipping'] => {
    const start = lower.findIndex((l) => startRe.test(l))
    if (start < 0) return null
    const fields: { name?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; country?: string; phone?: string } = {}
    const raw: string[] = []
    let zip = ''
    // Inline value on the label line itself ("Shipping: 48 Lake View Road")
    const labelLine = lines[start]
    if (labelLine.includes(':')) {
      const inlineVal = clean(labelLine.split(/:(.+)$/)[1] ?? '')
      if (inlineVal) raw.push(inlineVal)
    }
    let k = start + 1
    while (k < lines.length && k < start + 14) {
      const l = lines[k]
      const ll = lower[k]
      if (/^(billing address|shipping address|customer|payment method|payment|gateway|note|items?|email|phone).*$/.test(ll) && !PHONE_RE.test(l)) break
      if (EMAIL_RE.test(l)) break
      // Shopify mail footer — never part of the customer's address
      if (/^shopify$/i.test(l) || /ottawa/i.test(l)) break
      if (PHONE_RE.test(l) && !fields.phone) {
        fields.phone = clean(l.replace(/^phone\s*:\s*/i, ''))
        k++
        continue
      }
      const zipM = l.match(/^(\d{5,6})\b/)
      if (zipM) {
        zip = zipM[1]
        k++
        continue
      }
      // Compressed single-line form: "Thane, Maharashtra 400607" (city, province+zip)
      const tailZip = l.match(/,\s*([A-Za-z\s.]+?)\s+(\d{5,6})\s*$/)
      if (tailZip) {
        raw.push(l.replace(/,\s*[A-Za-z\s.]+?\s+\d{5,6}\s*$/, ''))
        raw.push(tailZip[1])
        zip = tailZip[2]
        k++
        continue
      }
      raw.push(l.replace(/,+$/, ''))
      k++
    }
    if (zip) {
      // Shopify's canonical layout: name, street…, city, province, <zip>, country.
      // A wordy line after the zip is the country.
      if (raw.length > 0 && /^[A-Za-z\s.'-]+$/.test(raw[raw.length - 1])) {
        fields.country = raw.pop()!
      }
      const before = raw
      if (before.length >= 4) {
        fields.name = before[0]
        fields.address1 = before[1]
        const mid = before.slice(2, before.length - 2)
        if (mid.length) fields.address2 = mid.join(', ')
        fields.city = before[before.length - 2]
        fields.province = before[before.length - 1]
      } else if (before.length === 3) {
        fields.name = before[0]
        fields.address1 = before[1]
        fields.city = before[2]
      } else if (before.length === 2) {
        fields.name = before[0]
        fields.city = before[1]
      } else if (before.length === 1) {
        fields.name = before[0]
      }
      fields.zip = zip
    } else {
      if (raw.length > 0) fields.name = raw.shift()
      if (raw.length > 0) fields.address1 = raw.shift()
      if (raw.length > 0) fields.address2 = raw.join(', ')
    }
    return Object.values(fields).some(Boolean) ? fields : null
  }

  const shipping = parseAddr(/^shipping address/i) ?? parseAddr(/^shipping:/i) ?? parseAddr(/^billing address/i) ?? parseAddr(/^billing:/i)
  let billing = parseAddr(/^billing address/i) ?? parseAddr(/^billing:/i) ?? shipping
  // "Billing address\nSame as shipping address" — resolve to the real shipping block
  if (billing && shipping && !billing.address1 && !billing.phone && !billing.address2 && /same as shipping/i.test(billing.name ?? '')) {
    billing = shipping
  }

  // Items table (plain text): "1 × Silver Bangles 925 ₹3,200.00" variants
  const items: OrderEmailData['items'] = []
  const itemRe = /^\s*(\d+)\s*[×x]\s*(.+?)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*$/
  // Shopify staff-email format: title line, then "Rs. 2,499.00 × 1"
  const qtyAfterRe = /^\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*×\s*(\d+)\s*$/
  const seenItems = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = l.match(itemRe)
    if (m) {
      const key = `${m[2]}|${m[1]}|${m[3]}`
      if (seenItems.has(key)) continue
      seenItems.add(key)
      items.push({
        title: clean(m[2]),
        sku: '',
        quantity: Math.max(0, parseInt(m[1], 10) || 0),
        price: Math.round(Number(m[3].replace(/,/g, '')) * 100) / 100,
      })
      continue
    }
    const q = l.match(qtyAfterRe)
    if (q && i > 0) {
      // mailparser's text conversion can split the price across lines
      // ("Rs." alone, then "1,299.00 × 1"), so walk back over currency-only
      // and bare-amount lines to find the real item title.
      const parts: string[] = []
      let j = i - 1
      while (j >= 0 && parts.length < 3) {
        const prev = lines[j]
        if (!prev) break
        if (/^(subtotal|shipping|total|tax|order summary|contact information|payment method|customer|email|phone)\b/i.test(prev)) break
        if (/^(?:₹|Rs\.?|INR)$/i.test(prev)) { j--; continue } // currency prefix — belongs to the price, not the title
        if (/^[\d,]+(?:\.\d+)?$/.test(prev)) { j--; continue } // bare amount wrapped onto its own line
        if (/^SKU:/i.test(prev)) break
        if (/^[\d₹]/.test(prev)) break
        parts.unshift(prev)
        break
      }
      const title = clean(parts.join(' '))
      if (!title) continue
      const key = `${title}|${q[2]}|${q[1]}`
      if (seenItems.has(key)) continue
      seenItems.add(key)
      const item = {
        title,
        sku: '',
        quantity: Math.max(0, parseInt(q[2], 10) || 0),
        price: Math.round(Number(q[1].replace(/,/g, '')) * 100) / 100,
      }
      // Attach SKU if it appears just below the price line
      for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++) {
        const sk = lines[k].match(/^SKU:\s*(.+)$/i)
        if (sk) { item.sku = clean(sk[1]); break }
        if (lines[k] && !/^Rs/.test(lines[k])) break
      }
      items.push(item)
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

  // Payment method: line after "Payment method" label (or inline after colon)
  let paymentMethod = ''
  const payIdx = lower.findIndex((l) => /^(payment method|payment processing method|payment|gateway):?\s*$/.test(l))
  if (payIdx >= 0) {
    const inline = lines[payIdx].split(/:\s*(.+)$/)[1]
    paymentMethod = clean(inline || (lines[payIdx + 1] ?? ''))
  }

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
  let result: OrderEmailData | null = null
  if (mail.text) {
    result = parseOrderEmailText(mail.text, subject)
  }
  if (!result && mail.html) {
    const html = typeof mail.html === 'string' ? mail.html : false
    if (html) {
      // Shopify staff notifications end with a footer (class="no-print")
      // carrying Shopify's own Ottawa address — cut everything after it so it
      // can never leak into a parsed address block.
      const cut = html.search(/class="no-print"|<footer/i)
      const body = cut >= 0 ? html.slice(0, cut) : html
      const text = body
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|td|th|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#8377;|&rsquo;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
      result = parseOrderEmailText(text, subject)
    }
  }
  // Prefer the email's own date over parse time
  if (result && mail.date) {
    const d = new Date(mail.date)
    if (!Number.isNaN(d.getTime())) result.date = d.toISOString()
  }
  return result
}

// ─── DB merge ───────────────────────────────────────────────────────

function normalizePayment(raw: string): string {
  const v = raw.toLowerCase()
  if (/cod|cash/.test(v)) return 'cod'
  if (/online|upi|card|razorpay|payu|paytm/.test(v)) return 'online'
  if (/bank|neft|imps|rtgs/.test(v)) return 'bank'
  return 'paid'
}

/**
 * Ensure a customer record exists for the parsed order data.
 * Identity keys only (email/phone) — never name — so distinct customers with
 * the same name are not merged. Stats are derived afterwards via recount.
 */
async function ensureCustomerFromEmail(d: OrderEmailData): Promise<void> {
  if (!db) return
  const email = d.email || null
  const phone = d.phone || null
  if (!email && !phone) return
  const identityConditions = []
  if (email) identityConditions.push(eq(schema.customers.email, email))
  if (phone) identityConditions.push(eq(schema.customers.phone, phone))
  const [existing] = await db.select().from(schema.customers).where(or(...identityConditions)).limit(1)
  const city = d.billing?.city || d.shipping?.city || null
  if (existing) {
    await db
      .update(schema.customers)
      .set({
        name: d.customerName && d.customerName !== 'Guest' ? d.customerName : undefined,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(city ? { city } : {}),
      })
      .where(eq(schema.customers.id, existing.id))
    return
  }
  await db
    .insert(schema.customers)
    .values({
      id: `email-cust-${d.orderNumber}-${Date.now()}`,
      name: d.customerName || 'Guest',
      email,
      phone,
      city,
      orders: 0,
      totalSpent: 0,
      status: 'active',
      joined: new Date().toISOString().slice(0, 10),
    })
    .onConflictDoNothing()
}

/** Merge parsed email data into sales_orders, creating the order if missing. */
export async function mergeOrderData(d: OrderEmailData): Promise<{ updated: boolean; created: boolean }> {
  if (!db) throw new Error('Database is not configured')
  const shopifyId = `#${d.orderNumber}`
  const billingAddress = d.billing ?? undefined
  const shippingAddress = d.shipping ?? undefined

  const [existing] = await db
    .select({ id: schema.salesOrders.id, customer: schema.salesOrders.customer, billingAddress: schema.salesOrders.billingAddress, lineItems: schema.salesOrders.lineItems })
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
    // Union line items across emails — the same order arrives via both the
    // staff notification and the customer confirmation, often with different
    // subsets parsed; never lose an already-parsed item.
    const prevItems = Array.isArray(existing.lineItems) ? (existing.lineItems as OrderEmailData['items']) : []
    const mergedItems = [...prevItems]
    for (const it of d.items) {
      const key = `${it.title}|${it.quantity}|${it.price}`
      if (!mergedItems.some((p) => `${p.title}|${p.quantity}|${p.price}` === key)) mergedItems.push(it)
    }
    const newLineItems = mergedItems.length > prevItems.length ? mergedItems : undefined
    const newItems = newLineItems ? mergedItems.reduce((s, i) => s + i.quantity, 0) : undefined
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
    await ensureCustomerFromEmail(d)
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
  await ensureCustomerFromEmail(d)
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
  if (emailProvider() === 'mailtm') {
    try {
      await pollMailtm(cfg, res)
      res.ok = true
      logger.info({ scanned: res.scanned, parsed: res.parsed, updated: res.updated, created: res.created }, 'Order email ingestion complete (mail.tm)')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown mail.tm error'
      res.errors.push(message)
      logger.error({ err: message }, 'Order email ingestion failed')
    } finally {
      running = false
    }
    return res
  }
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
        // Shopify's "send test notification" button uses fake order #9999 — skip
        // only that. Real orders in test mode carry [Testing] and MUST sync.
        if (/\[testing\]/i.test(subject) && /#9999\b/.test(subject)) continue
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

// ─── Instant sync: IMAP IDLE push + webhook kicks ───────────────────

let idleClient: ImapFlow | null = null
let idleStopped = false
let idleReconnectTimer: ReturnType<typeof setTimeout> | null = null

function scheduleIdleReconnect(): void {
  if (idleStopped || idleReconnectTimer) return
  idleReconnectTimer = setTimeout(() => {
    idleReconnectTimer = null
    startImapIdle().catch(() => {})
  }, 10_000)
}

/**
 * Persistent IMAP connection using IDLE (push). Gmail fires an `exists` event
 * the moment a new email lands, so order notifications are processed within
 * seconds instead of waiting for the next interval poll.
 */
async function startImapIdle(): Promise<void> {
  if (idleStopped || idleClient) return
  if (emailProvider() !== 'imap' || !isEmailIngestConfigured()) return
  const cfg = emailConfig()
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    emitLogs: false,
  })
  idleClient = client
  client.on('exists', () => {
    logger.info('IMAP IDLE: new email detected — syncing order data now')
    // Short delay so the message is fully delivered; second sweep as insurance.
    setTimeout(() => { pollOrderMailbox().catch(() => {}) }, 2_000)
    setTimeout(() => { pollOrderMailbox().catch(() => {}) }, 30_000)
  })
  client.on('error', (err) => {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'IMAP IDLE connection error')
  })
  client.on('close', () => {
    if (idleClient === client) idleClient = null
    scheduleIdleReconnect()
  })
  try {
    await client.connect()
    await client.mailboxOpen(cfg.folder)
    logger.info({ host: cfg.host, mailbox: cfg.folder }, 'IMAP IDLE listener connected — new order emails sync instantly')
  } catch (err) {
    if (idleClient === client) idleClient = null
    scheduleIdleReconnect()
    throw err
  }
}

/**
 * Trigger immediate mailbox polls (no-op when not configured). Used by the
 * Shopify order webhook: the webhook is the instant signal, the notification
 * email carries the full customer data — poll now and again shortly after
 * to cover email delivery lag.
 */
export function kickEmailIngest(): void {
  if (!isEmailIngestConfigured()) return
  setTimeout(() => { pollOrderMailbox().catch(() => {}) }, 1_000)
  setTimeout(() => { pollOrderMailbox().catch(() => {}) }, 30_000)
}

// ─── mail.tm REST provider (no IMAP needed) ───────────────────────

const MAILTM_API = 'https://api.mail.tm'

interface MailTmMessageSummary {
  id: string
  subject?: string
  from?: { address?: string; name?: string }
  createdAt?: string
}

interface MailTmMessageFull extends MailTmMessageSummary {
  text?: string
  html?: string[] | string
}

async function mailtmToken(user: string, pass: string): Promise<string> {
  const res = await fetch(`${MAILTM_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: user, password: pass }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`mail.tm auth failed (${res.status}) — check ORDER_EMAIL_ADDRESS / ORDER_EMAIL_PASSWORD`)
  const data = (await res.json()) as { token: string }
  return data.token
}

async function pollMailtm(cfg: { user: string; pass: string }, res: IngestResult): Promise<void> {
  const token = await mailtmToken(cfg.user, cfg.pass)
  const headers = { Authorization: `Bearer ${token}` }
  const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  for (let page = 1; page <= 5; page++) {
    const listRes = await fetch(`${MAILTM_API}/messages?page=${page}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (!listRes.ok) throw new Error(`mail.tm list failed (${listRes.status})`)
    const list = (await listRes.json()) as { 'hydra:member'?: MailTmMessageSummary[] }
    const messages = list['hydra:member'] ?? []
    if (messages.length === 0) break

    for (const m of messages) {
      if (m.createdAt && new Date(m.createdAt).getTime() < since) continue
      res.scanned++
      const subject = clean(m.subject)
      if (!parseOrderNumberFromSubject(subject)) continue
      if (/refund|return|cancel|cxl|shipping|fulfill|delivery/i.test(subject)) continue
      // Shopify's "send test notification" button uses fake order #9999 — skip
      // only that. Real orders in test mode carry [Testing] and MUST sync.
      if (/\[testing\]/i.test(subject) && /#9999\b/.test(subject)) continue
      try {
        const fullRes = await fetch(`${MAILTM_API}/messages/${m.id}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        })
        if (!fullRes.ok) continue
        const full = (await fullRes.json()) as MailTmMessageFull
        const html = Array.isArray(full.html) ? full.html.join('\n') : full.html
        // Reuse the same parser via a minimal ParsedMail-compatible object.
        const mailLike = { subject, text: full.text ?? '', html: html ?? false } as unknown as Parameters<typeof parseOrderEmail>[0]
        const data = parseOrderEmail(mailLike)
        if (!data) continue
        res.parsed++
        const merged = await mergeOrderData(data)
        if (merged.updated) res.updated++
        if (merged.created) res.created++
      } catch (err) {
        res.errors.push(err instanceof Error ? err.message : 'mail.tm fetch error')
      }
    }
  }
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
  // Instant sync: persistent IDLE connection pushes new-email events immediately
  if (emailProvider() === 'imap') {
    setTimeout(() => {
      startImapIdle().catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'IMAP IDLE listener failed to start — falling back to interval polling')
      })
    }, 20_000)
  }
  logger.info(
    { intervalMinutes: POLL_INTERVAL_MS / 60000, provider: emailProvider(), instant: emailProvider() === 'imap' },
    'Order email ingestion scheduler started',
  )
}

export function stopOrderEmailIngest(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  idleStopped = true
  if (idleReconnectTimer) {
    clearTimeout(idleReconnectTimer)
    idleReconnectTimer = null
  }
  if (idleClient) {
    const c = idleClient
    idleClient = null
    c.close()
  }
}
