export interface ShortcutDef {
  keys: string
  combo: string
  label: string
  module: string
}

/** Navigation shortcuts — press `g` then the key (vim-style). */
export const NAV_SHORTCUTS: ShortcutDef[] = [
  { keys: 'g d', combo: 'd', label: 'Dashboard', module: 'dashboard' },
  { keys: 'g o', combo: 'o', label: 'Sales Orders', module: 'sales' },
  { keys: 'g i', combo: 'i', label: 'Sales Invoices', module: 'sales' },
  { keys: 'g c', combo: 'c', label: 'Customers', module: 'sales' },
  { keys: 'g p', combo: 'p', label: 'Products', module: 'inventory' },
  { keys: 'g l', combo: 'l', label: 'Low Stock Alerts', module: 'inventory' },
  { keys: 'g e', combo: 'e', label: 'Expenses', module: 'accounts' },
  { keys: 'g r', combo: 'r', label: 'Business Reports', module: 'reports' },
  { keys: 'g b', combo: 'b', label: 'Backup & Restore', module: 'settings' },
  { keys: 'g s', combo: 's', label: 'Settings', module: 'settings' },
]

/** Global action shortcuts. */
export const ACTION_SHORTCUTS: ShortcutDef[] = [
  { keys: 'Ctrl K', combo: 'ctrl+k', label: 'Search everything', module: 'global' },
  { keys: '?', combo: '?', label: 'Show keyboard shortcuts', module: 'global' },
  { keys: 'Esc', combo: 'esc', label: 'Close dialogs', module: 'global' },
]

export const SHORTCUT_PATHS: Record<string, string> = {
  d: '/',
  o: '/sales/orders',
  i: '/sales/invoices',
  c: '/sales/customers',
  p: '/inventory/products',
  l: '/inventory/low-stock',
  e: '/accounts/expenses',
  r: '/reports/business',
  b: '/system/backup',
  s: '/system/settings',
}
