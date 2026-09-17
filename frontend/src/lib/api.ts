import type {
  Activity,
  ActivityLogEntry,
  AnalyticsStat,
  AppSettings,
  AuditLogEntry,
  NotificationSettings,
  BankAccount,
  Customer,
  Expense,
  GstReportResult,
  Invoice,
  InventoryLocation,
  InvoiceItem,
  KpiCardData,
  LedgerEntry,
  LowStockItem,
  Payment,
  PaymentStatusSegment,
  Permissions,
  Product,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseReturn,
  RbacModule,
  Role,
  SalesOrder,
  SalesOverviewPoint,
  SalesReturn,
  SilverRate,
  SilverRatePoint,
  ProfitAnalytics,
  StockCategory,
  StockTransfer,
  Supplier,
  SyncLog,
  TopProduct,
  User,
  UserPermissions,
  ConnectionSettings,
  DbStatus,
  Customer360,
  ReorderSuggestion,
  Shipment,
  NotificationLogEntry,
} from '@/types'
import type {
  ShopifyStatus,
  SyncCustomer,
  SyncInventory,
  SyncOrder,
  SyncPrice,
  SyncProduct,
  SyncResource,
  SyncResult,
} from '@/types/shopify'
import { istDateKey } from '@/lib/format'

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1').replace(/\/$/, '')

let csrfToken: string | null = null
let csrfTokenTime: number = 0
const CSRF_TOKEN_MAX_AGE = 30 * 60 * 1000 // 30 minutes

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken && (Date.now() - csrfTokenTime) < CSRF_TOKEN_MAX_AGE) return csrfToken
  csrfToken = null
  csrfTokenTime = 0
  try {
    const res = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' })
    if (!res.ok) return ''
    const data = await res.json()
    csrfToken = data.csrfToken ?? null
    csrfTokenTime = Date.now()
    return csrfToken ?? ''
  } catch {
    return ''
  }
}

function resetCsrfToken(): void {
  csrfToken = null
}

export { resetCsrfToken }

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const isStateChanging = init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method)
  
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' }
  
  if (isStateChanging) {
    const token = await fetchCsrfToken()
    if (token) headers['X-CSRF-Token'] = token
  }
  
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })
  
  if (res.status === 403 && isStateChanging) {
    resetCsrfToken()
    const newToken = await fetchCsrfToken()
    if (newToken) {
      const retryRes = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: { ...headers, 'X-CSRF-Token': newToken, ...(init?.headers as Record<string, string> | undefined) },
      })
      if (!retryRes.ok) {
        const body = (await retryRes.json().catch(() => null)) as { error?: string } | null
        if (retryRes.status === 401 && !path.startsWith('/auth/')) {
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
        }
        throw new ApiError(retryRes.status, body?.error ?? `API error ${retryRes.status}`)
      }
      return retryRes.json() as Promise<T>
    }
  }
  
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    if (res.status === 401 && !path.startsWith('/auth/')) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    throw new ApiError(res.status, body?.error ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function list<T>(path: string, params?: Record<string, string | number>): Promise<T[]> {
  const all: T[] = []
  let page = 1
  const pageSize = 200
  while (true) {
    const query = params
      ? Object.entries({ ...params, page, limit: pageSize })
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : `page=${page}&limit=${pageSize}`
    const res = await request<{ data: T[]; total: number }>(`${path}${query ? `?${query}` : ''}`)
    all.push(...res.data)
    if (res.data.length < pageSize || all.length >= res.total) break
    page++
  }
  return all
}

async function maybe<T>(path: string): Promise<T | undefined> {
  try {
    return await request<T>(path)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined
    throw err
  }
}

type SalesInvoiceRow = Omit<Invoice, 'items'>

async function withItems(inv: SalesInvoiceRow): Promise<Invoice> {
  const items = await request<InvoiceItem[]>(`/db/invoices/${inv.id}/items`)
  return { ...inv, items }
}

const PAGED = { limit: 200 }

export interface SearchResults {
  products: Product[]
  customers: Customer[]
  invoices: Array<Pick<Invoice, 'id' | 'number' | 'customer' | 'shopifyOrder' | 'grandTotal'>>
  suppliers: Supplier[]
  salesOrders: SalesOrder[]
  purchaseInvoices: PurchaseInvoice[]
  payments: Payment[]
}

export const shopifyApi = {
  getHealth: () => request<{ ok: boolean; shopifyConfigured: boolean }>('/health'),
  getStatus: () => request<ShopifyStatus>('/shopify/status'),
  testConnection: (creds?: { shopifyStoreUrl?: string; shopifyAccessToken?: string }) =>
    request<{ ok: boolean; error?: string; shop?: string }>('/shopify/test', {
      method: 'POST',
      body: creds ? JSON.stringify(creds) : undefined,
    }),
  sync: (resources?: SyncResource[]) =>
    request<SyncResult>('/shopify/sync', { method: 'POST', body: JSON.stringify({ resources }) }),
  createOrder: (body: {
    customer: string
    email?: string
    phone?: string
    payment?: string
    fulfillment?: string
    status?: string
    date?: string
    note?: string
    items: Array<{ title: string; sku?: string; quantity: number; price: number }>
    billingAddress?: {
      name?: string
      phone?: string
      address1?: string
      address2?: string
      city?: string
      province?: string
      zip?: string
      country?: string
    }
    shippingAddress?: {
      name?: string
      phone?: string
      address1?: string
      address2?: string
      city?: string
      province?: string
      zip?: string
      country?: string
    }
    syncToShopify?: boolean
  }) =>
    request<{
      order: SalesOrder
      shopifySync: { ok: boolean; draftId?: string; name?: string; completed?: boolean; errors: string[]; message?: string } | null
    }>('/shopify/orders/create', { method: 'POST', body: JSON.stringify(body) }),
  updateOrder: (id: string, body: {
    customer: string
    email?: string
    phone?: string
    payment?: string
    fulfillment?: string
    status?: string
    date?: string
    note?: string
    items?: Array<{ title: string; sku?: string; quantity: number; price: number }>
    billingAddress?: {
      name?: string
      phone?: string
      address1?: string
      address2?: string
      city?: string
      province?: string
      zip?: string
      country?: string
    }
    shippingAddress?: {
      name?: string
      phone?: string
      address1?: string
      address2?: string
      city?: string
      province?: string
      zip?: string
      country?: string
    }
    syncToShopify?: boolean
  }) =>
    request<{
      order: SalesOrder
      shopifySync: { ok: boolean; errors: string[]; message?: string } | null
    }>(`/shopify/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getOrders: () => request<{ syncedAt: string | null; data: SyncOrder[] }>('/shopify/orders'),
  syncOrders: () =>
    request<{ ok: boolean; imported: number; updated: number; errors: string[]; message?: string }>('/shopify/orders/sync', {
      method: 'POST',
    }),
  syncCustomers: () =>
    request<{ ok: boolean; imported: number; updated: number; errors: string[]; message?: string }>('/shopify/customers/sync', {
      method: 'POST',
    }),
  enrichOrders: () =>
    request<{ ok: boolean; enriched: number; failed: number; skipped: number; errors: string[]; message?: string }>('/shopify/enrich', {
      method: 'POST',
    }),
  getProducts: () => request<{ syncedAt: string | null; data: SyncProduct[] }>('/shopify/products'),
  getCustomers: () => request<{ syncedAt: string | null; data: SyncCustomer[] }>('/shopify/customers'),
  getInventory: () => request<{ syncedAt: string | null; data: SyncInventory[] }>('/shopify/inventory'),
  getPrice: () => request<{ syncedAt: string | null; data: SyncPrice[] }>('/shopify/price'),
  applyPrice: () => request<{ ok: boolean; updated: number; skipped: number; errors: string[] }>('/shopify/price/apply', { method: 'POST' }),
  pushProducts: (ids?: string[]) =>
    request<{ ok: boolean; created: number; skipped: number; errors: string[]; message?: string }>('/shopify/products/push', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  updateProductPrice: (id: string) =>
    request<{ ok: boolean; updated: number; skipped: number; errors: string[]; message?: string }>('/shopify/products/price', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  pushInventory: (ids?: string[]) =>
    request<{ ok: boolean; updated: number; skipped: number; errors: string[]; message?: string }>('/shopify/inventory/push', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  purgeProducts: () =>
    request<{ ok: boolean; shopifyDeleted: number; localDeleted: number; errors: string[] }>('/shopify/products/purge', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  syncProductsToDb: () =>
    request<{ ok: boolean; synced: number; created: number; updated: number; removed: number; errors: string[]; message?: string }>(
      '/shopify/products/sync-db',
      { method: 'POST', body: JSON.stringify({}) },
    ),
}

export const uploadsApi = {
  uploadImages: (dataUrls: string[]) =>
    request<{ ok: boolean; paths: string[]; errors?: string[] }>('/uploads/image', {
      method: 'POST',
      body: JSON.stringify({ dataUrls }),
    }),
}

export const authApi = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User; permissions: Permissions }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  getMe: () => request<User>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
}

export const rbacApi = {
  getModules: () => request<RbacModule[]>('/rbac/modules'),
  getRoles: () => request<Role[]>('/rbac/roles'),
  createRole: (body: { name: string; description?: string; permissions: Permissions }) =>
    request<Role>('/rbac/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id: string, body: Partial<{ name: string; description: string; permissions: Permissions }>) =>
    request<Role>(`/rbac/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeRole: (id: string) => request<{ ok: boolean }>(`/rbac/roles/${id}`, { method: 'DELETE' }),
  getUserPermissions: (userId: string) => request<UserPermissions>(`/rbac/users/${userId}/permissions`),
  setUserPermissions: (userId: string, permissions: Permissions | null) =>
    request<UserPermissions>(`/rbac/users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
}

export const dbApi = {
  getSilverRate: async (): Promise<SilverRate> => {
    const res = await request<{ rate: number; purity: number; previousRate: number; updatedAt: string | null; currency: string }>('/silver/rate')
    const change = Math.round((res.rate - res.previousRate) * 100) / 100
    return {
      purity: res.purity,
      rate: res.rate,
      previousRate: res.previousRate,
      updatedAt: res.updatedAt ?? '',
      change,
      changePercent: res.previousRate > 0 ? Math.round((change / res.previousRate) * 10000) / 100 : 0,
      currency: res.currency,
    }
  },
  updateSilverRate: async (rate: number, syncFirst = false) =>
    request<{ ok: boolean; rate: number; previousRate: number; affected: number; matched: number; updated: number; skipped: number; errors: string[]; message?: string }>(
      '/silver/update',
      { method: 'POST', body: JSON.stringify({ rate, syncFirst }) },
    ),
  getDashboardKpis: async (): Promise<KpiCardData[]> => {
    const rows = await request<
      Array<{ key: string; label: string; value: string; delta: string | null; deltaLabel: string | null; icon: string; trend: 'up' | 'down' | 'flat'; accent: string }>
    >('/db/dashboard/kpis')
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      trend: r.trend,
      delta: r.delta ?? undefined,
      deltaLabel: r.deltaLabel ?? undefined,
      icon: r.icon,
      accent: (r.accent as KpiCardData['accent']) ?? 'slate',
    }))
  },
  getDashboardSummary: () =>
    request<{
      totalProducts: number
      activeProducts: number
      totalCustomers: number
      activeCustomers: number
      totalSuppliers: number
      activeSuppliers: number
      totalStockQty: number
      totalStockWeight: number
      todayExpenses: number
      pendingPayments: number
    }>('/db/dashboard/summary'),
  getSalesOverview: (period = 'week', range?: { start?: string; end?: string }): Promise<SalesOverviewPoint[]> => {
    const q = new URLSearchParams({ period })
    if (range?.start) q.set('start', range.start)
    if (range?.end) q.set('end', range.end)
    return request(`/db/dashboard/sales-overview?${q.toString()}`)
  },
  getTopProducts: (): Promise<TopProduct[]> => request('/db/dashboard/top-products'),
  getProfitAnalytics: (months = 12): Promise<ProfitAnalytics> =>
    request(`/db/dashboard/profit?months=${months}`),
  getPaymentStatus: (): Promise<{ segments: PaymentStatusSegment[]; total: number }> =>
    request('/db/dashboard/payment-status'),
  getSilverRateHistory: async (): Promise<SilverRatePoint[]> => {
    const res = await request<{ data: Array<{ updatedAt: string; rate: number }> }>('/db/silver-rates?limit=100')
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return res.data
      .filter((r) => r.updatedAt && Number.isFinite(Number(r.rate)))
      .map((r) => {
        const [, m, d] = istDateKey(r.updatedAt).split('-')
        return { date: `${Number(d)} ${MONTHS[Number(m) - 1]}`, rate: Number(r.rate) }
      })
  },
  getLowStock: (): Promise<LowStockItem[]> => request('/db/dashboard/low-stock'),
  getRecentActivities: (): Promise<Activity[]> => request('/db/dashboard/activities'),
  getAnalyticsStats: (): Promise<AnalyticsStat[]> => request('/db/dashboard/analytics'),
  getInventoryOverview: () =>
    request<{
      totalProducts: number
      totalQuantity: number
      totalWeight: number
      inventoryValue: number
      lowStock: number
      outOfStock: number
    }>('/db/dashboard/inventory-overview'),
  getGstReport: (params?: { month?: number; year?: number }) => {
    const q = new URLSearchParams()
    if (params?.month) q.set('month', String(params.month))
    if (params?.year) q.set('year', String(params.year))
    const suffix = q.toString() ? `?${q.toString()}` : ''
    return request<GstReportResult>(`/db/reports/gst${suffix}`)
  },
  getSettings: (): Promise<AppSettings | null> => request('/db/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/db/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getConnectionSettings: (): Promise<ConnectionSettings> => request('/db/settings/connections'),
  updateConnectionSettings: (patch: Partial<ConnectionSettings>) =>
    request<{ ok: boolean; reconnectError?: string; shopify?: { ok: boolean; error?: string; shop?: string } }>('/db/settings/connections', { method: 'PUT', body: JSON.stringify(patch) }),
  getDbStatus: (): Promise<DbStatus> => request('/db/settings/db-status'),
  getNotificationSettings: (): Promise<NotificationSettings> => request('/db/settings/notifications'),
  updateNotificationSettings: (patch: Partial<NotificationSettings>) =>
    request<NotificationSettings>('/db/settings/notifications', { method: 'PUT', body: JSON.stringify(patch) }),
  getSupplierDues: () =>
    request<{ dues: Array<{ supplier: string; count: number; total: number; oldestDate: string | null }>; total: number; supplierCount: number }>('/db/supplier-dues'),
  recordSupplierPayment: (payload: { supplier: string; amount: number; method: string }) =>
    request<{ ok: boolean; ref: string }>('/db/supplier-dues/pay', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createPaymentLink: (customer: string, amount: number) =>
    request<{ url: string; id: string; configured: boolean }>('/db/dues/payment-link', {
      method: 'POST',
      body: JSON.stringify({ customer, amount }),
    }),
  sendWhatsApp: (phone: string, message: string) =>
    request<{ ok: boolean; messageId: string; configured: boolean }>('/db/send-whatsapp', {
      method: 'POST',
      body: JSON.stringify({ phone, message }),
    }),

  getProducts: () => list<Product>('/db/products', PAGED),
  getProductById: (id: string) => maybe<Product>(`/db/products/${id}`),
  bulkImportProducts: (rows: Array<Record<string, string>>) =>
    request<{ created: number; updated: number; errors: string[] }>('/db/products/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  bulkUploadProductImages: (images: Array<{ filename: string; dataUrl: string }>) =>
    request<{ matched: number; unmatched: string[]; errors: string[] }>('/db/products/bulk-images', {
      method: 'POST',
      body: JSON.stringify({ images }),
    }),
  updateOrderStatus: (orderId: string, status: string) =>
    request<SalesOrder>(`/db/sales-orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  createReturn: (invoiceId: string, payload: { items?: Array<{ sku: string; qty: number }>; restock?: boolean }) =>
    request<{ creditNoteNumber: string; amount: number; restocked: boolean }>(`/db/invoices/${invoiceId}/return`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createBooking: (payload: { customer: string; items: Array<{ product: string; sku?: string; qty: number; price: number }>; advanceAmount?: number; discount?: number }) =>
    request<SalesOrder>('/db/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  convertBooking: (orderId: string) =>
    request<{ invoiceNumber: string; advanceApplied: number; balance: number }>(`/db/bookings/${orderId}/convert`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  bookingPaymentLink: (bookingId: string) =>
    request<{ url: string; id: string; amount: number; configured: boolean }>(`/db/bookings/${bookingId}/payment-link`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getOrderEvents: (orderId: string) =>
    request<{ data: Array<{ id: string; orderId: string; event: string; details: string | null; actor: string | null; createdAt: string }> }>(`/db/orders/${orderId}/events`),
  customer360: (name: string) =>
    request<Customer360>(`/db/customers/${encodeURIComponent(name)}/summary`),
  bulkOrderStatus: (ids: string[], status: string) =>
    request<{ updated: number; status: string }>('/db/sales-orders/bulk-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),
  bulkOrderInvoice: (ids: string[]) =>
    request<{ created: number; alreadyInvoiced: number; failed: number; errors: string[] }>('/db/sales-orders/bulk-invoice', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  reorderSuggestions: () =>
    request<{ data: ReorderSuggestion[]; generatedAt: string }>('/db/inventory/reorder-suggestions'),
  getCustomers: () => list<Customer>('/db/customers', PAGED),
  getSuppliers: () => list<Supplier>('/db/suppliers', PAGED),
  getInvoices: async (): Promise<Invoice[]> => {
    const invoices = await list<SalesInvoiceRow>('/db/invoices', PAGED)
    return invoices.map((inv) => ({ ...inv, items: [] }))
  },
  getInvoicesWithItems: async (): Promise<Invoice[]> => {
    const res = await request<{ data: Array<SalesInvoiceRow & { items: InvoiceItem[] }> }>('/db/invoices/with-items?limit=200')
    return res.data
  },
  getInvoiceById: async (id: string): Promise<Invoice | undefined> => {
    const inv = await maybe<SalesInvoiceRow>(`/db/invoices/${id}`)
    if (!inv) return undefined
    return withItems(inv)
  },
  getSalesOrders: () => list<SalesOrder>('/db/sales-orders', PAGED),
  getShipments: () => request<{ data: Shipment[] }>('/db/shipments'),
  dispatchShipment: (orderId: string, opts?: { courier?: string; trackingNumber?: string; expectedDelivery?: string; notes?: string }) =>
    request<{ ok: boolean }>('/db/shipments/dispatch', { method: 'POST', body: JSON.stringify({ orderId, ...opts }) }),
  confirmDelivery: (shipmentId: string) =>
    request<{ ok: boolean }>(`/db/shipments/${encodeURIComponent(shipmentId)}/delivered`, { method: 'POST' }),
  getNotificationLog: () => request<{ data: NotificationLogEntry[] }>('/db/notifications/log'),
  resendNotification: (id: string) =>
    request<{ ok: boolean }>('/db/notifications/resend', { method: 'POST', body: JSON.stringify({ id }) }),
  getProductDuplicates: () => request<{ data: Array<{ sku: string; cnt: number; products: string }> }>('/db/products/duplicates'),
  createInvoiceForOrder: (orderId: string) =>
    request<{ created: boolean; invoiceNumber: string | null }>(`/db/sales-orders/${encodeURIComponent(orderId)}/create-invoice`, {
      method: 'POST',
    }),
  getDues: () =>
    request<{ dues: Array<{ customer: string; invoiceCount: number; total: number; oldestDate: string | null; invoiceNumbers: string[] }>; total: number; customerCount: number }>('/db/dues'),
  emailDuesStatement: (to?: string) =>
    request<{ sent: boolean; reason?: string; recipient?: string; total?: number; customerCount?: number }>('/db/dues/email', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  recordPayment: (payload: { customer: string; amount: number; method: string }) =>
    request<{ ok: boolean; ref: string; settled: string[]; remainingOutstanding: number }>('/db/dues/pay', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPurchaseOrders: () => list<PurchaseOrder>('/db/purchase-orders', PAGED),
  getPurchaseInvoices: () => list<PurchaseInvoice>('/db/purchase-invoices', PAGED),
  getSalesReturns: () => list<SalesReturn>('/db/sales-returns', PAGED),
  getPurchaseReturns: () => list<PurchaseReturn>('/db/purchase-returns', PAGED),
  getStockTransfers: () => list<StockTransfer>('/db/inventory/transfers', PAGED),
  getInventoryLocations: () => list<InventoryLocation>('/db/inventory/locations', PAGED),
  getBankAccounts: () => list<BankAccount>('/db/bank-accounts', PAGED),
  getLedgerEntries: () => list<LedgerEntry>('/db/ledger', PAGED),
  getExpenses: () => list<Expense>('/db/expenses', PAGED),
  getPayments: () => list<Payment>('/db/payments', PAGED),
  getUsers: () => list<User>('/db/users', PAGED),
  getAuditLogs: () => list<AuditLogEntry>('/db/audit-logs', PAGED),
  getActivityLogs: () => list<ActivityLogEntry>('/db/activity-logs', PAGED),
  getSyncLogs: () => list<SyncLog>('/db/sync-logs', PAGED),
  getStockCategories: async (): Promise<StockCategory[]> => {
    const res = await request<StockCategory[]>('/db/dashboard/stock-categories')
    return res
  },
  getStockRunning: async () => {
    const res = await request('/db/dashboard/stock-running')
    return res as {
      products: Array<{
        id: string
        name: string
        sku: string
        category: string
        currentStock: number
        reorderLevel: number
        totalSold: number
        avgDailySales: number
        daysOfStock: number
        demandLevel: 'high' | 'medium' | 'low' | 'none'
        stockValue: number
      }>
      summary: {
        totalProducts: number
        highDemand: number
        mediumDemand: number
        atRisk: number
        totalStockValue: number
      }
    }
  },
  search: (q: string) =>
    request<SearchResults>(`/db/search?q=${encodeURIComponent(q)}`),

  create: <T = Record<string, unknown>>(resource: string, body: Record<string, unknown>) =>
    request<T>(`/db/${resource}`, { method: 'POST', body: JSON.stringify(body) }),
  get: <T>(resource: string) => request<T>(`/db/${resource}`),
  update: <T = Record<string, unknown>>(resource: string, id: string, body: Record<string, unknown>) =>
    request<T>(`/db/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (resource: string, id: string) =>
    request<{ ok: boolean }>(`/db/${resource}/${id}`, { method: 'DELETE' }),
}

export interface BackupResult {
  ok: boolean
  type: string
  label?: string
  exportedAt?: string
  fileName?: string | null
  restoredAt?: string
  restored?: number
  skipped?: number
  tables?: number
  silverRateIncluded?: boolean
  safetyBackup?: string | null
  shopifySync?: {
    ok: boolean
    products?: { created: number; skipped: number; errors: string[] }
    prices?: { updated: number; skipped: number; errors: string[] }
    inventory?: { updated: number; skipped: number; errors: string[] }
    errors: string[]
  } | null
  data?: Record<string, unknown[]>
}

export interface BackupScopeInfo {
  key: string
  label: string
  description: string
}

export interface BackupFileInfo {
  fileName: string
  type: string | null
  label: string | null
  exportedAt: string | null
  fileSize: number
  isEncrypted: boolean
  isPreRestore: boolean
}

export interface BackupValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  meta: { type?: string; label?: string; exportedAt?: string } | null
  tables: string[]
  totalRecords: number
  fileSize: number
  fileName: string
}

export interface RestoreOptions {
  restoreSilverRate?: boolean
  dryRun?: boolean
  skipShopify?: boolean
  createSafetyBackup?: boolean
  tables?: string[]
  /** Explicit typed confirmation — required by the server for real restores. */
  confirm?: string
}

export interface DryRunResult {
  ok: boolean
  dryRun: boolean
  scope: string
  label: string
  tables: Array<{
    name: string
    backupRecords: number
    currentRecords: number
    willInsert: number
    willDelete: number
    willUpdate: number
    hasIdOverlap: boolean
  }>
  totalWillInsert: number
  totalWillDelete: number
  restoreSilverRate: boolean
}

export interface BackupDiffResult {
  ok: boolean
  file1: string
  file2: string
  tables: Array<{
    name: string
    file1Count: number
    file2Count: number
    added: string[]
    removed: string[]
    modified: string[]
  }>
  summary: { totalAdded: number; totalRemoved: number; totalModified: number }
}

export const backupApi = {
  getScopes: (): Promise<BackupScopeInfo[]> => request<BackupScopeInfo[]>('/backup/scopes'),
  getHistory: (): Promise<ActivityLogEntry[]> => request<ActivityLogEntry[]>('/backup/history'),
  getAutoBackupStatus: (): Promise<{ enabled: boolean; scheduleLabel: string; nextRunAt: string; lastBackup: { fileName: string; exportedAt: string | null; sizeBytes: number } | null; backupCount: number }> =>
    request('/backup/auto-status'),
  getBackupFiles: (): Promise<BackupFileInfo[]> => request<BackupFileInfo[]>('/backup/files'),
  backupEverything: (): Promise<BackupResult> =>
    request<BackupResult>('/backup/export?type=full'),
  backupEverythingEncrypted: (): Promise<BackupResult> =>
    request<BackupResult>('/backup/export-encrypted?type=full'),
  exportBackup: (type: string): Promise<BackupResult> =>
    request<BackupResult>(`/backup/export?type=${encodeURIComponent(type)}`),
  exportEncrypted: (type: string): Promise<BackupResult> =>
    request<BackupResult>(`/backup/export-encrypted?type=${encodeURIComponent(type)}`),
  validate: (fileName: string): Promise<BackupValidation> =>
    request<BackupValidation>('/backup/validate', {
      method: 'POST',
      body: JSON.stringify({ fileName }),
    }),
  dryRun: (fileName: string, opts?: { restoreSilverRate?: boolean; tables?: string[] }): Promise<DryRunResult> =>
    request<DryRunResult>('/backup/dry-run', {
      method: 'POST',
      body: JSON.stringify({ fileName, restoreSilverRate: opts?.restoreSilverRate, tables: opts?.tables }),
    }),
  diff: (file1: string, file2: string): Promise<BackupDiffResult> =>
    request<BackupDiffResult>('/backup/diff', {
      method: 'POST',
      body: JSON.stringify({ file1, file2 }),
    }),
  restoreBackup: (type: string, data: Record<string, unknown[]>, opts?: RestoreOptions): Promise<BackupResult> =>
    request<BackupResult>(`/backup/restore`, {
      method: 'POST',
      body: JSON.stringify({
        type, data,
        restoreSilverRate: opts?.restoreSilverRate ?? false,
        dryRun: opts?.dryRun ?? false,
        skipShopify: opts?.skipShopify ?? false,
        createSafetyBackup: opts?.createSafetyBackup ?? true,
        tables: opts?.tables,
        confirm: opts?.dryRun ? undefined : 'RESTORE',
      }),
    }),
  restoreFile: (fileName: string, opts?: RestoreOptions): Promise<BackupResult> =>
    request<BackupResult>(`/backup/restore`, {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        restoreSilverRate: opts?.restoreSilverRate ?? false,
        dryRun: opts?.dryRun ?? false,
        skipShopify: opts?.skipShopify ?? false,
        createSafetyBackup: opts?.createSafetyBackup ?? true,
        tables: opts?.tables,
        confirm: opts?.dryRun ? undefined : 'RESTORE',
      }),
    }),
  deleteFile: (fileName: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/backup/files/${encodeURIComponent(fileName)}`, { method: 'DELETE' }),
  downloadFile: (fileName: string) => {
    window.open(`${API_BASE}/backup/files/${encodeURIComponent(fileName)}/download`, '_blank')
  },
  cleanup: (keepLast = 10): Promise<{ ok: boolean; deleted: string[]; kept: number }> =>
    request(`/backup/cleanup`, {
      method: 'POST',
      body: JSON.stringify({ keepLast }),
    }),
  testNotification: (email?: string): Promise<{ ok: boolean; email: string }> =>
    request('/backup/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  sendLowStockAlert: (): Promise<{ ok: boolean; count: number }> =>
    request('/backup/notifications/low-stock', { method: 'POST' }),
  sendDailySummary: (): Promise<{ ok: boolean }> =>
    request('/backup/notifications/daily-summary', { method: 'POST' }),
  downloadInvoicePDF: (invoiceId: string) => {
    window.open(`${API_BASE}/db/invoices/${encodeURIComponent(invoiceId)}/pdf`, '_blank')
  },
  downloadCreditNotePDF: (returnId: string) => {
    window.open(`${API_BASE}/db/credit-notes/${encodeURIComponent(returnId)}/pdf`, '_blank')
  },
  downloadGstExport: (month: number, year: number, format: 'csv' | 'json') => {
    window.open(`${API_BASE}/dashboard/reports/gst/export?month=${month}&year=${year}&format=${format}`, '_blank')
  },
  downloadCustomerStatement: (customer: string) => {
    window.open(`${API_BASE}/db/customers/${encodeURIComponent(customer)}/statement`, '_blank')
  },
  emailCustomerStatement: (customer: string, to: string) =>
    request<{ sent: boolean; invoiceCount: number; outstanding: number }>(`/db/customers/${encodeURIComponent(customer)}/statement/email`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  downloadAllLabels: (opts?: { preset?: string; showPrice?: boolean; showWeight?: boolean; showQR?: boolean; ids?: string[] }) => {
    const params = new URLSearchParams()
    if (opts?.preset) params.set('preset', opts.preset)
    if (opts?.showPrice === false) params.set('price', 'false')
    if (opts?.showWeight === false) params.set('weight', 'false')
    if (opts?.showQR === false) params.set('qr', 'false')
    if (opts?.ids && opts.ids.length > 0) params.set('ids', opts.ids.join(','))
    window.open(`${API_BASE}/db/products/labels?${params.toString()}`, '_blank')
  },
  downloadCatalogPdf: () => {
    window.open(`${API_BASE}/db/products/catalog-pdf`, '_blank')
  },
  downloadProductLabels: (productIds: string[], opts?: { preset?: string; showPrice?: boolean; showWeight?: boolean; showQR?: boolean }) =>
    request<Blob>('/db/products/labels', {
      method: 'POST',
      body: JSON.stringify({ productIds, ...opts }),
    }),
  getLabelPresets: (): Promise<Array<{ key: string; width: number; height: number; columns: number; rows: number }>> =>
    request('/db/products/labels/presets'),
  whatsappStatus: (): Promise<{ configured: boolean }> =>
    request('/backup/whatsapp/status'),
  sendInvoiceWhatsApp: (phoneNumber: string, invoiceId: string): Promise<{ ok: boolean }> =>
    request('/backup/whatsapp/send-invoice', {
      method: 'POST', body: JSON.stringify({ phoneNumber, invoiceId }),
    }),
  sendOrderWhatsApp: (phoneNumber: string, orderNumber: string, opts?: { customerName?: string; totalAmount?: number; itemCount?: number }): Promise<{ ok: boolean }> =>
    request('/backup/whatsapp/send-order', {
      method: 'POST', body: JSON.stringify({ phoneNumber, orderNumber, ...opts }),
    }),
  sendShippingWhatsApp: (phoneNumber: string, orderNumber: string, opts?: { customerName?: string; trackingId?: string; carrier?: string }): Promise<{ ok: boolean }> =>
    request('/backup/whatsapp/send-shipping', {
      method: 'POST', body: JSON.stringify({ phoneNumber, orderNumber, ...opts }),
    }),
  enrichCustomers: (): Promise<{ ok: boolean; enriched: number; failed: number }> =>
    request('/backup/shopify/enrich-customers', { method: 'POST' }),
  enrichOrders: (): Promise<{ ok: boolean; enriched: number; failed: number }> =>
    request('/backup/shopify/enrich-orders', { method: 'POST' }),
  emailIngestStatus: (): Promise<{ configured: boolean; mailbox: string | null; host: string }> =>
    request('/shopify/email-ingest/status'),
  pollOrderEmails: (): Promise<{ ok: boolean; scanned: number; parsed: number; updated: number; created: number; errors: string[] }> =>
    request('/shopify/email-ingest/poll', { method: 'POST' }),
  parseCSV: (csv: string): Promise<{ ok: boolean; rows: Record<string, string>[]; count: number; headers: string[] }> =>
    request('/backup/shopify/parse-csv', {
      method: 'POST', body: JSON.stringify({ csv }),
    }),
  importCustomersCSV: (rows: Record<string, string>[]): Promise<{ ok: boolean; imported: number; updated: number; errors: string[] }> =>
    request('/backup/shopify/import-customers', {
      method: 'POST', body: JSON.stringify({ rows }),
    }),
  importOrdersCSV: (rows: Record<string, string>[]): Promise<{ ok: boolean; imported: number; updated: number; errors: string[] }> =>
    request('/backup/shopify/import-orders', {
      method: 'POST', body: JSON.stringify({ rows }),
    }),
}
