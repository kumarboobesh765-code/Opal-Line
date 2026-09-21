import { Router, type Request, type Response } from 'express'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts, journalEntries, journalEntryLines, salesInvoices } from '../db/schema'
import { requireAuth } from '../sessions'
import { requirePermission } from '../rbac'
import { randomBytes } from 'node:crypto'
import { logger } from '../logger'

const router = Router()

// GET /api/v1/accounts — list all accounts
router.get('/', requireAuth, requirePermission('accounts', 'view'), async (_req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const rows = await db.select().from(accounts).orderBy(accounts.code)
    res.json(rows)
  } catch (err) {
    logger.error({ err }, 'Failed to list accounts')
    res.status(500).json({ error: 'Failed to fetch accounts' })
  }
})

// POST /api/v1/accounts — create account
router.post('/', requireAuth, requirePermission('accounts', 'edit'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { code, name, type, subType, parentId, isGroup, openingBalance, currency, branchId } = req.body ?? {}
    if (!code || !name || !type) {
      res.status(400).json({ error: 'code, name, and type are required' }); return
    }
    const id = `ACC-${randomBytes(6).toString('hex')}`
    const [row] = await db.insert(accounts).values({
      id,
      code: String(code).trim(),
      name: String(name).trim(),
      type: String(type),
      subType: subType ? String(subType) : null,
      parentId: parentId ? String(parentId) : null,
      isGroup: Boolean(isGroup),
      openingBalance: Number(openingBalance) || 0,
      currentBalance: Number(openingBalance) || 0,
      currency: currency ? String(currency) : 'INR',
      branchId: branchId ? String(branchId) : null,
      isActive: true,
      createdAt: new Date().toISOString(),
    }).returning()
    res.status(201).json(row)
  } catch (err) {
    logger.error({ err }, 'Failed to create account')
    res.status(500).json({ error: 'Failed to create account' })
  }
})

// PATCH /api/v1/accounts/:id — update account
router.patch('/:id', requireAuth, requirePermission('accounts', 'edit'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { id } = req.params
    const updates: Record<string, unknown> = {}
    const { name, type, subType, parentId, isGroup, isActive, branchId } = req.body ?? {}
    if (name !== undefined) updates.name = String(name).trim()
    if (type !== undefined) updates.type = String(type)
    if (subType !== undefined) updates.subType = String(subType)
    if (parentId !== undefined) updates.parentId = String(parentId)
    if (isGroup !== undefined) updates.isGroup = Boolean(isGroup)
    if (isActive !== undefined) updates.isActive = Boolean(isActive)
    if (branchId !== undefined) updates.branchId = String(branchId)
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' }); return
    }
    const [row] = await db.update(accounts).set(updates).where(eq(accounts.id, id)).returning()
    if (!row) { res.status(404).json({ error: 'Account not found' }); return }
    res.json(row)
  } catch (err) {
    logger.error({ err }, 'Failed to update account')
    res.status(500).json({ error: 'Failed to update account' })
  }
})

// GET /api/v1/accounts/journal-entries — list with filters
router.get('/journal-entries', requireAuth, requirePermission('accounts', 'view'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { dateFrom, dateTo, referenceType } = req.query as Record<string, string | undefined>
    const conditions = []
    if (dateFrom) conditions.push(gte(journalEntries.date, dateFrom))
    if (dateTo) conditions.push(lte(journalEntries.date, dateTo))
    if (referenceType) conditions.push(eq(journalEntries.referenceType, referenceType))
    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await db.select().from(journalEntries).where(where).orderBy(desc(journalEntries.date))
    res.json(rows)
  } catch (err) {
    logger.error({ err }, 'Failed to list journal entries')
    res.status(500).json({ error: 'Failed to fetch journal entries' })
  }
})

// POST /api/v1/accounts/journal-entries — create manual journal entry
router.post('/journal-entries', requireAuth, requirePermission('accounts', 'edit'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { date, description, reference, referenceType, referenceId, lines } = req.body ?? {}
    if (!date || !Array.isArray(lines) || lines.length < 2) {
      res.status(400).json({ error: 'date and at least 2 lines are required' }); return
    }
    let totalDebit = 0
    let totalCredit = 0
    for (const line of lines) {
      totalDebit += Number(line.debit) || 0
      totalCredit += Number(line.credit) || 0
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      res.status(400).json({ error: `Debits (${totalDebit}) must equal credits (${totalCredit})` }); return
    }

    const entryId = `JE-${randomBytes(6).toString('hex')}`
    const entryNumber = `JE-${Date.now()}`
    await db.insert(journalEntries).values({
      id: entryId,
      entryNumber,
      date,
      description: description ? String(description) : null,
      reference: reference ? String(reference) : null,
      referenceType: referenceType ? String(referenceType) : 'manual',
      referenceId: referenceId ? String(referenceId) : null,
      isAuto: false,
      branchId: null,
      createdBy: req.userId ?? null,
      createdAt: new Date().toISOString(),
    })

    for (const line of lines) {
      await db.insert(journalEntryLines).values({
        id: `JEL-${randomBytes(6).toString('hex')}`,
        journalEntryId: entryId,
        accountId: String(line.accountId),
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        description: line.description ? String(line.description) : null,
        branchId: line.branchId ? String(line.branchId) : null,
      })
    }

    res.status(201).json({ id: entryId, entryNumber })
  } catch (err) {
    logger.error({ err }, 'Failed to create journal entry')
    res.status(500).json({ error: 'Failed to create journal entry' })
  }
})

// GET /api/v1/accounts/trial-balance
router.get('/trial-balance', requireAuth, requirePermission('accounts', 'view'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>
    const conditions = []
    if (dateFrom) conditions.push(gte(journalEntries.date, dateFrom))
    if (dateTo) conditions.push(lte(journalEntries.date, dateTo))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountType: accounts.type,
        totalDebit: sql<number>`COALESCE(SUM(${journalEntryLines.debit}), 0)`.as('total_debit'),
        totalCredit: sql<number>`COALESCE(SUM(${journalEntryLines.credit}), 0)`.as('total_credit'),
      })
      .from(accounts)
      .leftJoin(journalEntryLines, eq(journalEntryLines.accountId, accounts.id))
      .leftJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .where(where)
      .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
      .orderBy(accounts.code)

    const balanceSheet = rows.map((r) => ({
      ...r,
      balance: Number(r.totalDebit) - Number(r.totalCredit),
    }))

    const totalDebit = balanceSheet.reduce((s, r) => s + Number(r.totalDebit), 0)
    const totalCredit = balanceSheet.reduce((s, r) => s + Number(r.totalCredit), 0)

    res.json({ accounts: balanceSheet, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 })
  } catch (err) {
    logger.error({ err }, 'Failed to generate trial balance')
    res.status(500).json({ error: 'Failed to generate trial balance' })
  }
})

// GET /api/v1/accounts/profit-and-loss
router.get('/profit-and-loss', requireAuth, requirePermission('accounts', 'view'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>
    const conditions = []
    if (dateFrom) conditions.push(gte(journalEntries.date, dateFrom))
    if (dateTo) conditions.push(lte(journalEntries.date, dateTo))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountType: accounts.type,
        totalDebit: sql<number>`COALESCE(SUM(${journalEntryLines.debit}), 0)`.as('total_debit'),
        totalCredit: sql<number>`COALESCE(SUM(${journalEntryLines.credit}), 0)`.as('total_credit'),
      })
      .from(accounts)
      .leftJoin(journalEntryLines, eq(journalEntryLines.accountId, accounts.id))
      .leftJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .where(where)
      .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
      .orderBy(accounts.code)

    const revenue = rows
      .filter((r) => r.accountType === 'revenue')
      .map((r) => ({ ...r, amount: Number(r.totalCredit) - Number(r.totalDebit) }))
    const expenses = rows
      .filter((r) => r.accountType === 'expense')
      .map((r) => ({ ...r, amount: Number(r.totalDebit) - Number(r.totalCredit) }))

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0)
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0)
    const netProfit = totalRevenue - totalExpenses

    res.json({ revenue, expenses, totalRevenue, totalExpenses, netProfit })
  } catch (err) {
    logger.error({ err }, 'Failed to generate P&L')
    res.status(500).json({ error: 'Failed to generate profit and loss statement' })
  }
})

// GET /api/v1/accounts/balance-sheet
router.get('/balance-sheet', requireAuth, requirePermission('accounts', 'view'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const rows = await db
      .select({
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountType: accounts.type,
        totalDebit: sql<number>`COALESCE(SUM(${journalEntryLines.debit}), 0)`.as('total_debit'),
        totalCredit: sql<number>`COALESCE(SUM(${journalEntryLines.credit}), 0)`.as('total_credit'),
      })
      .from(accounts)
      .leftJoin(journalEntryLines, eq(journalEntryLines.accountId, accounts.id))
      .leftJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
      .orderBy(accounts.code)

    const assets = rows
      .filter((r) => r.accountType === 'asset')
      .map((r) => ({ ...r, balance: Number(r.totalDebit) - Number(r.totalCredit) }))
    const liabilities = rows
      .filter((r) => r.accountType === 'liability')
      .map((r) => ({ ...r, balance: Number(r.totalCredit) - Number(r.totalDebit) }))
    const equity = rows
      .filter((r) => r.accountType === 'equity')
      .map((r) => ({ ...r, balance: Number(r.totalCredit) - Number(r.totalDebit) }))

    const totalAssets = assets.reduce((s, r) => s + r.balance, 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0)
    const totalEquity = equity.reduce((s, r) => s + r.balance, 0)

    res.json({ assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity })
  } catch (err) {
    logger.error({ err }, 'Failed to generate balance sheet')
    res.status(500).json({ error: 'Failed to generate balance sheet' })
  }
})

// POST /api/v1/accounts/journal-entries/post/:id — auto-generate journal entry for an invoice
router.post('/journal-entries/post/:id', requireAuth, requirePermission('accounts', 'edit'), async (req: Request, res: Response) => {
  if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
  try {
    const invoiceId = req.params.id
    const [invoice] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, invoiceId)).limit(1)
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return }

    const existing = await db.select().from(journalEntries).where(
      and(eq(journalEntries.referenceType, 'invoice'), eq(journalEntries.referenceId, invoiceId))
    ).limit(1)
    if (existing.length > 0) {
      res.status(409).json({ error: 'Journal entry already posted for this invoice', entryNumber: existing[0].entryNumber }); return
    }

    const grandTotal = Number(invoice.grandTotal) || 0
    const gstAmount = Number(invoice.gstAmount) || 0
    const tdsAmount = Number(invoice.tdsAmount) || 0
    const netReceivable = grandTotal - tdsAmount
    const taxableAmount = grandTotal - gstAmount

    const entryId = `JE-${randomBytes(6).toString('hex')}`
    const entryNumber = `JE-INV-${invoice.number}`

    await db.insert(journalEntries).values({
      id: entryId,
      entryNumber,
      date: typeof invoice.date === 'string' ? invoice.date : new Date().toISOString().split('T')[0],
      description: `Auto-posted for invoice ${invoice.number}`,
      reference: invoice.number,
      referenceType: 'invoice',
      referenceId: invoiceId,
      isAuto: true,
      branchId: null,
      createdBy: req.userId ?? null,
      createdAt: new Date().toISOString(),
    })

    const lines: { accountId: string; debit: number; credit: number; description: string }[] = [
      { accountId: 'ACC1003', debit: netReceivable, credit: 0, description: `Receivable for ${invoice.number}` },
      { accountId: 'ACC4001', debit: 0, credit: taxableAmount, description: `Sales for ${invoice.number}` },
    ]

    if (gstAmount > 0) {
      lines.push({ accountId: 'ACC2002', debit: 0, credit: gstAmount, description: `GST Output for ${invoice.number}` })
    }

    if (tdsAmount > 0) {
      lines.push({ accountId: 'ACC2003', debit: tdsAmount, credit: 0, description: `TDS deducted for ${invoice.number}` })
    }

    for (const line of lines) {
      await db.insert(journalEntryLines).values({
        id: `JEL-${randomBytes(6).toString('hex')}`,
        journalEntryId: entryId,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        branchId: null,
      })
    }

    res.status(201).json({ id: entryId, entryNumber, invoiceNumber: invoice.number })
  } catch (err) {
    logger.error({ err }, 'Failed to post invoice to journal')
    res.status(500).json({ error: 'Failed to post invoice to journal' })
  }
})

export default router
