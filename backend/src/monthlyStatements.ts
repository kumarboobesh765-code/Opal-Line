import { sql } from 'drizzle-orm'
import { db } from './db/client'
import * as schema from './db/schema'
import { logger } from './logger'
import { generateCustomerStatementPDF } from './statements'
import { notifyCustomerStatement } from './notifications'

/**
 * Monthly customer statements: on the 1st of each month at 08:30 local time,
 * email every customer (that has an email) their account statement PDF.
 */
const DAY = 1
const HOUR = 8
const MINUTE = 30

let timer: NodeJS.Timeout | null = null

function msUntilNextRun(now = new Date()): number {
  const next = new Date(now)
  next.setDate(DAY)
  next.setHours(HOUR, MINUTE, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setMonth(next.getMonth() + 1)
    next.setDate(DAY)
  }
  return next.getTime() - now.getTime()
}

async function runMonthlyStatements(): Promise<void> {
  try {
    if (!db) return
    // customers with an email and at least one invoice
    const rows = await db
      .select({ customer: schema.salesInvoices.customer, email: schema.customers.email })
      .from(schema.salesInvoices)
      .innerJoin(schema.customers, sql`${schema.customers.name} = ${schema.salesInvoices.customer}`)
      .where(sql`${schema.customers.email} is not null and ${schema.customers.email} <> ''`)
      .groupBy(schema.salesInvoices.customer, schema.customers.email)

    let sent = 0
    let failed = 0
    for (const row of rows) {
      if (!row.customer || !row.email) continue
      try {
        const statement = await generateCustomerStatementPDF(row.customer)
        if (!statement) continue
        const ok = await notifyCustomerStatement(row.email, row.customer, statement)
        if (ok) sent += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
    logger.info({ customers: rows.length, sent, failed }, 'Monthly customer statements run complete')
  } catch (err) {
    logger.error({ err }, 'Monthly statements failed')
  }
}

function schedule(): void {
  timer = setTimeout(() => {
    schedule()
    void runMonthlyStatements()
  }, msUntilNextRun())
  timer.unref()
}

export function startMonthlyStatements(): void {
  if (timer) return
  schedule()
  logger.info({ next: new Date(Date.now() + msUntilNextRun()).toISOString() }, 'Monthly statements scheduler started (1st, 08:30)')
}

export function stopMonthlyStatements(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
