DROP INDEX "customers_email_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean;--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");