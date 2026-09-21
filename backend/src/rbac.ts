import { eq } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { db, schema } from './db/client'
import type { ModulePermission, Permissions, RbacModule, UserPermissions } from './types'
import { logger } from './logger'

export const MODULES: RbacModule[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Home dashboard and KPIs' },
  { key: 'silver-rate', label: 'Silver Rate', description: 'View and update silver rate' },
  { key: 'sales', label: 'Sales', description: 'Invoices, orders, customers and returns' },
  { key: 'purchase', label: 'Purchase', description: 'Purchase orders, invoices, suppliers and returns' },
  { key: 'inventory', label: 'Inventory', description: 'Products, stock, transfers, barcodes and low stock' },
  { key: 'accounts', label: 'Accounts', description: 'Expenses, payments, bank accounts and ledger' },
  { key: 'reports', label: 'Reports', description: 'Business, GST, sales and inventory reports' },
  { key: 'shopify', label: 'Shopify', description: 'Shopify sync, price and inventory push' },
  { key: 'system', label: 'System', description: 'Users & roles, settings and audit logs' },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)

const all: ModulePermission = { view: true, create: true, edit: true, delete: true }
const viewOnly: ModulePermission = { view: true, create: false, edit: false, delete: false }

export const emptyPermissions = (): Permissions => {
  const out: Permissions = {}
  for (const m of MODULES) out[m.key] = { view: false, create: false, edit: false, delete: false }
  return out
}

export function defaultRolePermissions(name: string): Permissions {
  const p = emptyPermissions()

  switch (name) {
    case 'Super Admin':
      for (const m of MODULES) p[m.key] = { ...all }
      break
    case 'Admin':
      for (const m of MODULES) p[m.key] = { ...all }
      p.system = { view: true, create: true, edit: true, delete: false }
      break
    case 'Manager':
      p.dashboard = { ...viewOnly }
      p.sales = { ...all }
      p.inventory = { ...all }
      p.purchase = { view: true, create: true, edit: true, delete: false }
      p['silver-rate'] = { ...all }
      p.accounts = { ...viewOnly }
      p.shopify = { view: true, create: false, edit: false, delete: false }
      break
    case 'Accounts':
      p.accounts = { ...all }
      p.sales = { view: true, create: false, edit: true, delete: false }
      p.purchase = { ...viewOnly }
      p.reports = { ...viewOnly }
      p.dashboard = { ...viewOnly }
      p.shopify = { view: true, create: false, edit: false, delete: false }
      break
    case 'Purchase':
      p.purchase = { ...all }
      p.inventory = { view: true, create: false, edit: true, delete: false }
      p.reports = { ...viewOnly }
      p.dashboard = { ...viewOnly }
      p.shopify = { view: true, create: false, edit: false, delete: false }
      break
    case 'Sales':
      p.sales = { ...all }
      p.dashboard = { ...viewOnly }
      p.inventory = { ...viewOnly }
      p.shopify = { view: true, create: false, edit: false, delete: false }
      break
    case 'Shopify Manager':
      p.shopify = { ...all }
      p.inventory = { view: true, create: false, edit: true, delete: false }
      p.dashboard = { ...viewOnly }
      break
    case 'Customer Support':
      p.sales = { view: true, create: false, edit: true, delete: false }
      p.dashboard = { ...viewOnly }
      p.shopify = { view: true, create: false, edit: false, delete: false }
      break
  }
  return p
}

export function mergePermissions(rolePermissions: Permissions, overrides: Permissions | null): Permissions {
  const out = emptyPermissions()
  for (const m of MODULES) {
    const base = rolePermissions[m.key] ?? { view: false, create: false, edit: false, delete: false }
    const ov = overrides?.[m.key]
    out[m.key] = {
      view: ov?.view ?? base.view,
      create: ov?.create ?? base.create,
      edit: ov?.edit ?? base.edit,
      delete: ov?.delete ?? base.delete,
    }
  }
  return out
}

export async function getRoleByName(name: string) {
  if (!db) return null
  const [row] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1)
  return row ?? null
}

export async function computeUserPermissions(userId: string): Promise<UserPermissions | null> {
  if (!db) return null
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!user) return null
  const role = await getRoleByName(user.role)
  const rolePermissions: Permissions = (role?.permissions as Permissions | null) ?? defaultRolePermissions(user.role)
  const overrides = (user.permissions as Permissions | null) ?? null
  const effective = mergePermissions(rolePermissions, overrides)
  return { userId: user.id, role: user.role, rolePermissions, overrides, effective }
}

export function requirePermission(moduleKey: string, action: keyof ModulePermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (!db) {
      res.status(503).json({ error: 'Database unavailable, cannot verify permissions' })
      return
    }
    const perms = await computeUserPermissions(userId)
    if (!perms) {
      res.status(401).json({ error: 'User not found' })
      return
    }
    const granted = perms.effective[moduleKey]?.[action]
    if (!granted) {
        res.status(403).json({ error: 'Access denied' })
      return
    }
    next()
  }
}

const RESOURCE_MODULE: Record<string, string> = {
  products: 'inventory',
  customers: 'sales',
  suppliers: 'purchase',
  'sales-orders': 'sales',
  invoices: 'sales',
  'sales-invoice-items': 'sales',
  'purchase-orders': 'purchase',
  'purchase-invoices': 'purchase',
  'sales-returns': 'sales',
  'purchase-returns': 'purchase',
  inventory: 'inventory',
  'bank-accounts': 'accounts',
  ledger: 'accounts',
  expenses: 'accounts',
  payments: 'accounts',
  users: 'system',
  'audit-logs': 'system',
  'activity-logs': 'system',
  'sync-logs': 'shopify',
  'silver-rates': 'silver-rate',
  settings: 'system',
  stats: 'dashboard',
  search: 'dashboard',
  dashboard: 'dashboard',
  reports: 'reports',
}

export function enforceRbac(req: Request, res: Response, next: NextFunction) {
  const userId = req.userId
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  if (!db) {
    res.status(503).json({ error: 'Database unavailable, cannot verify permissions' })
    return
  }

  const segments = req.path.split('/').filter(Boolean)
  const first = segments[0] ?? ''
  const moduleKey = RESOURCE_MODULE[first]
  if (!moduleKey) return next()

  const method = req.method.toLowerCase()
  const action: keyof ModulePermission =
    method === 'get' ? 'view' : method === 'post' ? 'create' : method === 'delete' ? 'delete' : 'edit'

  computeUserPermissions(userId)
    .then((perms) => {
      if (!perms) {
        res.status(401).json({ error: 'User not found' })
        return
      }
      if (!perms.effective[moduleKey]?.[action]) {
      res.status(403).json({ error: 'Access denied' })
        return
      }
      next()
    })
    .catch((err) => {
      logger.error({ err: { message: err.message } }, 'RBAC permission check failed')
      res.status(500).json({ error: 'Permission check failed' })
    })
}
