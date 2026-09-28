import type {
  Activity,
  ActivityLogEntry,
  AnalyticsStat,
  Quotation,
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
  Product,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseReturn,
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
  ConnectionSettings,
  DbStatus,
  Customer360,
  OrderFullDetail,
  ReorderSuggestion,
  Shipment,
  NotificationLogEntry,
} from '@/types'
import { istDateKey } from '@/lib/format'
import { request, list, maybe, withItems, PAGED } from './core'
import type { SearchResults, SalesInvoiceRow } from './core'

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
    request<{ ok: boolean; rate: number; previousRate: number; affected: number; matched: number; updated: number; skipped: number; errors: string[]; message?: string; steps?: Array<{ key: string; label: string; status: 'done' | 'failed' | 'skipped'; detail?: string }> }>(
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
  getProductMargins: (months = 12): Promise<{ months: number; rows: Array<{ sku: string; name: string; qty: number; revenue: number; cost: number; profit: number; marginPct: number }>; totals: { revenue: number; cost: number; profit: number; marginPct: number } }> =>
    request(`/db/reports/product-margins?months=${months}`),
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
  getDashboardSecurity: (): Promise<{ failedLogins24h: number; lockedAccounts: number; recent: Array<{ entity: string | null; details: string | null; timestamp: string | null }> }> =>
    request('/db/dashboard/security'),
  getNotificationFeed: () =>
    request<{ items: Array<{ type: string; title: string; detail: string | null; at: string | null; href: string }>; counts: { total: number; lowStock: number; alerts: number } }>('/db/notifications/feed'),
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
  sendInvoiceWhatsApp: (invoiceId: string) =>
    request<{ ok: boolean; to?: string; messageId?: string; error?: string }>(`/whatsapp/invoice/${invoiceId}`, { method: 'POST' }),
  emailInvoice: (invoiceId: string, to?: string) =>
    request<{ ok: boolean; message?: string; to?: string; error?: string }>(`/db/invoices/${encodeURIComponent(invoiceId)}/email`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  importProductsCsv: (csv: string) =>
    request<{ ok: boolean; imported: number; created: number; updated: number; errors: string[] }>('/db/products/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  loyaltyBalance: (customer: string) =>
    request<{ found: boolean; customer?: { id: string; name: string; phone: string | null }; balance?: number; pointValue?: number; enabled?: boolean }>(`/loyalty/balance?customer=${encodeURIComponent(customer)}`),
  loyaltyHistory: (customer: string) =>
    request<{ found: boolean; entries: Array<{ id: string; type: string; points: string; balanceAfter: string | null; note: string | null; invoiceNumber: string | null; date: string }> }>(`/loyalty/history?customer=${encodeURIComponent(customer)}`),
  loyaltyRedeem: (customer: string, points: number, opts?: { invoiceId?: string; invoiceNumber?: string }) =>
    request<{ ok: boolean; balanceAfter?: number; error?: string }>('/loyalty/redeem', {
      method: 'POST',
      body: JSON.stringify({ customer, points, ...opts }),
    }),
  loyaltyAdjust: (customer: string, points: number, note: string) =>
    request<{ ok: boolean; points: number; balanceAfter: number }>('/loyalty/adjust', {
      method: 'POST',
      body: JSON.stringify({ customer, points, note }),
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
  getOrderFull: (orderId: string) =>
    request<OrderFullDetail>(`/db/orders/${orderId}/full`),
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
  getCustomerDuplicateEmails: () => request<{ data: Array<{ email: string; cnt: number; customers: string }> }>('/db/customers/duplicate-emails'),
  scanProduct: (code: string) =>
    request<{ data: { id: string; name: string; sku: string; barcode: string | null; stock: number | null; category: string | null } }>(
      `/db/products/scan?code=${encodeURIComponent(code)}`,
    ),
  applyStockCount: (
    counts: Array<{ id: string; counted: number }>,
    mode: 'set' | 'adjust',
    pushToShopify?: boolean,
  ) =>
    request<{ ok: boolean; applied: number; mode: string; errors: string[]; shopifyPush?: { ok: boolean; updated: number; skipped: number; errors: string[] } | null }>(
      '/db/inventory/stock-count',
      {
        method: 'POST',
        body: JSON.stringify({ counts, mode, pushToShopify: pushToShopify === true }),
      },
    ),
  createInvoiceForOrder: (orderId: string) =>
    request<{ created: boolean; invoiceNumber: string | null }>(`/db/sales-orders/${encodeURIComponent(orderId)}/create-invoice`, {
      method: 'POST',
    }),
  duplicateInvoice: (id: string) =>
    request<Invoice>(`/db/invoices/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  createPOsFromReorder: (ids?: string[]) =>
    request<{ ok: boolean; created: Array<{ number: string; supplier: string; items: number; qty: number }>; suppliers: number; products: number }>(
      '/db/purchase-orders/from-reorder',
      { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) },
    ),
  getDues: () =>
    request<{ dues: Array<{ customer: string; invoiceCount: number; total: number; oldestDate: string | null; invoiceNumbers: string[] }>; total: number; customerCount: number }>('/db/dues'),
  emailDuesStatement: (to?: string) =>
    request<{ sent: boolean; reason?: string; recipient?: string; total?: number; customerCount?: number }>('/db/dues/email', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  sendPaymentReminders: (): Promise<{ sent: number; skipped: number; failures?: string[]; reason?: string }> =>
    request('/db/dues/remind', { method: 'POST' }),
  recordPayment: (payload: { customer: string; amount: number; method: string }) =>
    request<{ ok: boolean; ref: string; settled: string[]; remainingOutstanding: number }>('/db/dues/pay', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPurchaseOrders: () => list<PurchaseOrder>('/db/purchase-orders', PAGED),
  getQuotations: () => list<Quotation>('/db/quotations', PAGED),
  getQuotationById: (id: string) => request<Quotation>(`/db/quotations/${id}`),
  createQuotation: (payload: Record<string, unknown>) =>
    request<Quotation>('/db/quotations', { method: 'POST', body: JSON.stringify(payload) }),
  updateQuotation: (id: string, payload: Record<string, unknown>) =>
    request<Quotation>(`/db/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteQuotation: (id: string) => request<{ ok: boolean }>(`/db/quotations/${id}`, { method: 'DELETE' }),
  convertQuotation: (id: string) =>
    request<{ ok: boolean; invoiceNumber: string; invoiceId: string }>(`/db/quotations/${id}/convert`, { method: 'POST' }),
  convertQuotationToOrder: (id: string) =>
    request<{ ok: boolean; orderNumber: string; orderId: string }>(`/db/quotations/${id}/convert-order`, { method: 'POST' }),
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
