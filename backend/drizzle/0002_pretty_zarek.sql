CREATE TABLE "login_attempts" (
	"identifier" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_attempt" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number_encrypted" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "charge_on_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "billing_address" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "shopify_store_url_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "shopify_access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "shopify_api_version" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "webhook_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "db_host_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "db_port_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "db_database_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "db_user_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "db_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "require_password_change" boolean;--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");