-- Quotations: pre-sale estimates that can convert into tax invoices
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  customer_address TEXT,
  customer_city TEXT,
  customer_state TEXT,
  customer_pincode TEXT,
  subtotal NUMERIC,
  gst NUMERIC,
  gst_amount NUMERIC,
  discount NUMERIC,
  grand_total NUMERIC,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  valid_until TIMESTAMP,
  converted_invoice TEXT,
  converted_at TIMESTAMP,
  created_by TEXT,
  date TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quotations_status_idx ON quotations(status);
CREATE INDEX IF NOT EXISTS quotations_customer_idx ON quotations(customer);
CREATE INDEX IF NOT EXISTS quotations_date_idx ON quotations(date);

CREATE TABLE IF NOT EXISTS quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL,
  product TEXT,
  sku TEXT,
  qty INTEGER,
  weight NUMERIC,
  silver_rate NUMERIC,
  making_charge NUMERIC,
  amount NUMERIC,
  CONSTRAINT quotation_items_quotation_id_fk FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS quotation_items_quotation_id_idx ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS quotation_items_sku_idx ON quotation_items(sku);
