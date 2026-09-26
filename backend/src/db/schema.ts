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
  metal: text('metal').default('silver'),
  purity: numericNumber('purity'),
  purityLabel: text('purity_label'),
  grossWeight: numericNumber('gross_weight'),
  stoneWeight: numericNumber('stone_weight'),
  diamondWeight: numericNumber('diamond_weight'),
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
  branchId: text('branch_id'),
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
  customerShopifyId: text('customer_shopify_id'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
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
  customerShopifyIdIdx: index('sales_orders_customer_shopify_id_idx').on(table.customerShopifyId),
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
  tdsType: text('tds_type').default('none'),
  tdsRate: numericNumber('tds_rate'),
  tdsAmount: numericNumber('tds_amount'),
  tdsSection: text('tds_section'),
  buyerGstin: text('buyer_gstin'),
  irn: text('irn'),
  irnDate: ts('irn_date'),
  qrCode: text('qr_code'),
  paymentMethod: text('payment_method'),
  paymentStatus: text('payment_status'),
  paymentId: text('payment_id'),
  status: text('status'),
  date: ts('date'),
  dueDate: ts('due_date'),
  currency: text('currency').default('INR'),
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

export const orderEvents = pgTable('order_events', {
  id: text('id').primaryKey(),
  orderId: text('order_id'),
  event: text('event'),
  details: text('details'),
  actor: text('actor'),
  createdAt: ts('created_at'),
}, (table) => ({
  orderIdIdx: index('order_events_order_id_idx').on(table.orderId),
  createdIdx: index('order_events_created_idx').on(table.createdAt),
}))

export const shipments = pgTable('shipments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  orderRef: text('order_ref'),
  customer: text('customer'),
  courier: text('courier'),
  trackingNumber: text('tracking_number'),
  status: text('status').notNull().default('pending'),
  dispatchedAt: ts('dispatched_at'),
  expectedDelivery: date('expected_delivery'),
  deliveredAt: ts('delivered_at'),
  notes: text('notes'),
  createdAt: ts('created_at'),
}, (table) => ({
  orderIdIdx: index('shipments_order_id_idx').on(table.orderId),
}))

export const notificationLog = pgTable('notification_log', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  channel: text('channel').notNull(),
  recipient: text('recipient'),
  ref: text('ref'),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: ts('created_at'),
}, (table) => ({
  createdIdx: index('notification_log_created_idx').on(table.createdAt),
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

export const goldRates = pgTable('gold_rates', {
  id: text('id').primaryKey(),
  rate: numeric('rate').notNull(),
  purity: numeric('purity').notNull().default('99.9'),
  currency: text('currency').notNull().default('INR'),
  source: text('source'),
  updatedAt: ts('updated_at').defaultNow(),
}, (table) => ({
  updatedAtIdx: index('gold_rates_updated_at_idx').on(table.updatedAt),
}))

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  businessName: text('business_name'),
  gstin: text('gstin'),
  pan: text('pan'),
  tdsEnabled: boolean('tds_enabled').default(false),
  tcsEnabled: boolean('tcs_enabled').default(false),
  defaultTdsSection: text('default_tds_section'),
  einvoiceEnabled: boolean('einvoice_enabled').default(false),
  ewayBillEnabled: boolean('eway_bill_enabled').default(false),
  upiId: text('upi_id'),
  upiMerchantName: text('upi_merchant_name'),
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

export const quotations = pgTable('quotations', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  customer: text('customer'),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  customerAddress: text('customer_address'),
  customerCity: text('customer_city'),
  customerState: text('customer_state'),
  customerPincode: text('customer_pincode'),
  subtotal: numericNumber('subtotal'),
  gst: numericNumber('gst'),
  gstAmount: numericNumber('gst_amount'),
  discount: numericNumber('discount'),
  grandTotal: numericNumber('grand_total'),
  notes: text('notes'),
  status: text('status').notNull().default('draft'),
  validUntil: ts('valid_until'),
  convertedInvoice: text('converted_invoice'),
  convertedAt: ts('converted_at'),
  createdBy: text('created_by'),
  date: ts('date').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at'),
  currency: text('currency').default('INR'),
}, (table) => ({
  statusIdx: index('quotations_status_idx').on(table.status),
  customerIdx: index('quotations_customer_idx').on(table.customer),
  dateIdx: index('quotations_date_idx').on(table.date),
}))

export const quotationItems = pgTable('quotation_items', {
  id: text('id').primaryKey(),
  quotationId: text('quotation_id').notNull(),
  product: text('product'),
  sku: text('sku'),
  qty: integer('qty'),
  weight: numericNumber('weight'),
  silverRate: numericNumber('silver_rate'),
  makingCharge: numericNumber('making_charge'),
  amount: numericNumber('amount'),
}, (table) => ({
  quotationIdIdx: index('quotation_items_quotation_id_idx').on(table.quotationId),
  skuIdx: index('quotation_items_sku_idx').on(table.sku),
  quotationFk: foreignKey({ columns: [table.quotationId], foreignColumns: [quotations.id], name: 'quotation_items_quotation_id_fk' }).onDelete('cascade'),
}))

import { sql } from 'drizzle-orm'
// ─── Loyalty points ─────────────────────────────────────────────────────────

// ─── Batch / lot tracking ──────────────────────────────────────────────────

export const batches = pgTable('batches', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  batchNumber: text('batch_number').notNull(),
  quantity: integer('quantity').notNull().default(0),
  costPrice: numericNumber('cost_price'),
  manufacturingDate: date('manufacturing_date'),
  expiryDate: date('expiry_date'),
  supplier: text('supplier'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  productIdx: index('batches_product_idx').on(table.productId),
  batchNumberIdx: index('batches_number_idx').on(table.batchNumber),
}))

// ─── Manufacturing / BOM ──────────────────────────────────────────────────

export const boms = pgTable('boms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  productId: text('product_id'),
  description: text('description'),
  yieldQty: integer('yield_qty').default(1),
  totalCost: numericNumber('total_cost'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  productIdx: index('boms_product_idx').on(table.productId),
}))

export const bomItems = pgTable('bom_items', {
  id: text('id').primaryKey(),
  bomId: text('bom_id').notNull(),
  productId: text('product_id').notNull(),
  quantity: numericNumber('quantity'),
  unit: text('unit').default('g'),
  wastagePercent: numericNumber('wastage_percent'),
  cost: numericNumber('cost'),
}, (table) => ({
  bomIdx: index('bom_items_bom_idx').on(table.bomId),
}))

// ─── Karigar (artisan / worker) ───────────────────────────────────────────

export const karigars = pgTable('karigars', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  specialty: text('specialty'),
  rate: numericNumber('rate'),
  rateType: text('rate_type').default('per_gram'),
  balance: numericNumber('balance'),
  address: text('address'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
})

// ─── Multi-branch ─────────────────────────────────────────────────────────

export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  address: text('address'),
  phone: text('phone'),
  managerName: text('manager_name'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  invoiceId: text('invoice_id'),
  invoiceNumber: text('invoice_number'),
  type: text('type').notNull(), // 'earn' | 'redeem' | 'adjust'
  points: numericNumber('points').notNull(), // positive earn, negative redeem
  balanceAfter: numericNumber('balance_after'),
  note: text('note'),
  createdBy: text('created_by'),
  date: ts('date').notNull().defaultNow(),
}, (table) => ({
  customerIdx: index('loyalty_transactions_customer_id_idx').on(table.customerId),
  invoiceIdx: index('loyalty_transactions_invoice_id_idx').on(table.invoiceId),
  dateIdx: index('loyalty_transactions_date_idx').on(table.date),
}))

// ─── Multi-currency support ─────────────────────────────────────────────────

export const currencies = pgTable('currencies', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  exchangeRate: numericNumber('exchange_rate'),
  isActive: boolean('is_active').default(true),
  updatedAt: ts('updated_at').defaultNow(),
})

// ─── Double-entry accounting ──────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  subType: text('sub_type'),
  parentId: text('parent_id'),
  isGroup: boolean('is_group').default(false),
  openingBalance: numericNumber('opening_balance').default(0),
  currentBalance: numericNumber('current_balance').default(0),
  currency: text('currency').default('INR'),
  branchId: text('branch_id'),
  isActive: boolean('is_active').default(true),
  createdAt: ts('created_at'),
}, (table) => ({
  typeIdx: index('accounts_type_idx').on(table.type),
}))

export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  entryNumber: text('entry_number').notNull().unique(),
  date: date('date').notNull(),
  description: text('description'),
  reference: text('reference'),
  referenceType: text('reference_type'),
  referenceId: text('reference_id'),
  isAuto: boolean('is_auto').default(true),
  branchId: text('branch_id'),
  createdBy: text('created_by'),
  createdAt: ts('created_at'),
}, (table) => ({
  dateIdx: index('journal_entries_date_idx').on(table.date),
  refIdx: index('journal_entries_ref_idx').on(table.referenceType, table.referenceId),
}))

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: text('id').primaryKey(),
  journalEntryId: text('journal_entry_id').notNull(),
  accountId: text('account_id').notNull(),
  debit: numericNumber('debit').default(0),
  credit: numericNumber('credit').default(0),
  description: text('description'),
  branchId: text('branch_id'),
}, (table) => ({
  entryIdx: index('jel_entry_idx').on(table.journalEntryId),
  accountIdx: index('jel_account_idx').on(table.accountId),
}))

export const financialPeriods = pgTable('financial_periods', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  isOpen: boolean('is_open').default(true),
  closedAt: timestamp('closed_at'),
})
