-- Promote a user to admin. No public endpoint does this by design.
-- Usage:
--   bunx wrangler d1 execute mike --local --command "UPDATE users SET role='admin' WHERE email='you@example.com';"
--   (add --remote instead of --local for production)
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
