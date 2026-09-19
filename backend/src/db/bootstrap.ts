import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import { defaultRolePermissions } from '../rbac'
import { roleNames } from './seedData'
import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { logger } from '../logger'

/**
 * First-run database bootstrap.
 *
 * Runs at server startup BEFORE anything else touches the DB and is safe to
 * run on every start (all statements are idempotent). On a fresh machine this
 * creates the full schema, seeds default roles, and provisions the initial
 * admin user so the desktop installer can go from empty PostgreSQL to a
 * working login with zero manual SQL.
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
    // ── Core identity / settings ──────────────────────────────────────────
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
        role text NOT NULL DEFAULT 'Staff',
        last_login timestamp,
        status text NOT NULL DEFAULT 'active',
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
        rate numeric,
        purity numeric,
        previous_rate numeric,
        updated_at timestamp
      )`)

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
        status text NOT NULL DEFAULT 'active',
        image text,
        images jsonb,
        description text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON products (sku)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_category_idx ON products (category)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS products_shopify_id_idx ON products (shopify_id)`)

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

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id text PRIMARY KEY,
        name text NOT NULL,
        contact text,
        email text,
        phone text,
        address text,
        city text,
        gstin text,
        status text,
        notes text,
        created_at timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS inventory_locations (
        id text PRIMARY KEY,
        name text NOT NULL,
        type text,
        address text,
        is_default boolean,
        created_at timestamp DEFAULT now()
      )`)

    // ── Sales ─────────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id text PRIMARY KEY,
        internal_id text,
        shopify_id text,
        customer text,
        customer_email text,
        customer_phone text,
        value numeric,
        payment text,
        fulfillment text,
        status text NOT NULL DEFAULT 'open',
        line_items jsonb,
        shipping_address jsonb,
        billing_address jsonb,
        note text,
        invoice text,
        discount numeric,
        date timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_orders_shopify_id_idx ON sales_orders (shopify_id)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON sales_orders (customer)`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_orders_date_idx ON sales_orders (date)`)

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
        status text NOT NULL DEFAULT 'issued',
        notes text,
        due_date date,
        date timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_unique ON sales_invoices (number)`)

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
        amount numeric,
        CONSTRAINT sales_invoice_items_invoice_id_fk FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS sales_invoice_items_invoice_id_idx ON sales_invoice_items (invoice_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id text PRIMARY KEY,
        credit_note text NOT NULL,
        invoice_id text,
        invoice_number text,
        customer text,
        items jsonb,
        total numeric,
        reason text,
        restock boolean,
        status text NOT NULL DEFAULT 'pending',
        refunded_at timestamp,
        date timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS sales_returns_credit_note_unique ON sales_returns (credit_note)`)

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
        amount numeric,
        CONSTRAINT quotation_items_quotation_id_fk FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS quotation_items_quotation_id_idx ON quotation_items (quotation_id)`)

    // ── Purchases ─────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id text PRIMARY KEY,
        number text,
        supplier text,
        items integer,
        value numeric,
        status text NOT NULL DEFAULT 'draft',
        expected_date date,
        date timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id text PRIMARY KEY,
        number text NOT NULL,
        supplier text,
        items integer,
        total numeric,
        status text,
        date timestamp
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id text PRIMARY KEY,
        number text,
        supplier text,
        items integer,
        value numeric,
        reason text,
        status text NOT NULL DEFAULT 'pending',
        date timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id text PRIMARY KEY,
        reference text,
        product text,
        sku text,
        qty integer,
        from_location text,
        to_location text,
        status text NOT NULL DEFAULT 'pending',
        notes text,
        date timestamp DEFAULT now()
      )`)

    // ── Finance ───────────────────────────────────────────────────────────
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS payments (
        id text PRIMARY KEY,
        reference text,
        customer text,
        invoice text,
        amount numeric,
        method text,
        type text,
        status text,
        notes text,
        date timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id text PRIMARY KEY,
        date date,
        account text,
        description text,
        debit numeric,
        credit numeric,
        balance numeric,
        category text,
        created_at timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS expenses (
        id text PRIMARY KEY,
        date date,
        category text,
        description text,
        amount numeric,
        payment_method text,
        status text NOT NULL DEFAULT 'pending',
        receipt text,
        created_at timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id text PRIMARY KEY,
        name text NOT NULL,
        bank text,
        account_number text,
        ifsc text,
        branch text,
        opening_balance numeric,
        current_balance numeric,
        status text,
        created_at timestamp DEFAULT now()
      )`)

    // ── Operations / audit ────────────────────────────────────────────────
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
        created_at timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments (order_id)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id text PRIMARY KEY,
        action text NOT NULL,
        module text,
        entity text,
        details jsonb,
        user_id text,
        user_name text,
        ip text,
        timestamp timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS activity_logs_timestamp_idx ON activity_logs (timestamp)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id text PRIMARY KEY,
        action text,
        entity text,
        entity_id text,
        actor text,
        changes jsonb,
        timestamp timestamp DEFAULT now()
      )`)
    await tx.unsafe(`CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs (timestamp)`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id text PRIMARY KEY,
        resource text,
        direction text,
        status text,
        records integer,
        message text,
        created_at timestamp DEFAULT now()
      )`)

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id text PRIMARY KEY,
        type text NOT NULL,
        recipient text,
        subject text,
        body text,
        channel text,
        status text,
        error text,
        created_at timestamp DEFAULT now()
      )`)

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

    // ── Extra columns added in later iterations (idempotent) ──────────────
    await tx.unsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb`)
    await tx.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_phone text`)
    await tx.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_address text`)
    await tx.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_city text`)
    await tx.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_state text`)
    await tx.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_pincode text`)
    await tx.unsafe(`ALTER TABLE products ADD COLUMN IF NOT EXISTS huid text`)
    await tx.unsafe(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb`)
    await tx.unsafe(`ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_level integer`)
    await tx.unsafe(`ALTER TABLE expenses ALTER COLUMN status SET DEFAULT 'pending'`)
  })
}

async function seedDefaults(sql: postgres.Sql, db: ReturnType<typeof drizzle>): Promise<void> {
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
    const tempPassword = `Opal${randomBytes(3).toString('hex').toUpperCase()}!`
    const passwordHash = await argon2.hash(tempPassword)
    await db.insert(schema.users).values({
      id: randomBytes(8).toString('hex'),
      name: 'Administrator',
      email: 'admin@opalline.local',
      username: 'admin',
      passwordHash,
      role: 'Admin',
      status: 'active',
      permissions: defaultRolePermissions('Admin'),
    })
    logger.info('Bootstrap: created initial admin user')
    console.log('\n══════════════════════════════════════════════════════')
    console.log('  Initial admin account created:')
    console.log('    Email:    admin@opalline.local')
    console.log(`    Password: ${tempPassword}`)
    console.log('  Change this password after first login.')
    console.log('══════════════════════════════════════════════════════\n')
  }

  // Settings row
  const settings = await db.select({ id: schema.settings.id }).from(schema.settings).limit(1)
  if (settings.length === 0) {
    await db.insert(schema.settings).values({ id: 'app', gstRate: 3, invoicePrefix: 'SI', currency: 'INR' })
    logger.info('Bootstrap: seeded default settings')
  }
}

/**
 * Run bootstrap if the database hasn't been set up yet. Returns the number of
 * bootstrap actions performed (0 = already up to date).
 */
export async function bootstrapDatabase(): Promise<{ ran: boolean; tablesCreated: boolean }> {
  if (bootstrapped) return { ran: false, tablesCreated: false }
  bootstrapped = true
  if (!process.env.DATABASE_URL) return { ran: false, tablesCreated: false }

  const sql = await createClient()
  try {
    const hadUsers = await tableExists(sql, 'users')
    if (!hadUsers) {
      logger.info('Bootstrap: fresh database detected — creating schema')
      await createSchema(sql)
      const drizzleDb = drizzle(sql, { schema })
      await seedDefaults(sql, drizzleDb)
      return { ran: true, tablesCreated: true }
    }

    // Existing DB: still apply idempotent column additions for upgrades
    await sql.unsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb`).catch(() => undefined)
    await sql.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_phone text`).catch(() => undefined)
    await sql.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_address text`).catch(() => undefined)
    await sql.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_city text`).catch(() => undefined)
    await sql.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_state text`).catch(() => undefined)
    await sql.unsafe(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_pincode text`).catch(() => undefined)
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS loyalty_transactions (
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
    )`).catch(() => undefined)
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS quotations (
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
    )`).catch(() => undefined)
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS quotation_items (
      id text PRIMARY KEY,
      quotation_id text NOT NULL,
      product text,
      sku text,
      qty integer,
      weight numeric,
      silver_rate numeric,
      making_charge numeric,
      amount numeric,
      CONSTRAINT quotation_items_quotation_id_fk FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
    )`).catch(() => undefined)
    return { ran: true, tablesCreated: false }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
