-- COD shipping zones + order shipping snapshot.
-- Seeds BD defaults (editable/deletable in /admin/shipping).
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

CREATE TABLE IF NOT EXISTS shipping_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  charge_cents INTEGER NOT NULL,
  free_above_cents INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_zone TEXT;

INSERT INTO shipping_zones (id, name, charge_cents, free_above_cents, active, position) VALUES
  ('inside-dhaka', 'Inside Dhaka', 6000, 200000, 1, 0),
  ('outside-dhaka', 'Outside Dhaka', 12000, NULL, 1, 1);
