export type Trend = 'up' | 'down' | 'flat'

export interface AppSettings {
  id: string
  businessName: string
  gstin: string
  phone: string
  email: string
  address: string
  defaultPurity: number
  makingCharge: number
  gstRate: number
  currency: string
  invoicePrefix: string
  rateSource: string
  autoUpdateMcx: boolean
  requireRateApproval: boolean
  autoReconcileRazorpay: boolean
  paymentReminders: boolean
  lowStockAlerts: boolean
  dailySummary: boolean
  orderImports: boolean
  updatedAt: string | null
  notificationSettings?: NotificationSettings
}

export interface NotificationSettings {
  dailySummaryEnabled: boolean
  monthlyStatementsEnabled: boolean
  dueRemindersEnabled: boolean
  weeklyReportEnabled: boolean
  recipientEmail: string
}

export interface ConnectionSettings {
  shopifyStoreUrl: string
  shopifyAccessToken: string
  shopifyApiVersion: string
  webhookSecret: string
  shopifyConfigured: boolean
  dbHost: string
  dbPort: string
  dbDatabase: string
  dbUser: string
  dbPassword: string
  dbConfigured: boolean
}

export interface DbStatus {
  connected: boolean
  latencyMs?: number
  error?: string
  host?: string
  port?: string
  database?: string
  user?: string
}

export interface EnvConfigDef {
  key: string
  group: 'shopify' | 'email' | 'notifications' | 'payments' | 'whatsapp' | 'backup' | 'server'
  label: string
  secret?: boolean
  placeholder?: string
  hint?: string
}

export interface EnvConfigData {
  defs: EnvConfigDef[]
  values: Record<string, string>
  configured: Record<string, boolean>
}

export interface GstReportResult {
  summary: {
    taxable: number
    outputGst: number
    inputGst: number
    netGst: number
    itcUtilised: number
    cgst: number
    sgst: number
  }
  gstr1: {
    b2b: { invoices: number; taxable: number }
    b2c: { invoices: number; taxable: number }
    exports: { invoices: number; taxable: number }
    notes: { invoices: number; taxable: number }
    nilRated: { invoices: number; taxable: number }
  }
  monthly: Array<{ label: string; gst: number }>
  filing: Array<{ month: string; status: string; variant: 'success' | 'warning' }>
  gstin: string
}

export interface KpiCardData {
  key: string
  label: string
  value: string
  trend?: Trend
  delta?: string
  deltaLabel?: string
  icon: string
  accent: 'purple' | 'green' | 'orange' | 'red' | 'blue' | 'slate'
}

export interface SilverRate {
  purity: number
  rate: number
  previousRate: number
  updatedAt: string
  change: number
  changePercent: number
  currency: string
}

export interface SalesOverviewPoint {
  date: string
  label: string
  revenue: number
  orders: number
}

export interface TopProduct {
  id: string
  name: string
  sku: string
  qty: number
  weight: number
  revenue: number
  icon: string
}

export interface ProfitMonthPoint {
  month: string
  revenue: number
  cogs: number
  grossProfit: number
  grossMargin: number
  expenses: number
  purchases: number
  netProfit: number
  invoices: number
}

export interface BestSellerRow {
  sku: string
  name: string
  qty: number
  revenue: number
  profit: number
}

export interface ProfitAnalytics {
  months: ProfitMonthPoint[]
  totals: { revenue: number; grossProfit: number; expenses: number; netProfit: number; grossMargin: number }
  bestSellers: BestSellerRow[]
  expenseBreakdown: Array<{ category: string; amount: number }>
}

export interface PaymentStatusSegment {
  status: 'paid' | 'pending' | 'failed'
  label: string
  value: number
  count: number
}

export interface SilverRatePoint {
  date: string
  rate: number
}

export interface LowStockItem {
  id: string
  product: string
  sku: string
  stock: number
  reorderLevel: number
  status: 'critical' | 'low'
}

export interface InventoryLocation {
  id: string
  name: string
  type: 'store' | 'warehouse' | 'workshop'
  city: string
  manager: string
}

export type TransferStatus = 'pending' | 'in-transit' | 'received' | 'cancelled'

export interface StockTransfer {
  id: string
  number: string
  from: string
  to: string
  product: string
  sku: string
  qty: number
  weight: number
  initiatedBy: string
  status: TransferStatus
  date: string
}

export interface StockCategory {
  category: string
  products: number
  qty: number
  weight: number
  value: number
}

export type ActivityType =
  | 'silver-rate'
  | 'shopify-import'
  | 'invoice'
  | 'payment'
  | 'product'
  | 'sync'
  | 'user'
  | 'purchase'

export interface Activity {
  id: string
  type: ActivityType
  title: string
  detail?: string
  actor: string
  time: string
}

export interface AnalyticsStat {
  label: string
  value: string
  delta?: string
  trend?: Trend
}

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string
  huid?: string | null
  category: string
  collection: string
  purity: number
  grossWeight: number
  stoneWeight: number
  netWeight: number
  makingCharge: number
  gst: number
  hsn: string
  supplier: string
  silverRate: number
  sellingPrice: number
  compareAtPrice?: number | null
  stock: number
  reorderLevel: number
  shopifyStatus: 'synced' | 'pending' | 'not-listed' | 'error' | null
  shopifyId?: string
  status: 'active' | 'inactive' | 'draft' | null
  image?: string | null
  images?: string[] | null
  vendor?: string | null
  productType?: string | null
  tags?: string | null
  trackInventory?: boolean
  chargeOnTax?: boolean
  createdAt: string
}

export interface Invoice {
  id: string
  number: string
  shopifyOrder: string
  customer: string
  customerEmail: string
  customerPhone?: string
  customerAddress?: string
  customerCity?: string
  customerState?: string
  customerPincode?: string
  customerGstin?: string
  customerStateCode?: string
  items: InvoiceItem[]
  silverValue: number
  makingCharge: number
  subtotal: number
  gst: number
  gstAmount: number
  discount: number
  grandTotal: number
  paymentMethod: string
  paymentStatus: 'paid' | 'partial' | 'pending' | 'failed' | 'refunded'
  paymentId?: string
  status: 'paid' | 'draft' | 'issued' | 'overdue' | 'cancelled' | 'refunded'
  date: string
  businessName?: string
  businessGstin?: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
}

export interface InvoiceItem {
  product: string
  sku: string
  hsn?: string
  qty: number
  weight: number
  silverRate: number
  makingCharge: number
  tax: number
  amount: number
}

export interface SalesOrderLineItem {
  title: string
  sku?: string
  quantity: number
  price: number
}

export interface SalesOrder {
  id: string
  shopifyId: string
  internalId: string
  customer: string
  value: number
  payment: 'paid' | 'pending' | 'refunded'
  fulfillment: 'unfulfilled' | 'partial' | 'fulfilled' | 'processing' | 'returned'
  invoice: string | null
  status: OrderStatus
  date: string
  items: number
  tags?: string | null
  currency?: string | null
  discount?: number | null
  lineItems?: SalesOrderLineItem[] | null
  billingAddress?: Record<string, string> | null
  shippingAddress?: Record<string, string> | null
  isBooking?: boolean | null
  advancePaid?: number | null
}

export type OrderStatus =
  | 'imported'
  | 'confirmed'
  | 'processing'
  | 'fulfilled'
  | 'cancelled'
  | 'returned'
  | 'refunded'

export interface OrderEvent {
  id: string
  orderId: string
  event: string
  details: string | null
  actor: string | null
  createdAt: string
}

export interface Customer360 {
  customer: string
  totalOrders: number
  lifetimeValue: number
  outstanding: number
  lastOrder: string | null
  lastInvoice: string | null
  orders: SalesOrder[]
  invoices: Array<Pick<Invoice, 'id' | 'number' | 'customer' | 'grandTotal' | 'paymentStatus' | 'status' | 'date'>>
  payments: Array<{ id: string; ref: string | null; invoice: string | null; amount: number | null; method: string | null; date: string | null }>
}

export interface OrderFullDetail {
  order: Record<string, unknown>
  items: Array<Record<string, unknown>>
  invoice: {
    id: string
    number: string
    grandTotal: string | number | null
    subtotal: string | number | null
    gstAmount: string | number | null
    paymentStatus: string | null
    paymentMethod: string | null
    status: string | null
    date: string | null
    dueDate: string | null
  } | null
  payments: Array<{ id: string; ref: string | null; amount: string | number | null; method: string | null; gateway: string | null; status: string | null; date: string | null }>
  shipment: {
    id: string
    courier: string | null
    trackingNumber: string | null
    status: string
    dispatchedAt: string | null
    expectedDelivery: string | null
    deliveredAt: string | null
    notes: string | null
  } | null
  events: Array<{ id: string; event: string; details: string | null; actor: string | null; createdAt: string }>
  customer: Record<string, unknown> | null
  contact: {
    name: string | null
    email: string | null
    phone: string | null
    address: string | null
    city: string | null
    state: string | null
    pincode: string | null
  }
}

export interface ReorderSuggestion {
  id: string
  name: string
  sku: string
  supplier: string | null
  stock: number
  reorderLevel: number
  sold90d: number
  weeklyVelocity: number
  weeksOfCover: number
  suggestedQty: number
  priority: 'urgent' | 'soon' | 'ok'
}

export interface SyncLog {
  id: string
  entity: 'Order' | 'Product' | 'Inventory' | 'Customer' | 'Price' | 'Payment'
  shopifyId: string
  direction: 'in' | 'out'
  action: string
  status: 'success' | 'failed' | 'pending' | 'skipped'
  time: string
  error?: string
  retry?: boolean
}

export interface Supplier {
  id: string
  name: string
  contact: string
  phone: string
  city: string
  status: 'active' | 'inactive'
  outstanding: number
}

export interface PurchaseInvoice {
  id: string
  number: string
  supplier: string
  items: number
  qty: number
  weight: number
  rate: number
  cost: number
  tax: number
  total: number
  status: 'paid' | 'partial' | 'pending' | 'cancelled'
  date: string
}

export interface PurchaseOrder {
  id: string
  number: string
  supplier: string
  items: number
  qty: number
  weight: number
  value: number
  status: 'open' | 'received' | 'cancelled' | 'draft' | 'closed'
  date: string
}

export interface SalesReturn {
  id: string
  number: string
  order: string
  customer: string
  items: number
  amount: number
  status: 'pending' | 'approved' | 'refunded' | 'rejected'
  date: string
}

export interface QuotationItem {
  id?: string
  product: string
  sku: string
  qty: number
  weight: number
  silverRate: number
  makingCharge: number
  amount: number
}

export interface Quotation {
  id: string
  number: string
  customer: string | null
  customerPhone: string | null
  customerEmail: string | null
  customerAddress: string | null
  customerCity: string | null
  customerState: string | null
  customerPincode: string | null
  subtotal: number
  gst: number
  gstAmount: number
  discount: number
  grandTotal: number
  notes: string | null
  status: 'draft' | 'sent' | 'approved' | 'converted' | 'expired' | 'cancelled'
  validUntil: string | null
  convertedInvoice: string | null
  convertedAt: string | null
  createdBy: string | null
  date: string
  items?: QuotationItem[]
}

export interface PurchaseReturn {
  id: string
  number: string
  supplier: string
  items: number
  weight: number
  amount: number
  status: 'pending' | 'approved' | 'rejected' | 'received'
  date: string
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  city: string
  province?: string | null
  shopifyId?: string | null
  emailVerified?: boolean | null
  orders: number
  totalSpent: number
  status: 'active' | 'inactive'
  joined: string
}

export interface BankAccount {
  id: string
  name: string
  bank: string
  accountNumber: string
  balance: number
  ifsc: string
}

export interface LedgerEntry {
  id: string
  date: string
  description: string
  ref: string
  debit: number
  credit: number
}

export interface User {
  id: string
  name: string
  email: string
  username: string
  role: string
  lastLogin: string
  status: 'active' | 'inactive' | 'invited'
  avatarColor: string
  permissions?: Permissions | null
  /** Server refuses every other endpoint until this is cleared. */
  requirePasswordChange?: boolean
}

export interface ModulePermission {
  view: boolean
  create: boolean
  edit: boolean
  delete: boolean
}

export type Permissions = Record<string, ModulePermission>

export interface Role {
  id: string
  name: string
  description: string | null
  permissions: Permissions
  isSystem: boolean
  createdAt: string | null
}

export interface RbacModule {
  key: string
  label: string
  description: string
}

export interface UserPermissions {
  userId: string
  role: string
  rolePermissions: Permissions
  overrides: Permissions | null
  effective: Permissions
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  user: string
  action: string
  module: string
  entity: string
  changes: string
  ip?: string
}

export interface ActivityLogEntry {
  id: string
  timestamp: string
  user: string
  userId?: string | null
  role?: string | null
  action: string
  module: string
  entity: string
  details?: string | null
  ip?: string | null
}

export interface Expense {
  id: string
  category: string
  description: string
  amount: number
  paymentMethod: string
  date: string
  status: 'approved' | 'pending' | 'rejected'
  by: string
}

export interface Payment {
  id: string
  ref: string
  invoice: string
  customer: string
  amount: number
  method: string
  gateway: 'Razorpay' | 'COD' | 'Bank Transfer' | 'UPI'
  status: 'settled' | 'pending' | 'failed' | 'refunded'
  date: string
  reconciled: boolean
}

export interface ReportDefinition {
  id: string
  name: string
  description: string
  category: string
  icon: string
}

export interface Shipment {
  id: string
  orderId: string
  orderRef: string | null
  customer: string | null
  courier: string | null
  trackingNumber: string | null
  status: string
  dispatchedAt: string | null
  expectedDelivery: string | null
  deliveredAt: string | null
  notes: string | null
  createdAt: string | null
}

export interface NotificationLogEntry {
  id: string
  kind: string
  channel: string
  recipient: string | null
  ref: string | null
  status: string
  error: string | null
  createdAt: string | null
}

export interface SystemStatusInfo {
  ok: boolean
  app: { name: string; version: string }
  runtime: { node: string; platform: string; arch: string; env: string | null }
  server: {
    port: number
    uptimeSec: number
    rssMb: number
    heapMb: number
    sessions: { active: number; totalCreated: number }
  }
  database: {
    configured: boolean
    healthy: boolean
    latencyMs: number | null
    stats: { totalConnections: number; idleConnections: number; waitingCount: number } | null
  }
  integrations: { shopify: boolean; emailIngest: boolean }
  paths: { logs: string; env: string | null }
}

export interface SystemLogFileInfo {
  key: string
  name: string
  sizeKb: number
  modifiedAt: string | null
}

export interface SystemLogTail {
  file: string
  directory: string
  lines: string[]
}

export interface UpdateFailureInfo {
  /** ISO timestamp of the failed attempt, when known. */
  at: string
  reason: string
}

export interface UpdateStatusInfo {
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  latest: string | null
  progress: number
  assetName: string | null
  assetSize: number | null
  filePath: string | null
  error: string | null
  /** Set when the last automatic install gave up; the app is still on the old version. */
  lastFailure: UpdateFailureInfo | null
}

export interface UpdatePrefsInfo {
  autoDownload: boolean
  autoInstall: boolean
  showBanner: boolean
}
