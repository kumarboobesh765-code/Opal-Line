import { pgTable, text, timestamp, numeric, integer, boolean, date, jsonb, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { mode: 'string' })
const numericNumber = (name: string) => numeric(name, { mode: 'number' })

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  permissions: jsonb('permissions').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: ts('created_at'),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  username: text('username').unique(),
  passwordHash: text('password_hash'),
  role: text('role').notNull(),
  lastLogin: ts('last_login'),
  status: text('status').notNull(),
  avatarColor: text('avatar_color'),
  permissions: jsonb('permissions'),
  emailVerified: boolean('email_verified'),
  requirePasswordChange: boolean('require_password_change'),
  resetToken: text('reset_token'),
  resetTokenExpiry: ts('reset_token_expiry'),
  emailVerificationToken: text('email_verification_token'),
  emailVerificationExpiry: ts('email_verification_expiry'),
})

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode'),
  huid: text('huid'),
  category: text('category').notNull(),
  collection: text('collection'),
  purity: numericNumber('purity'),
  grossWeight: numericNumber('gross_weight'),
  stoneWeight: numericNumber('stone_weight'),
  netWeight: numericNumber('net_weight'),
  makingCharge: numericNumber('making_charge'),
  gst: numericNumber('gst'),
  hsn: text('hsn'),
  supplier: text('supplier'),
  silverRate: numericNumber('silver_rate'),
  sellingPrice: numericNumber('selling_price'),
  compareAtPrice: numericNumber('compare_at_price'),
  stock: integer('stock'),
  reorderLevel: integer('reorder_level'),
  shopifyStatus: text('shopify_status'),
  shopifyId: text('shopify_id'),
  status: text('status'),
  image: text('image'),
  images: jsonb('images'),
  vendor: text('vendor'),
  productType: text('product_type'),
  tags: text('tags'),
  trackInventory: boolean('track_inventory').notNull().default(true),
  chargeOnTax: boolean('charge_on_tax').notNull().default(true),
  createdAt: date('created_at'),
}, (table) => ({
  skuIdx: uniqueIndex('products_sku_idx').on(table.sku),
  shopifyIdIdx: index('products_shopify_id_idx').on(table.shopifyId),
  categoryIdx: index('products_category_idx').on(table.category),
  statusIdx: index('products_status_idx').on(table.status),
  shopifyStatusIdx: index('products_shopify_status_idx').on(table.shopifyStatus),
  nameSearchIdx: index('products_name_search_idx').using('gin', sql`to_tsvector('english', ${table.name})`),
}))

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  city: text('city'),
  province: text('province'),
  shopifyId: text('shopify_id').unique(),
  emailVerified: boolean('email_verified'),
  orders: integer('orders'),
  totalSpent: numericNumber('total_spent'),
  status: text('status'),
  joined: date('joined'),
}, (table) => ({
  emailIdx: index('customers_email_idx').on(table.email),
  shopifyIdIdx: uniqueIndex('customers_shopify_id_idx').on(table.shopifyId),
  phoneIdx: index('customers_phone_idx').on(table.phone),
  nameSearchIdx: index('customers_name_search_idx').using('gin', sql`to_tsvector('english', ${table.name})`),
}))

export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  phone: text('phone'),
  city: text('city'),
  status: text('status'),
  outstanding: numericNumber('outstanding'),
}, (table) => ({
  nameIdx: uniqueIndex('suppliers_name_idx').on(table.name),
}))

export const salesOrders = pgTable('sales_orders', {
  id: text('id').primaryKey(),
  shopifyId: text('shopify_id').unique(),
  internalId: text('internal_id'),
  customer: text('customer'),
  value: numericNumber('value'),
  payment: text('payment'),
  fulfillment: text('fulfillment'),
  invoice: text('invoice'),
  status: text('status'),
  date: ts('date'),
  items: integer('items'),
  tags: text('tags'),
  currency: text('currency'),
  discount: numericNumber('discount'),
  lineItems: jsonb('line_items'),
  billingAddress: jsonb('billing_address'),
  shippingAddress: jsonb('shipping_address'),
  isBooking: boolean('is_booking'),
  advancePaid: numericNumber('advance_paid'),
}, (table) => ({
  shopifyIdIdx: uniqueIndex('sales_orders_shopify_id_idx').on(table.shopifyId),
  internalIdIdx: index('sales_orders_internal_id_idx').on(table.internalId),
  customerIdx: index('sales_orders_customer_idx').on(table.customer),
  dateIdx: index('sales_orders_date_idx').on(table.date),
  statusIdx: index('sales_orders_status_idx').on(table.status),
}))

export const salesInvoices = pgTable('sales_invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  shopifyOrder: text('shopify_order'),
  customer: text('customer'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerCity: text('customer_city'),
  customerState: text('customer_state'),
  customerPincode: text('customer_pincode'),
  silverValue: numericNumber('silver_value'),
  makingCharge: numericNumber('making_charge'),
  subtotal: numericNumber('subtotal'),
  gst: numericNumber('gst'),
  gstAmount: numericNumber('gst_amount'),
  discount: numericNumber('discount'),
  grandTotal: numericNumber('grand_total'),
  paymentMethod: text('payment_method'),
  paymentStatus: text('payment_status'),
  paymentId: text('payment_id'),
  status: text('status'),
  date: ts('date'),
  dueDate: ts('due_date'),
}, (table) => ({
  numberIdx: uniqueIndex('sales_invoices_number_idx').on(table.number),
  shopifyOrderIdx: index('sales_invoices_shopify_order_idx').on(table.shopifyOrder),
  customerIdx: index('sales_invoices_customer_idx').on(table.customer),
  dateIdx: index('sales_invoices_date_idx').on(table.date),
  paymentStatusIdx: index('sales_invoices_payment_status_idx').on(table.paymentStatus),
  statusIdx: index('sales_invoices_status_idx').on(table.status),
}))

export const salesInvoiceItems = pgTable('sales_invoice_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  product: text('product'),
  sku: text('sku'),
  qty: integer('qty'),
  weight: numericNumber('weight'),
  silverRate: numericNumber('silver_rate'),
  makingCharge: numericNumber('making_charge'),
  tax: numericNumber('tax'),
  amount: numericNumber('amount'),
}, (table) => ({
  invoiceIdIdx: index('sales_invoice_items_invoice_id_idx').on(table.invoiceId),
  skuIdx: index('sales_invoice_items_sku_idx').on(table.sku),
  invoiceFk: foreignKey({ columns: [table.invoiceId], foreignColumns: [salesInvoices.id], name: 'sales_invoice_items_invoice_id_fk' }).onDelete('cascade'),
}))

export const purchaseOrders = pgTable('purchase_orders', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  supplier: text('supplier'),
  items: integer('items'),
  qty: integer('qty'),
  weight: numericNumber('weight'),
  value: numericNumber('value'),
  status: text('status'),
  date: ts('date'),
}, (table) => ({
  numberIdx: uniqueIndex('purchase_orders_number_idx').on(table.number),
  supplierIdx: index('purchase_orders_supplier_idx').on(table.supplier),
  dateIdx: index('purchase_orders_date_idx').on(table.date),
}))

export const purchaseInvoices = pgTable('purchase_invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  supplier: text('supplier'),
  items: integer('items'),
  qty: integer('qty'),
  weight: numericNumber('weight'),
  rate: numericNumber('rate'),
  cost: numericNumber('cost'),
  tax: numericNumber('tax'),
  total: numericNumber('total'),
  status: text('status'),
  date: ts('date'),
}, (table) => ({
  numberIdx: uniqueIndex('purchase_invoices_number_idx').on(table.number),
  supplierIdx: index('purchase_invoices_supplier_idx').on(table.supplier),
  dateIdx: index('purchase_invoices_date_idx').on(table.date),
}))

export const salesReturns = pgTable('sales_returns', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  invoiceId: text('invoice_id'),
  creditNoteNumber: text('credit_note_number'),
  restocked: boolean('restocked'),
  returnItems: jsonb('return_items'),
  order: text('order'),
  customer: text('customer'),
  items: integer('items'),
  amount: numericNumber('amount'),
  status: text('status'),
  date: ts('date'),
}, (table) => ({
  numberIdx: uniqueIndex('sales_returns_number_idx').on(table.number),
  customerIdx: index('sales_returns_customer_idx').on(table.customer),
  dateIdx: index('sales_returns_date_idx').on(table.date),
}))

export const purchaseReturns = pgTable('purchase_returns', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  supplier: text('supplier'),
  items: integer('items'),
  weight: numericNumber('weight'),
  amount: numericNumber('amount'),
  status: text('status'),
  date: ts('date'),
}, (table) => ({
  numberIdx: uniqueIndex('purchase_returns_number_idx').on(table.number),
  supplierIdx: index('purchase_returns_supplier_idx').on(table.supplier),
  dateIdx: index('purchase_returns_date_idx').on(table.date),
}))

export const inventoryLocations = pgTable('inventory_locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type'),
  city: text('city'),
  manager: text('manager'),
}, (table) => ({
  nameIdx: uniqueIndex('inventory_locations_name_idx').on(table.name),
}))

export const stockTransfers = pgTable('stock_transfers', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  from: text('from'),
  to: text('to'),
  product: text('product'),
  sku: text('sku'),
  qty: integer('qty'),
  weight: numericNumber('weight'),
  initiatedBy: text('initiated_by'),
  status: text('status'),
  date: ts('date'),
}, (table) => ({
  numberIdx: uniqueIndex('stock_transfers_number_idx').on(table.number),
  skuIdx: index('stock_transfers_sku_idx').on(table.sku),
  dateIdx: index('stock_transfers_date_idx').on(table.date),
}))

export const bankAccounts = pgTable('bank_accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  bank: text('bank'),
  accountNumber: text('account_number'),
  accountNumberEncrypted: text('account_number_encrypted'),
  balance: numericNumber('balance'),
  ifsc: text('ifsc'),
}, (table) => ({
  nameIdx: uniqueIndex('bank_accounts_name_idx').on(table.name),
}))

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  date: date('date'),
  description: text('description'),
  ref: text('ref'),
  debit: numericNumber('debit'),
  credit: numericNumber('credit'),
}, (table) => ({
  dateIdx: index('ledger_entries_date_idx').on(table.date),
  refIdx: index('ledger_entries_ref_idx').on(table.ref),
}))

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  category: text('category'),
  description: text('description'),
  amount: numericNumber('amount'),
  paymentMethod: text('payment_method'),
  date: ts('date'),
  status: text('status'),
  by: text('by'),
}, (table) => ({
  dateIdx: index('expenses_date_idx').on(table.date),
  categoryIdx: index('expenses_category_idx').on(table.category),
  statusIdx: index('expenses_status_idx').on(table.status),
}))

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  ref: text('ref'),
  invoice: text('invoice'),
  customer: text('customer'),
  amount: numericNumber('amount'),
  method: text('method'),
  gateway: text('gateway'),
  status: text('status'),
  date: ts('date'),
  reconciled: boolean('reconciled'),
}, (table) => ({
  refIdx: index('payments_ref_idx').on(table.ref),
  invoiceIdx: index('payments_invoice_idx').on(table.invoice),
  customerIdx: index('payments_customer_idx').on(table.customer),
  dateIdx: index('payments_date_idx').on(table.date),
  reconciledIdx: index('payments_reconciled_idx').on(table.reconciled),
}))

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  timestamp: ts('timestamp'),
  user: text('user'),
  action: text('action'),
  module: text('module'),
  entity: text('entity'),
  changes: text('changes'),
  ip: text('ip'),
}, (table) => ({
  timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  userIdx: index('audit_logs_user_idx').on(table.user),
  moduleIdx: index('audit_logs_module_idx').on(table.module),
}))

export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  timestamp: ts('timestamp'),
  user: text('user'),
  userId: text('user_id'),
  role: text('role'),
  action: text('action'),
  module: text('module'),
  entity: text('entity'),
  details: text('details'),
  ip: text('ip'),
}, (table) => ({
  timestampIdx: index('activity_logs_timestamp_idx').on(table.timestamp),
  userIdIdx: index('activity_logs_user_id_idx').on(table.userId),
  moduleIdx: index('activity_logs_module_idx').on(table.module),
}))

export const syncLogs = pgTable('sync_logs', {
  id: text('id').primaryKey(),
  entity: text('entity'),
  shopifyId: text('shopify_id'),
  direction: text('direction'),
  action: text('action'),
  status: text('status'),
  time: ts('time'),
  error: text('error'),
  retry: boolean('retry'),
}, (table) => ({
  timeIdx: index('sync_logs_time_idx').on(table.time),
  entityIdx: index('sync_logs_entity_idx').on(table.entity),
  shopifyIdIdx: index('sync_logs_shopify_id_idx').on(table.shopifyId),
}))

export const silverRates = pgTable('silver_rates', {
  id: text('id').primaryKey(),
  purity: numericNumber('purity'),
  rate: numericNumber('rate'),
  previousRate: numericNumber('previous_rate'),
  updatedAt: ts('updated_at'),
  change: numericNumber('change'),
  changePercent: numericNumber('change_percent'),
  currency: text('currency'),
}, (table) => ({
  updatedAtIdx: index('silver_rates_updated_at_idx').on(table.updatedAt),
}))

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  businessName: text('business_name'),
  gstin: text('gstin'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  defaultPurity: numericNumber('default_purity'),
  makingCharge: numericNumber('making_charge'),
  gstRate: numericNumber('gst_rate'),
  currency: text('currency'),
  invoicePrefix: text('invoice_prefix'),
  rateSource: text('rate_source'),
  autoUpdateMcx: boolean('auto_update_mcx'),
  requireRateApproval: boolean('require_rate_approval'),
  autoReconcileRazorpay: boolean('auto_reconcile_razorpay'),
  notificationSettings: jsonb('notification_settings'),
  paymentReminders: boolean('payment_reminders'),
  lowStockAlerts: boolean('low_stock_alerts'),
  dailySummary: boolean('daily_summary'),
  orderImports: boolean('order_imports'),
  shopifyStoreUrlEncrypted: text('shopify_store_url_encrypted'),
  shopifyAccessTokenEncrypted: text('shopify_access_token_encrypted'),
  shopifyApiVersion: text('shopify_api_version'),
  webhookSecretEncrypted: text('webhook_secret_encrypted'),
  dbHostEncrypted: text('db_host_encrypted'),
  dbPortEncrypted: text('db_port_encrypted'),
  dbDatabaseEncrypted: text('db_database_encrypted'),
  dbUserEncrypted: text('db_user_encrypted'),
  dbPasswordEncrypted: text('db_password_encrypted'),
  updatedAt: ts('updated_at'),
})

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: ts('created_at'),
  expiresAt: ts('expires_at'),
}, (table) => [
  index('sessions_expires_at_idx').on(table.expiresAt),
])

export const loginAttempts = pgTable('login_attempts', {
  identifier: text('identifier').primaryKey(),
  count: integer('count').notNull().default(0),
  lastAttempt: ts('last_attempt'),
})

import { sql } from 'drizzle-orm'