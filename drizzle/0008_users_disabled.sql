-- Admin user management: disable flag (login + tokens rejected when set).
-- Applied with: bunx wrangler d1 migrations apply mike --local [--remote]

ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
