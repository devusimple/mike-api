-- Phase B: variants. cart_items gains variant_id (table rebuild, ids preserved
-- so existing lines stay linked; prod carts are preserved with NULL variant).
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price_cents INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_unique ON product_variants (sku);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id);

ALTER TABLE order_items ADD COLUMN variant_id TEXT REFERENCES product_variants (id);
ALTER TABLE order_items ADD COLUMN variant_name TEXT;

CREATE TABLE IF NOT EXISTS cart_items_new (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants (id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1
);
INSERT INTO cart_items_new (id, cart_id, product_id, qty)
  SELECT id, cart_id, product_id, qty FROM cart_items;
DROP TABLE cart_items;
ALTER TABLE cart_items_new RENAME TO cart_items;
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_product_variant_unique
  ON cart_items (cart_id, product_id, variant_id);
