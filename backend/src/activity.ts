import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Request } from 'express'
import { db, schema } from './db/client'

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  'silver-rate': 'Silver Rate',
  sales: 'Sales',
  purchase: 'Purchase',
  inventory: 'Inventory',
  accounts: 'Accounts',
  reports: 'Reports',
  shopify: 'Shopify',
  system: 'System',
}

export function moduleLabel(key: string): string {
  return MODULE_LABELS[key] ?? key
}

export interface Actor {
  userId: string | null
  ip: string | null
}

export function actorFromRequest(req: Request): Actor {
  const userId = req.userId ?? null
  const ip = req.ip ?? (req.socket ? req.socket.remoteAddress : null) ?? null
  return { userId, ip }
}

const userCache = new Map<string, { name: string; role: string | null; ts: number }>()
const USER_CACHE_MAX = 500
const USER_CACHE_TTL = 5 * 60 * 1000

async function resolveUser(userId: string | null): Promise<{ name: string; role: string | null }> {
  if (!userId) return { name: 'System', role: null }
  const cached = userCache.get(userId)
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) return cached
  if (cached) userCache.delete(userId)
  let entry: { name: string; role: string | null } = { name: userId, role: null }
  if (db) {
    try {
      const [row] = await db
        .select({ name: schema.users.name, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1)
      if (row) entry = { name: row.name || userId, role: row.role || null }
    } catch {
      // Fall through to the default entry.
    }
  }
  if (userCache.size >= USER_CACHE_MAX) {
    const firstKey = userCache.keys().next().value
    if (firstKey) userCache.delete(firstKey)
  }
  userCache.set(userId, { ...entry, ts: Date.now() })
  return entry
}

export interface ActivityEntry {
  action: string
  module: string
  entity?: string | null
  details?: string | null
  user?: string
  userId?: string | null
  role?: string | null
  ip?: string | null
}

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  if (!db) return
  try {
    const actor = await resolveUser(entry.userId ?? null)
    await db.insert(schema.activityLogs).values({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      user: entry.user ?? actor.name,
      userId: entry.userId ?? null,
      role: entry.role ?? actor.role,
      action: entry.action,
      module: moduleLabel(entry.module),
      entity: entry.entity ?? null,
      details: entry.details ?? null,
      ip: entry.ip ?? null,
    })
  } catch {
    // Activity logging must never break a business operation.
  }
}
