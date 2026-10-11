-- Demo seed for LOCAL D1 only. Passwords here are NOT real hashes;
-- register via the API instead. This file only seeds catalog/coupons.
-- Apply: bunx wrangler d1 execute mike --local --file ./scripts/seed.sql

INSERT INTO categories (id, name, slug, image_url) VALUES
  ('cat_tees', 'Tees', 'tees', NULL),
  ('cat_hoodies', 'Hoodies', 'hoodies', NULL),
  ('cat_caps', 'Caps', 'caps', NULL);

INSERT INTO products (id, slug, name, description, price_cents, compare_price_cents, sku, stock, category_id, is_active) VALUES
  ('prod_tee_black', 'classic-black-tee', 'Classic Black Tee', 'Heavyweight 220 GSM cotton tee.', 125000, 150000, 'TEE-BLK-M', 50, 'cat_tees', 1),
  ('prod_hoodie_gray', 'gray-pullover-hoodie', 'Gray Pullover Hoodie', 'Brushed fleece hoodie.', 285000, NULL, 'HOD-GRY-L', 25, 'cat_hoodies', 1),
  ('prod_cap_navy', 'navy-dad-cap', 'Navy Dad Cap', 'Unstructured twill cap.', 65000, 80000, 'CAP-NVY-OS', 100, 'cat_caps', 1);

INSERT INTO coupons (code, percent_off, active, expires_at) VALUES
  ('WELCOME10', 10, 1, NULL);
