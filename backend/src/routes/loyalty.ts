import { Router, type Request, type Response } from 'express'
import type { Express } from 'express'
import { requireAuth } from '../sessions'
import { requirePermission } from '../rbac'
import { db } from '../db/client'
import * as s from '../db/schema'
import { eq } from 'drizzle-orm'
import * as loyalty from '../loyalty'
import { logger } from '../logger'

/**
 * Loyalty points API:
 *   GET  /api/v1/loyalty/balance?customer=<name|phone>  → balance + customer
 *   GET  /api/v1/loyalty/history?customer=<name|phone>  → ledger entries
 *   POST /api/v1/loyalty/redeem    { customer, points, invoiceId?, invoiceNumber? }
 *   POST /api/v1/loyalty/adjust    { customer, points, note }  (admin)
 */

export function registerLoyaltyRoutes(app: Express) {
  const router = Router()

  router.get('/balance', requireAuth, requirePermission('sales', 'view'), async (req: Request, res: Response) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const query = String(req.query.customer ?? '').trim()
      if (!query) { res.status(400).json({ error: 'customer query param required' }); return }
      const customer = await loyalty.findCustomer(query)
      if (!customer) { res.json({ found: false }) ; return }
      const balance = await loyalty.getBalance(customer.id)
      res.json({ found: true, customer, balance, pointValue: loyalty.POINT_VALUE, enabled: loyalty.isLoyaltyEnabled() })
    } catch (err) {
      logger.error({ err }, 'loyalty balance failed')
      res.status(500).json({ error: 'Failed to fetch balance' })
    }
  })

  router.get('/history', requireAuth, requirePermission('sales', 'view'), async (req: Request, res: Response) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const query = String(req.query.customer ?? '').trim()
      if (!query) { res.status(400).json({ error: 'customer query param required' }); return }
      const customer = await loyalty.findCustomer(query)
      if (!customer) { res.json({ found: false, entries: [] }); return }
      const entries = await loyalty.history(customer.id)
      res.json({ found: true, customer, entries })
    } catch (err) {
      logger.error({ err }, 'loyalty history failed')
      res.status(500).json({ error: 'Failed to fetch history' })
    }
  })

  router.post('/redeem', requireAuth, requirePermission('sales', 'edit'), async (req: Request, res: Response) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const { customer, points, invoiceId, invoiceNumber } = req.body ?? {}
      const found = await loyalty.findCustomer(String(customer ?? ''))
      if (!found) { res.status(404).json({ error: 'Customer not found' }); return }
      const result = await loyalty.redeem(found.id, Number(points) || 0, {
        invoiceId: invoiceId ? String(invoiceId) : undefined,
        invoiceNumber: invoiceNumber ? String(invoiceNumber) : undefined,
      })
      if (!result.ok) { res.status(400).json({ error: result.error }); return }
      logger.info({ customer: found.name, points }, 'loyalty points redeemed')
      res.json({ ok: true, balanceAfter: result.balanceAfter })
    } catch (err) {
      logger.error({ err }, 'loyalty redeem failed')
      res.status(500).json({ error: 'Failed to redeem points' })
    }
  })

  router.post('/adjust', requireAuth, requirePermission('system', 'edit'), async (req: Request, res: Response) => {
    if (!db) { res.status(503).json({ error: 'Database unavailable' }); return }
    try {
      const { customer, points, note } = req.body ?? {}
      const found = await loyalty.findCustomer(String(customer ?? ''))
      if (!found) { res.status(404).json({ error: 'Customer not found' }); return }
      const result = await loyalty.adjust(found.id, Number(points) || 0, String(note ?? 'Manual adjustment'))
      logger.info({ customer: found.name, points: result.points }, 'loyalty points adjusted')
      res.json({ ok: true, ...result })
    } catch (err) {
      logger.error({ err }, 'loyalty adjust failed')
      res.status(500).json({ error: 'Failed to adjust points' })
    }
  })

  app.use('/api/v1/loyalty', router)
}
