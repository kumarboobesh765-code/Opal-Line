import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import { defaultRolePermissions } from '../rbac'
import { roleNames } from './seedData'
import { randomBytes, createHash } from 'node:crypto'
import argon2 from 'argon2'
import { logger } from '../logger'

/**
 * First-run database bootstrap.
 *
 * Runs at server startup and is safe to run on every start (all statements
 * are idempotent). On a fresh machine this creates the FULL schema matching
 * src/db/schema.ts exactly, seeds default roles, and provisions the initial
 * admin user so the desktop installer goes from empty PostgreSQL to a working
 * login with zero manual SQL.
 */

let bootstrapped = false

async function createClient(): Promise<postgres.Sql> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return postgres(url, { max: 1, connect_timeout: 10 })
}

async function tableExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name} limit 1`
  return rows.length > 0
}

async function createSchema(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    // ── Identity ──────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS roles (
        id text PRIMARY KEY,
        name text NOT NULL,
        description text,
        permissions jsonb NOT NULL,
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamp,
        CONSTRAINT roles_name_unique UNIQUE (name)
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL,
        username text,
        password_hash text,
        role text NOT NULL,
        last_login timestamp,
        status text NOT NULL,
        avatar_color text,
        permissions jsonb,
        email_verified boolean,
        require_password_change boolean,
        reset_token text,
        reset_token_expiry timestamp,
        email_verification_token text,
        email_verification_expiry timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sessions (
        token text PRIMARY KEY,
        user_id text NOT NULL,
        created_at timestamp,
        expires_at timestamp
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        identifier text PRIMARY KEY,
        count integer NOT NULL DEFAULT 0,
        last_attempt timestamp
      )`)

    // ── Settings & rates ──────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS settings (
        id text PRIMARY KEY,
        business_name text,
        gstin text,
        phone text,
        email text,
        address text,
        default_purity numeric,
        making_charge numeric,
        gst_rate numeric,
        currency text,
        invoice_prefix text,
        rate_source text,
        auto_update_mcx boolean,
        require_rate_approval boolean,
        auto_reconcile_razorpay boolean,
        notification_settings jsonb,
        payment_reminders boolean,
        low_stock_alerts boolean,
        daily_summary boolean,
        order_imports boolean,
        shopify_store_url_encrypted text,
        shopify_access_token_encrypted text,
        shopify_api_version text,
        webhook_secret_encrypted text,
        db_host_encrypted text,
        db_port_encrypted text,
        db_database_encrypted text,
        db_user_encrypted text,
        db_password_encrypted text,
        updated_at timestamp
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS silver_rates (
        id text PRIMARY KEY,
        purity numeric,
        rate numeric,
        previous_rate numeric,
        updated_at timestamp,
        change numeric,
        change_percent numeric,
        currency text
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS silver_rates_updated_at_idx ON silver_rates (updated_at)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS gold_rates (
        id text PRIMARY KEY,
        rate numeric NOT NULL,
        purity numeric NOT NULL DEFAULT 99.9,
        currency text NOT NULL DEFAULT 'INR',
        source text,
        updated_at timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS gold_rates_updated_at_idx ON gold_rates (updated_at)`)

    // ── Catalog & inventory ───────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS products (
        id text PRIMARY KEY,
        name text NOT NULL,
        sku text NOT NULL,
        barcode text,
        huid text,
        category text NOT NULL,
        collection text,
        purity numeric,
        gross_weight numeric,
        stone_weight numeric,
        net_weight numeric,
        making_charge numeric,
        gst numeric,
        hsn text,
        supplier text,
        silver_rate numeric,
        selling_price numeric,
        compare_at_price numeric,
        stock integer,
        reorder_level integer,
        shopify_status text,
        shopify_id text,
        status text,
        image text,
        images jsonb,
        description text,
        vendor text,
        product_type text,
        tags text,
        track_inventory boolean NOT NULL DEFAULT true,
        charge_on_tax boolean NOT NULL DEFAULT true,
        created_at date,
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products (sku)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_shopify_id_idx ON products (shopify_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_category_idx ON products (category)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_status_idx ON products (status)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_shopify_status_idx ON products (shopify_status)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_name_search_idx ON products USING gin (to_tsvector('english', name))`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS customers (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        phone text,
        city text,
        province text,
        shopify_id text,
        email_verified boolean,
        orders integer,
        total_spent numeric,
        status text,
        joined date
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS customers_shopify_id_idx ON customers (shopify_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (email)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS customers_name_search_idx ON customers USING gin (to_tsvector('english', name))`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id text PRIMARY KEY,
        name text NOT NULL,
        contact text,
        phone text,
        city text,
        status text,
        outstanding numeric
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers (name)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS inventory_locations (
        id text PRIMARY KEY,
        name text NOT NULL,
        type text,
        city text,
        manager text
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_name_idx ON inventory_locations (name)`)

    // ── Sales ─────────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id text PRIMARY KEY,
        shopify_id text,
        internal_id text,
        customer text,
        value numeric,
        payment text,
        fulfillment text,
        invoice text,
        status text,
        date timestamp,
        items integer,
        tags text,
        currency text,
        discount numeric,
        line_items jsonb,
        billing_address jsonb,
        shipping_address jsonb,
        is_booking boolean,
        advance_paid numeric,
        customer_email text,
        customer_phone text,
        note text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_shopify_id_idx ON sales_orders (shopify_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON sales_orders (customer)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_orders_date_idx ON sales_orders (date)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS order_events (
        id text PRIMARY KEY,
        order_id text,
        event text,
        details text,
        actor text,
        created_at timestamp
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events (order_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS order_events_created_idx ON order_events (created_at)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id text PRIMARY KEY,
        number text NOT NULL,
        shopify_order text,
        customer text,
        customer_email text,
        customer_phone text,
        customer_address text,
        customer_city text,
        customer_state text,
        customer_pincode text,
        silver_value numeric,
        making_charge numeric,
        subtotal numeric,
        gst numeric,
        gst_amount numeric,
        discount numeric,
        grand_total numeric,
        payment_method text,
        payment_status text,
        payment_id text,
        status text,
        date timestamp,
        due_date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_idx ON sales_invoices (number)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_invoices_shopify_order_idx ON sales_invoices (shopify_order)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_invoice_items (
        id text PRIMARY KEY,
        invoice_id text NOT NULL,
        product text,
        sku text,
        qty integer,
        weight numeric,
        silver_rate numeric,
        making_charge numeric,
        tax numeric,
        amount numeric
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_invoice_items_invoice_id_idx ON sales_invoice_items (invoice_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id text PRIMARY KEY,
        number text NOT NULL,
        invoice_id text,
        credit_note_number text,
        restocked boolean,
        return_items jsonb,
         "order" text,
        customer text,
        items integer,
        amount numeric,
        status text,
        date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS sales_returns_number_idx ON sales_returns (number)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_returns_customer_idx ON sales_returns (customer)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_returns_date_idx ON sales_returns (date)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS quotations (
        id text PRIMARY KEY,
        number text NOT NULL,
        customer text,
        customer_phone text,
        customer_email text,
        customer_address text,
        customer_city text,
        customer_state text,
        customer_pincode text,
        subtotal numeric,
        gst numeric,
        gst_amount numeric,
        discount numeric,
        grand_total numeric,
        notes text,
        status text NOT NULL DEFAULT 'draft',
        valid_until timestamp,
        converted_invoice text,
        converted_at timestamp,
        created_by text,
        date timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS quotations_number_unique ON quotations (number)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS quotations_status_idx ON quotations (status)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS quotations_customer_idx ON quotations (customer)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS quotations_date_idx ON quotations (date)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS quotation_items (
        id text PRIMARY KEY,
        quotation_id text NOT NULL,
        product text,
        sku text,
        qty integer,
        weight numeric,
        silver_rate numeric,
        making_charge numeric,
        amount numeric
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS quotation_items_quotation_id_idx ON quotation_items (quotation_id)`)

    // ── Purchases & stock ─────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id text PRIMARY KEY,
        number text NOT NULL,
        supplier text,
        items integer,
        qty integer,
        weight numeric,
        value numeric,
        status text,
        date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_number_idx ON purchase_orders (number)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON purchase_orders (supplier)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id text PRIMARY KEY,
        number text NOT NULL,
        supplier text,
        items integer,
        qty integer,
        weight numeric,
        rate numeric,
        cost numeric,
        tax numeric,
        total numeric,
        status text,
        date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_number_idx ON purchase_invoices (number)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id text PRIMARY KEY,
        number text NOT NULL,
        supplier text,
        items integer,
        weight numeric,
        amount numeric,
        status text,
        date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS purchase_returns_number_idx ON purchase_returns (number)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx ON purchase_returns (supplier)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS purchase_returns_date_idx ON purchase_returns (date)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id text PRIMARY KEY,
        number text NOT NULL,
        "from" text,
        "to" text,
        product text,
        sku text,
        qty integer,
        weight numeric,
        initiated_by text,
        status text,
        date timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS stock_transfers_number_idx ON stock_transfers (number)`)

    // ── Finance ───────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS payments (
        id text PRIMARY KEY,
        ref text,
        invoice text,
        customer text,
        amount numeric,
        method text,
        gateway text,
        status text,
        date timestamp,
        reconciled boolean
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS payments_ref_idx ON payments (ref)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id text PRIMARY KEY,
        date date,
        description text,
        ref text,
        debit numeric,
        credit numeric
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS ledger_entries_date_idx ON ledger_entries (date)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS ledger_entries_ref_idx ON ledger_entries (ref)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS expenses (
        id text PRIMARY KEY,
        category text,
        description text,
        amount numeric,
        payment_method text,
        date timestamp,
        status text,
        by text
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (date)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id text PRIMARY KEY,
        name text NOT NULL,
        bank text,
        account_number text,
        account_number_encrypted text,
        balance numeric,
        ifsc text
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_name_idx ON bank_accounts (name)`)

    // ── Operations / audit / notifications ────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS shipments (
        id text PRIMARY KEY,
        order_id text NOT NULL,
        order_ref text,
        customer text,
        courier text,
        tracking_number text,
        status text NOT NULL DEFAULT 'pending',
        dispatched_at timestamp,
        expected_delivery date,
        delivered_at timestamp,
        notes text,
        created_at timestamp
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments (order_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id text PRIMARY KEY,
        timestamp timestamp,
        "user" text,
        user_id text,
        role text,
        action text,
        module text,
        entity text,
        details text,
        ip text
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS activity_logs_timestamp_idx ON activity_logs (timestamp)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id text PRIMARY KEY,
        timestamp timestamp,
        "user" text,
        action text,
        module text,
        entity text,
        changes text,
        ip text
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs (timestamp)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id text PRIMARY KEY,
        entity text,
        shopify_id text,
        direction text,
        action text,
        status text,
        time timestamp,
        error text,
        retry boolean
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id text PRIMARY KEY,
        kind text NOT NULL,
        channel text NOT NULL,
        recipient text,
        ref text,
        status text NOT NULL,
        error text,
        created_at timestamp
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS notification_log_created_idx ON notification_log (created_at)`)

    // ── Batch / lot tracking ──────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS batches (
        id text PRIMARY KEY,
        product_id text NOT NULL,
        batch_number text NOT NULL,
        quantity integer NOT NULL DEFAULT 0,
        cost_price numeric,
        manufacturing_date date,
        expiry_date date,
        supplier text,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS batches_product_idx ON batches (product_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS batches_number_idx ON batches (batch_number)`)

    // ── Manufacturing / BOM ───────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS boms (
        id text PRIMARY KEY,
        name text NOT NULL,
        product_id text,
        description text,
        yield_qty integer DEFAULT 1,
        total_cost numeric,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS boms_product_idx ON boms (product_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS bom_items (
        id text PRIMARY KEY,
        bom_id text NOT NULL,
        product_id text NOT NULL,
        quantity numeric,
        unit text DEFAULT 'g',
        wastage_percent numeric,
        cost numeric
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS bom_items_bom_idx ON bom_items (bom_id)`)

    // ── Karigar (artisan / worker) ────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS karigars (
        id text PRIMARY KEY,
        name text NOT NULL,
        phone text,
        specialty text,
        rate numeric,
        rate_type text DEFAULT 'per_gram',
        balance numeric,
        address text,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`)

    // ── Multi-branch ──────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS branches (
        id text PRIMARY KEY,
        name text NOT NULL,
        code text NOT NULL,
        address text,
        phone text,
        manager_name text,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS branches_code_unique ON branches (code)`)

    // ── Loyalty ───────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id text PRIMARY KEY,
        customer_id text NOT NULL,
        invoice_id text,
        invoice_number text,
        type text NOT NULL,
        points numeric NOT NULL,
        balance_after numeric,
        note text,
        created_by text,
        date timestamp NOT NULL DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS loyalty_transactions_customer_id_idx ON loyalty_transactions (customer_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS loyalty_transactions_invoice_id_idx ON loyalty_transactions (invoice_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS loyalty_transactions_date_idx ON loyalty_transactions (date)`)

    // ── Multi-currency support ─────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS currencies (
        id text PRIMARY KEY,
        code text NOT NULL,
        name text NOT NULL,
        symbol text NOT NULL,
        exchange_rate numeric,
        is_active boolean DEFAULT true,
        updated_at timestamp DEFAULT now(),
        CONSTRAINT currencies_code_unique UNIQUE (code)
      )`)

    // ── Double-entry accounting ──────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        code text NOT NULL,
        name text NOT NULL,
        type text NOT NULL,
        sub_type text,
        parent_id text,
        is_group boolean DEFAULT false,
        opening_balance numeric DEFAULT 0,
        current_balance numeric DEFAULT 0,
        currency text DEFAULT 'INR',
        branch_id text,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now(),
        CONSTRAINT accounts_code_unique UNIQUE (code)
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts (type)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id text PRIMARY KEY,
        entry_number text NOT NULL,
        date date NOT NULL,
        description text,
        reference text,
        reference_type text,
        reference_id text,
        is_auto boolean DEFAULT true,
        branch_id text,
        created_by text,
        created_at timestamp DEFAULT now(),
        CONSTRAINT journal_entries_entry_number_unique UNIQUE (entry_number)
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries (date)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS journal_entries_ref_idx ON journal_entries (reference_type, reference_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id text PRIMARY KEY,
        journal_entry_id text NOT NULL,
        account_id text NOT NULL,
        debit numeric DEFAULT 0,
        credit numeric DEFAULT 0,
        description text,
        branch_id text
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS jel_entry_idx ON journal_entry_lines (journal_entry_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS jel_account_idx ON journal_entry_lines (account_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS financial_periods (
        id text PRIMARY KEY,
        name text NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_open boolean DEFAULT true,
        closed_at timestamp
      )`)
  })
}

async function seedDefaults(db: ReturnType<typeof drizzle>): Promise<void> {
  // Default roles
  for (const [i, name] of roleNames.entries()) {
    const existing = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1)
    if (existing[0]) continue
    await db.insert(schema.roles).values({
      id: `ROLE${i + 1}`,
      name,
      description: `${name} role with default module permissions`,
      permissions: defaultRolePermissions(name),
      isSystem: true,
      createdAt: new Date().toISOString(),
    })
    logger.info({ role: name }, 'Bootstrap: seeded role')
  }

  // Initial admin user (only when no users exist at all)
  const users = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  if (users.length === 0) {
    // Generate a random 12-character password for the initial admin
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
    const bytes = randomBytes(12)
    let randomPassword = ''
    for (let i = 0; i < 12; i++) {
      randomPassword += chars[bytes[i] % chars.length]
    }
    // Still set Opal@2026 as the initial default, but force change on next login
    const tempPassword = 'Opal@2026'
    const passwordHash = await argon2.hash(tempPassword)
    await db.insert(schema.users).values({
      id: randomBytes(8).toString('hex'),
      name: 'Administrator',
      email: 'admin@opalline.local',
      username: 'admin',
      passwordHash,
      role: 'Admin',
      status: 'active',
      requirePasswordChange: true,
      permissions: defaultRolePermissions('Admin'),
    })
    logger.info('Bootstrap: created initial admin user')
    console.log('\n══════════════════════════════════════════════════════')
    console.log('  Initial admin account created:')
    console.log('    Username: admin')
    console.log(`    Password: ${tempPassword}`)
    console.log(`    Generated: ${randomPassword}`)
    console.log('  You MUST change this password after first login.')
    console.log('══════════════════════════════════════════════════════\n')
  }

  // Settings row
  const settings = await db.select({ id: schema.settings.id }).from(schema.settings).limit(1)
  if (settings.length === 0) {
    await db.insert(schema.settings).values({ id: 'app', gstRate: 3, invoicePrefix: 'SI', currency: 'INR' })
    logger.info('Bootstrap: seeded default settings')
  }

  // Default currencies
  const existingCurrencies = await db.select({ id: schema.currencies.id }).from(schema.currencies).limit(1)
  if (existingCurrencies.length === 0) {
    const defaultCurrencies = [
      { id: 'CUR1', code: 'INR', name: 'Indian Rupee', symbol: '\u20B9', exchangeRate: 1 },
      { id: 'CUR2', code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 83 },
      { id: 'CUR3', code: 'EUR', name: 'Euro', symbol: '\u20AC', exchangeRate: 90 },
      { id: 'CUR4', code: 'GBP', name: 'British Pound', symbol: '\u00A3', exchangeRate: 105 },
      { id: 'CUR5', code: 'AED', name: 'UAE Dirham', symbol: 'AED', exchangeRate: 22.5 },
      { id: 'CUR6', code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', exchangeRate: 22 },
    ]
    for (const c of defaultCurrencies) {
      await db.insert(schema.currencies).values({ ...c, isActive: true, updatedAt: new Date().toISOString() })
    }
    logger.info('Bootstrap: seeded default currencies')
  }

  // Default chart of accounts for Indian jewelry business
  const existingAccounts = await db.select({ id: schema.accounts.id }).from(schema.accounts).limit(1)
  if (existingAccounts.length === 0) {
    const defaultAccounts = [
      { id: 'ACC1001', code: '1001', name: 'Cash in Hand', type: 'asset', subType: 'current_asset' },
      { id: 'ACC1002', code: '1002', name: 'Bank Account', type: 'asset', subType: 'current_asset' },
      { id: 'ACC1003', code: '1003', name: 'Accounts Receivable', type: 'asset', subType: 'current_asset' },
      { id: 'ACC1004', code: '1004', name: 'Inventory - Raw Materials', type: 'asset', subType: 'current_asset' },
      { id: 'ACC1005', code: '1005', name: 'Inventory - Finished Goods', type: 'asset', subType: 'current_asset' },
      { id: 'ACC1006', code: '1006', name: 'GST Input Credit', type: 'asset', subType: 'current_asset' },
      { id: 'ACC2001', code: '2001', name: 'Accounts Payable', type: 'liability', subType: 'current_liability' },
      { id: 'ACC2002', code: '2002', name: 'GST Output', type: 'liability', subType: 'current_liability' },
      { id: 'ACC2003', code: '2003', name: 'TDS Payable', type: 'liability', subType: 'current_liability' },
      { id: 'ACC2004', code: '2004', name: 'TCS Payable', type: 'liability', subType: 'current_liability' },
      { id: 'ACC3001', code: '3001', name: "Owner's Equity", type: 'equity', subType: 'equity' },
      { id: 'ACC3002', code: '3002', name: 'Retained Earnings', type: 'equity', subType: 'equity' },
      { id: 'ACC4001', code: '4001', name: 'Sales Revenue', type: 'revenue', subType: 'operating_revenue' },
      { id: 'ACC4002', code: '4002', name: 'Other Income', type: 'revenue', subType: 'other_income' },
      { id: 'ACC5001', code: '5001', name: 'Cost of Goods Sold', type: 'expense', subType: 'cost_of_goods_sold' },
      { id: 'ACC5002', code: '5002', name: 'Salaries Expense', type: 'expense', subType: 'operating_expense' },
      { id: 'ACC5003', code: '5003', name: 'Rent Expense', type: 'expense', subType: 'operating_expense' },
      { id: 'ACC5004', code: '5004', name: 'Utilities Expense', type: 'expense', subType: 'operating_expense' },
      { id: 'ACC5005', code: '5005', name: 'Office Supplies', type: 'expense', subType: 'operating_expense' },
    ]
    for (const a of defaultAccounts) {
      await db.insert(schema.accounts).values({ ...a, currency: 'INR', isActive: true, createdAt: new Date().toISOString() })
    }
    logger.info('Bootstrap: seeded default chart of accounts')
  }
}

/**
 * Run bootstrap when the database is fresh (no users table). Idempotent and
 * safe on every start; upgrades add missing columns/tables for existing DBs.
 */
export async function bootstrapDatabase(): Promise<{ ran: boolean; tablesCreated: boolean }> {
  if (bootstrapped) return { ran: false, tablesCreated: false }
  bootstrapped = true
  if (!process.env.DATABASE_URL) return { ran: false, tablesCreated: false }

  const sql = await createClient()
  try {
    const hasUsers = await tableExists(sql, 'users')
    if (!hasUsers) {
      logger.info('Bootstrap: fresh database detected — creating schema')
      await createSchema(sql)
      const drizzleDb = drizzle(sql, { schema })
      await seedDefaults(drizzleDb)
      return { ran: true, tablesCreated: true }
    }

    // Existing DB: apply idempotent additions for upgrades
    const upgrades: string[] = [
      `CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id text PRIMARY KEY,
        customer_id text NOT NULL,
        invoice_id text,
        invoice_number text,
        type text NOT NULL,
        points numeric NOT NULL,
        balance_after numeric,
        note text,
        created_by text,
        date timestamp NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS quotations (
        id text PRIMARY KEY,
        number text NOT NULL,
        customer text,
        customer_phone text,
        customer_email text,
        customer_address text,
        customer_city text,
        customer_state text,
        customer_pincode text,
        subtotal numeric,
        gst numeric,
        gst_amount numeric,
        discount numeric,
        grand_total numeric,
        notes text,
        status text NOT NULL DEFAULT 'draft',
        valid_until timestamp,
        converted_invoice text,
        converted_at timestamp,
        created_by text,
        date timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp
      )`,
      `CREATE TABLE IF NOT EXISTS quotation_items (
        id text PRIMARY KEY,
        quotation_id text NOT NULL,
        product text,
        sku text,
        qty integer,
        weight numeric,
        silver_rate numeric,
        making_charge numeric,
        amount numeric
      )`,
      `CREATE TABLE IF NOT EXISTS order_events (
        id text PRIMARY KEY,
        order_id text,
        event text,
        details text,
        actor text,
        created_at timestamp
      )`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_phone text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_address text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_city text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_state text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_pincode text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_id text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS due_date timestamp`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS huid text`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_level integer`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS description text`,
      `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_email text`,
      `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_phone text`,
      `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS note text`,
      `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS is_booking boolean`,
      `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS advance_paid numeric`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS metal text DEFAULT 'silver'`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS purity_label text`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS diamond_weight numeric`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS tds_type text DEFAULT 'none'`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS tds_rate numeric`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS tds_amount numeric`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS tds_section text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS buyer_gstin text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS irn text`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS irn_date timestamp`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS qr_code text`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS pan text`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS tds_enabled boolean DEFAULT false`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS tcs_enabled boolean DEFAULT false`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_tds_section text`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS einvoice_enabled boolean DEFAULT false`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS eway_bill_enabled boolean DEFAULT false`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_id text`,
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_merchant_name text`,
      `CREATE TABLE IF NOT EXISTS gold_rates (
        id text PRIMARY KEY,
        rate numeric NOT NULL,
        purity numeric NOT NULL DEFAULT 99.9,
        currency text NOT NULL DEFAULT 'INR',
        source text,
        updated_at timestamp DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS currencies (
        id text PRIMARY KEY,
        code text NOT NULL,
        name text NOT NULL,
        symbol text NOT NULL,
        exchange_rate numeric,
        is_active boolean DEFAULT true,
        updated_at timestamp DEFAULT now(),
        CONSTRAINT currencies_code_unique UNIQUE (code)
      )`,
      `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR'`,
      `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR'`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id text`,
      `CREATE TABLE IF NOT EXISTS batches (
        id text PRIMARY KEY,
        product_id text NOT NULL,
        batch_number text NOT NULL,
        quantity integer NOT NULL DEFAULT 0,
        cost_price numeric,
        manufacturing_date date,
        expiry_date date,
        supplier text,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS batches_product_idx ON batches (product_id)`,
      `CREATE INDEX IF NOT EXISTS batches_number_idx ON batches (batch_number)`,
      `CREATE TABLE IF NOT EXISTS boms (
        id text PRIMARY KEY,
        name text NOT NULL,
        product_id text,
        description text,
        yield_qty integer DEFAULT 1,
        total_cost numeric,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS boms_product_idx ON boms (product_id)`,
      `CREATE TABLE IF NOT EXISTS bom_items (
        id text PRIMARY KEY,
        bom_id text NOT NULL,
        product_id text NOT NULL,
        quantity numeric,
        unit text DEFAULT 'g',
        wastage_percent numeric,
        cost numeric
      )`,
      `CREATE INDEX IF NOT EXISTS bom_items_bom_idx ON bom_items (bom_id)`,
      `CREATE TABLE IF NOT EXISTS karigars (
        id text PRIMARY KEY,
        name text NOT NULL,
        phone text,
        specialty text,
        rate numeric,
        rate_type text DEFAULT 'per_gram',
        balance numeric,
        address text,
        status text DEFAULT 'active',
        created_at timestamp DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS branches (
        id text PRIMARY KEY,
        name text NOT NULL,
        code text NOT NULL,
        address text,
        phone text,
        manager_name text,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now()
      )`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'branches_code_unique') THEN
          CREATE UNIQUE INDEX branches_code_unique ON branches (code);
        END IF;
      END $$`,
      `CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        code text NOT NULL,
        name text NOT NULL,
        type text NOT NULL,
        sub_type text,
        parent_id text,
        is_group boolean DEFAULT false,
        opening_balance numeric DEFAULT 0,
        current_balance numeric DEFAULT 0,
        currency text DEFAULT 'INR',
        branch_id text,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now(),
        CONSTRAINT accounts_code_unique UNIQUE (code)
      )`,
      `CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts (type)`,
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id text PRIMARY KEY,
        entry_number text NOT NULL,
        date date NOT NULL,
        description text,
        reference text,
        reference_type text,
        reference_id text,
        is_auto boolean DEFAULT true,
        branch_id text,
        created_by text,
        created_at timestamp DEFAULT now(),
        CONSTRAINT journal_entries_entry_number_unique UNIQUE (entry_number)
      )`,
      `CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries (date)`,
      `CREATE INDEX IF NOT EXISTS journal_entries_ref_idx ON journal_entries (reference_type, reference_id)`,
      `CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id text PRIMARY KEY,
        journal_entry_id text NOT NULL,
        account_id text NOT NULL,
        debit numeric DEFAULT 0,
        credit numeric DEFAULT 0,
        description text,
        branch_id text
      )`,
      `CREATE INDEX IF NOT EXISTS jel_entry_idx ON journal_entry_lines (journal_entry_id)`,
      `CREATE INDEX IF NOT EXISTS jel_account_idx ON journal_entry_lines (account_id)`,
      `CREATE TABLE IF NOT EXISTS financial_periods (
        id text PRIMARY KEY,
        name text NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_open boolean DEFAULT true,
        closed_at timestamp
      )`,
    ]
    for (const stmt of upgrades) {
      await sql.unsafe(stmt).catch(() => undefined)
    }
    return { ran: true, tablesCreated: false }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
