-- Wipe smoke-test data from PROD. Keeps schema + coupons intact.
-- Apply: bunx wrangler d1 execute mike --remote --file ./scripts/clean-prod.sql
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com'));
DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com');
DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com'));
DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com');
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com');
DELETE FROM reviews WHERE user_id IN (SELECT id FROM users WHERE email = 'smoke@test.com');
DELETE FROM product_images WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'Smoke%');
DELETE FROM products WHERE name LIKE 'Smoke%';
DELETE FROM categories WHERE name LIKE 'SmokeCat%';
DELETE FROM users WHERE email = 'smoke@test.com';
