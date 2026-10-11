-- Phase A: brand / featured / rating aggregates + tags.
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN rating_avg REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_unique ON tags (slug);

CREATE TABLE IF NOT EXISTS product_tags (
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS product_tags_unique ON product_tags (product_id, tag_id);
CREATE INDEX IF NOT EXISTS product_tags_tag_idx ON product_tags (tag_id);
