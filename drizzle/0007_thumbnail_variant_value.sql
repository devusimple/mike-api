-- Dedicated thumbnail + variant value field.
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

ALTER TABLE products ADD COLUMN thumbnail_public_id TEXT;
ALTER TABLE products ADD COLUMN thumbnail_secure_url TEXT;
ALTER TABLE product_variants ADD COLUMN value TEXT;
