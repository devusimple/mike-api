-- Wipe burst-test users from PROD (parallel-login verification residue).
-- Apply: bunx wrangler d1 execute mike --remote --file ./scripts/clean-burst.sql
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com'));
DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com');
DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com'));
DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com');
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com');
DELETE FROM users WHERE email LIKE 'burst%@test.com' OR email LIKE 'seq%@test.com';
