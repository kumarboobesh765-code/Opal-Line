CREATE TABLE "activity_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp,
	"user" text,
	"user_id" text,
	"role" text,
	"action" text,
	"module" text,
	"entity" text,
	"details" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp,
	"user" text,
	"action" text,
	"module" text,
	"entity" text,
	"changes" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"account_number" text,
	"balance" numeric,
	"ifsc" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"city" text,
	"province" text,
	"shopify_id" text,
	"email_verified" boolean,
	"orders" integer,
	"total_spent" numeric,
	"status" text,
	"joined" date,
	CONSTRAINT "customers_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text,
	"description" text,
	"amount" numeric,
	"payment_method" text,
	"date" timestamp,
	"status" text,
	"by" text
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"city" text,
	"manager" text
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date,
	"description" text,
	"ref" text,
	"debit" numeric,
	"credit" numeric
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text,
	"invoice" text,
	"customer" text,
	"amount" numeric,
	"method" text,
	"gateway" text,
	"status" text,
	"date" timestamp,
	"reconciled" boolean
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"category" text NOT NULL,
	"collection" text,
	"purity" numeric,
	"gross_weight" numeric,
	"stone_weight" numeric,
	"net_weight" numeric,
	"making_charge" numeric,
	"gst" numeric,
	"hsn" text,
	"supplier" text,
	"silver_rate" numeric,
	"selling_price" numeric,
	"compare_at_price" numeric,
	"stock" integer,
	"reorder_level" integer,
	"shopify_status" text,
	"shopify_id" text,
	"status" text,
	"image" text,
	"vendor" text,
	"product_type" text,
	"tags" text,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"created_at" date,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier" text,
	"items" integer,
	"qty" integer,
	"weight" numeric,
	"rate" numeric,
	"cost" numeric,
	"tax" numeric,
	"total" numeric,
	"status" text,
	"date" timestamp,
	CONSTRAINT "purchase_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier" text,
	"items" integer,
	"qty" integer,
	"weight" numeric,
	"value" numeric,
	"status" text,
	"date" timestamp,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier" text,
	"items" integer,
	"weight" numeric,
	"amount" numeric,
	"status" text,
	"date" timestamp,
	CONSTRAINT "purchase_returns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"product" text,
	"sku" text,
	"qty" integer,
	"weight" numeric,
	"silver_rate" numeric,
	"making_charge" numeric,
	"tax" numeric,
	"amount" numeric
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"shopify_order" text,
	"customer" text,
	"customer_email" text,
	"silver_value" numeric,
	"making_charge" numeric,
	"subtotal" numeric,
	"gst" numeric,
	"gst_amount" numeric,
	"discount" numeric,
	"grand_total" numeric,
	"payment_method" text,
	"payment_status" text,
	"payment_id" text,
	"status" text,
	"date" timestamp,
	CONSTRAINT "sales_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"shopify_id" text,
	"internal_id" text,
	"customer" text,
	"value" numeric,
	"payment" text,
	"fulfillment" text,
	"invoice" text,
	"status" text,
	"date" timestamp,
	"items" integer,
	"tags" text,
	"currency" text,
	"discount" numeric,
	"line_items" jsonb,
	CONSTRAINT "sales_orders_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"order" text,
	"customer" text,
	"items" integer,
	"amount" numeric,
	"status" text,
	"date" timestamp,
	CONSTRAINT "sales_returns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"business_name" text,
	"gstin" text,
	"phone" text,
	"email" text,
	"address" text,
	"default_purity" numeric,
	"making_charge" numeric,
	"gst_rate" numeric,
	"currency" text,
	"invoice_prefix" text,
	"rate_source" text,
	"auto_update_mcx" boolean,
	"require_rate_approval" boolean,
	"auto_reconcile_razorpay" boolean,
	"payment_reminders" boolean,
	"low_stock_alerts" boolean,
	"daily_summary" boolean,
	"order_imports" boolean,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "silver_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"purity" numeric,
	"rate" numeric,
	"previous_rate" numeric,
	"updated_at" timestamp,
	"change" numeric,
	"change_percent" numeric,
	"currency" text
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"from" text,
	"to" text,
	"product" text,
	"sku" text,
	"qty" integer,
	"weight" numeric,
	"initiated_by" text,
	"status" text,
	"date" timestamp,
	CONSTRAINT "stock_transfers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"phone" text,
	"city" text,
	"status" text,
	"outstanding" numeric
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text,
	"shopify_id" text,
	"direction" text,
	"action" text,
	"status" text,
	"time" timestamp,
	"error" text,
	"retry" boolean
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"password_hash" text,
	"role" text NOT NULL,
	"last_login" timestamp,
	"status" text NOT NULL,
	"avatar_color" text,
	"permissions" jsonb,
	"reset_token" text,
	"reset_token_expiry" timestamp,
	"email_verification_token" text,
	"email_verification_expiry" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_timestamp_idx" ON "activity_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_logs_module_idx" ON "activity_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user");--> statement-breakpoint
CREATE INDEX "audit_logs_module_idx" ON "audit_logs" USING btree ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_name_idx" ON "bank_accounts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_shopify_id_idx" ON "customers" USING btree ("shopify_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_name_search_idx" ON "customers" USING gin (to_tsvector('english', "name"));--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_name_idx" ON "inventory_locations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ledger_entries_ref_idx" ON "ledger_entries" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "payments_ref_idx" ON "payments" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("date");--> statement-breakpoint
CREATE INDEX "payments_reconciled_idx" ON "payments" USING btree ("reconciled");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_shopify_id_idx" ON "products" USING btree ("shopify_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_shopify_status_idx" ON "products" USING btree ("shopify_status");--> statement-breakpoint
CREATE INDEX "products_name_search_idx" ON "products" USING gin (to_tsvector('english', "name"));--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_number_idx" ON "purchase_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_idx" ON "purchase_invoices" USING btree ("supplier");--> statement-breakpoint
CREATE INDEX "purchase_invoices_date_idx" ON "purchase_invoices" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_idx" ON "purchase_orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier");--> statement-breakpoint
CREATE INDEX "purchase_orders_date_idx" ON "purchase_orders" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_number_idx" ON "purchase_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_returns_supplier_idx" ON "purchase_returns" USING btree ("supplier");--> statement-breakpoint
CREATE INDEX "purchase_returns_date_idx" ON "purchase_returns" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_invoice_id_idx" ON "sales_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_sku_idx" ON "sales_invoice_items" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_number_idx" ON "sales_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_invoices_shopify_order_idx" ON "sales_invoices" USING btree ("shopify_order");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "sales_invoices" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "sales_invoices_date_idx" ON "sales_invoices" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_invoices_payment_status_idx" ON "sales_invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_shopify_id_idx" ON "sales_orders" USING btree ("shopify_id");--> statement-breakpoint
CREATE INDEX "sales_orders_internal_id_idx" ON "sales_orders" USING btree ("internal_id");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "sales_orders_date_idx" ON "sales_orders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_number_idx" ON "sales_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "sales_returns_date_idx" ON "sales_returns" USING btree ("date");--> statement-breakpoint
CREATE INDEX "silver_rates_updated_at_idx" ON "silver_rates" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_number_idx" ON "stock_transfers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_transfers_sku_idx" ON "stock_transfers" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "stock_transfers_date_idx" ON "stock_transfers" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sync_logs_time_idx" ON "sync_logs" USING btree ("time");--> statement-breakpoint
CREATE INDEX "sync_logs_entity_idx" ON "sync_logs" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "sync_logs_shopify_id_idx" ON "sync_logs" USING btree ("shopify_id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token_expiry" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_expiry" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean;