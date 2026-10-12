-- Order tracking: status timeline + courier fields.
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

ALTER TABLE orders ADD COLUMN carrier TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id);
