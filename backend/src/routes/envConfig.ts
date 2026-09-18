import { Router, type Request, type Response, type Express } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireAuth } from '../sessions'
import { requirePermission } from '../rbac'
import { upsertEnvVar } from '../lib/envfile'
import { encryptSecret } from '../lib/crypto'
import { logger } from '../logger'

/**
 * Env-backed configuration API — lets admins view and change every
 * deployment-configurable setting from the UI, without editing .env or code.
 *
 * GET  /api/v1/env-config          → all known keys, secrets masked (••••last4)
 * POST /api/v1/env-config          → { values: { KEY: value } } writes to .env,
 *                                    encrypting values whose `secret` flag is set.
 *
 * Secrets are stored encrypted (encV1:…) exactly like the connection settings,
 * and re-saving with the masked placeholder is a no-op so forms can always
 * submit the whole payload.
 */

interface EnvVarDef {
  key: string
  /** Group shown in the UI */
  group: 'shopify' | 'email' | 'notifications' | 'payments' | 'whatsapp' | 'backup' | 'server'
  label: string
  /** Value is a secret → stored encrypted in .env, masked in responses */
  secret?: boolean
  placeholder?: string
  hint?: string
}

export const ENV_CONFIG_DEFS: EnvVarDef[] = [
  // ── Shopify ──
  { key: 'SHOPIFY_STORE_URL', group: 'shopify', label: 'Store domain', placeholder: 'your-store.myshopify.com', hint: 'Overridden by Settings → Connections when set there' },
  { key: 'SHOPIFY_ACCESS_TOKEN', group: 'shopify', label: 'Admin API access token', secret: true, placeholder: 'shpat_…' },
  { key: 'SHOPIFY_API_VERSION', group: 'shopify', label: 'API version', placeholder: '2025-10' },
  { key: 'PUBLIC_BASE_URL', group: 'shopify', label: 'Public base URL', placeholder: 'https://your-tunnel.loca.lt', hint: 'Used for webhook registration' },

  // ── Order email ingest ──
  { key: 'ORDER_EMAIL_ADDRESS', group: 'email', label: 'Order ingest mailbox', placeholder: 'orders@yourdomain.com' },
  { key: 'ORDER_EMAIL_PASSWORD', group: 'email', label: 'Mailbox app password', secret: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
  { key: 'ORDER_EMAIL_HOST', group: 'email', label: 'IMAP host', placeholder: 'imap.gmail.com' },
  { key: 'ORDER_EMAIL_PORT', group: 'email', label: 'IMAP port', placeholder: '993' },
  { key: 'ORDER_EMAIL_FOLDER', group: 'email', label: 'IMAP folder', placeholder: 'INBOX' },
  { key: 'ORDER_EMAIL_PROVIDER', group: 'email', label: 'Provider', placeholder: 'imap | mailtm' },

  // ── Notifications (email/SMTP) ──
  { key: 'RESEND_API_KEY', group: 'notifications', label: 'Resend API key', secret: true, placeholder: 're_…', hint: 'Optional — falls back to Gmail SMTP' },
  { key: 'NOTIFICATION_EMAIL', group: 'notifications', label: 'Default notification recipient', placeholder: 'owner@yourdomain.com' },
  { key: 'NOTIFICATION_SMTP_HOST', group: 'notifications', label: 'SMTP host override', placeholder: 'smtp.gmail.com' },
  { key: 'NOTIFICATION_SMTP_PORT', group: 'notifications', label: 'SMTP port override', placeholder: '465' },
  { key: 'EMAIL_FROM', group: 'notifications', label: 'From address', placeholder: 'Opal Line <no-reply@yourdomain.com>' },

  // ── Payments ──
  { key: 'RAZORPAY_KEY_ID', group: 'payments', label: 'Razorpay key ID', placeholder: 'rzp_live_…' },
  { key: 'RAZORPAY_KEY_SECRET', group: 'payments', label: 'Razorpay key secret', secret: true, placeholder: '…' },

  // ── WhatsApp ──
  { key: 'WHATSAPP_ACCESS_TOKEN', group: 'whatsapp', label: 'Access token', secret: true, placeholder: 'EAAG…' },
  { key: 'WHATSAPP_PHONE_NUMBER_ID', group: 'whatsapp', label: 'Phone number ID', placeholder: '123456789012345' },

  // ── Backup / off-site ──
  { key: 'BACKUP_OFFSITE_ENDPOINT', group: 'backup', label: 'S3 endpoint', placeholder: 'https://<accountid>.r2.cloudflarestorage.com' },
  { key: 'BACKUP_OFFSITE_BUCKET', group: 'backup', label: 'Bucket', placeholder: 'opal-line-backups' },
  { key: 'BACKUP_OFFSITE_KEY_ID', group: 'backup', label: 'Access key ID', secret: true, placeholder: '…' },
  { key: 'BACKUP_OFFSITE_SECRET', group: 'backup', label: 'Secret access key', secret: true, placeholder: '…' },
  { key: 'BACKUP_OFFSITE_PREFIX', group: 'backup', label: 'Key prefix', placeholder: 'opal-line-backups' },
  { key: 'BACKUP_OFFSITE_REGION', group: 'backup', label: 'Region', placeholder: 'auto' },
]

const ENV_PATH = join(process.cwd(), '.env')

function readRawEnv(): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(ENV_PATH)) return map
  for (const line of readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) map.set(m[1], m[2])
  }
  return map
}

function maskValue(v: string): string {
  if (!v) return ''
  if (v.startsWith('encV1:')) return '••••••••'
  return v.length <= 4 ? '••••' : '••••' + v.slice(-4)
}

export function registerEnvConfigRoutes(app: Express) {
  const envConfigRouter = Router()

  envConfigRouter.get('/', requirePermission('system', 'view'), (_req: Request, res: Response) => {
    const raw = readRawEnv()
    const values: Record<string, string> = {}
    const configured: Record<string, boolean> = {}
    for (const def of ENV_CONFIG_DEFS) {
      const rawVal = raw.get(def.key) ?? process.env[def.key] ?? ''
      // Secrets that are already encrypted in .env → show mask; plaintext env → mask too
      values[def.key] = def.secret ? (rawVal ? maskValue(rawVal) : '') : rawVal
      configured[def.key] = rawVal.trim().length > 0
    }
    res.json({ defs: ENV_CONFIG_DEFS, values, configured })
  })

  envConfigRouter.post('/', requirePermission('system', 'edit'), async (req: Request, res: Response) => {
    try {
      const values = (req.body?.values ?? {}) as Record<string, string>
      const updated: string[] = []
      const skipped: string[] = []
      for (const def of ENV_CONFIG_DEFS) {
        if (!(def.key in values)) continue
        let value = String(values[def.key] ?? '').trim()
        // Masked placeholder resubmitted → leave as-is
        if (/^•+$/.test(value) || value === '••••••••') { skipped.push(def.key); continue }
        if (def.secret && value) value = encryptSecret(value)
        if (def.key === 'PUBLIC_BASE_URL' && value) {
          value = value.replace(/\/+$/, '')
          if (!/^https:\/\/.+/.test(value)) {
            res.status(400).json({ error: 'PUBLIC_BASE_URL must be an https:// URL' })
            return
          }
        }
        upsertEnvVar(def.key, value)
        process.env[def.key] = value
        updated.push(def.key)
      }
      logger.info({ updated }, 'env config updated from UI')
      res.json({ ok: true, updated, skipped })
    } catch (err) {
      logger.error({ err }, 'env config update failed')
      res.status(500).json({ error: 'Failed to save configuration' })
    }
  })

  app.use('/api/v1/env-config', requireAuth, envConfigRouter)
}
