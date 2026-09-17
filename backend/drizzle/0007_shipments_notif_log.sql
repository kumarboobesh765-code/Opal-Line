-- Dispatch shipments: one per sales order (created on first dispatch action)
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_ref TEXT,
  customer TEXT,
  courier TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  dispatched_at TIMESTAMP,
  expected_delivery DATE,
  delivered_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments (order_id);

-- Notification log: every customer notification attempt (email/WhatsApp)
CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT,
  ref TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_log_created_idx ON notification_log (created_at);
