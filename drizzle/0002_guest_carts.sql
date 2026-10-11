-- Guest carts: allow anonymous carts identified by `guest_token`.
-- SQLite cannot drop NOT NULL, so rebuild the table (FKs are not enforced
-- by D1 by default; cart row ids are preserved so cart_items stay linked).
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

CREATE TABLE IF NOT EXISTS carts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  guest_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO carts_new (id, user_id, created_at)
  SELECT id, user_id, created_at FROM carts;
DROP TABLE carts;
ALTER TABLE carts_new RENAME TO carts;
CREATE UNIQUE INDEX IF NOT EXISTS carts_user_unique ON carts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS carts_guest_unique ON carts (guest_token);
