-- Add HUID, booking/advance, and return/credit-note columns
ALTER TABLE products ADD COLUMN IF NOT EXISTS huid TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS is_booking BOOLEAN;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS advance_paid NUMERIC;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS invoice_id TEXT;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS credit_note_number TEXT;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS restocked BOOLEAN;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS return_items JSONB;
