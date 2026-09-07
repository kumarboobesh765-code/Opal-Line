import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { logger } from './logger'
import { decryptSecret } from './lib/crypto'

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer
      shopifyWebhook?: {
        topic?: string
        shopDomain?: string
        webhookId?: string
      }
    }
  }
}

export function verifyShopifyWebhook(req: Request, res: Response, next: NextFunction): void {
  const secret = decryptSecret(process.env.SHOPIFY_WEBHOOK_SECRET)
  if (!secret) {
    res.status(500).json({ error: 'Webhook secret not configured' })
    return
  }

  const hmacHeader = req.headers['x-shopify-hmac-sha256']
  if (!hmacHeader || typeof hmacHeader !== 'string') {
    res.status(401).json({ error: 'Missing HMAC header' })
    return
  }

  const rawBody = req.rawBody
  if (!rawBody) {
    res.status(400).json({ error: 'Missing request body' })
    return
  }

  const body = rawBody.toString('utf-8')
  const generatedHmac = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64')

  let providedHmac: Buffer
  try {
    providedHmac = Buffer.from(hmacHeader, 'base64')
  } catch {
    res.status(400).json({ error: 'Invalid HMAC encoding' })
    return
  }

  if (providedHmac.length !== generatedHmac.length || !timingSafeEqual(providedHmac, Buffer.from(generatedHmac, 'base64'))) {
    res.status(401).json({ error: 'Invalid HMAC signature' })
    return
  }

  const topic = req.headers['x-shopify-topic']
  const shopDomain = req.headers['x-shopify-shop-domain']
  const webhookId = req.headers['x-shopify-webhook-id']

  req.shopifyWebhook = {
    topic: typeof topic === 'string' ? topic : undefined,
    shopDomain: typeof shopDomain === 'string' ? shopDomain : undefined,
    webhookId: typeof webhookId === 'string' ? webhookId : undefined,
  }

  next()
}