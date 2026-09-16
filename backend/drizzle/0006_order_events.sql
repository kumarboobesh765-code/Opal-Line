-- Order events timeline + nothing else new this round
CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  event TEXT,
  details TEXT,
  actor TEXT,
  created_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events (order_id);
CREATE INDEX IF NOT EXISTS order_events_created_idx ON order_events (created_at);
