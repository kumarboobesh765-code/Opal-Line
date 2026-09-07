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
}

export type OrderStatus =
  | 'imported'
  | 'confirmed'
  | 'processing'
  | 'fulfilled'
  | 'cancelled'
  | 'returned'
  | 'refunded'

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
