# Auth

## Model

- Passwords: PBKDF2-SHA256, 100k iterations, 16-byte salt, 32-byte key (`src/lib/password.ts`). WebCrypto-only so it runs on Workers (no bcrypt).
- Access token: HS256 JWT, 15 min, claims `{ sub, role, type:"access" }` (`src/lib/jwt.ts`).
- Refresh token: HS256 JWT, 30 days, `{ sub, type:"refresh" }`. Only its **sha256 hash** is stored in `refresh_tokens`. Each token carries a random `jti` so rapid successive logins never collide on the table's unique hash.
- Rotation: every `/refresh` revokes the old row and inserts a new one. `/logout` revokes.
- Middleware: `requireAuth` (Bearer → `c.get("authUser")`), `requireAdmin` (403 unless admin).

## Client flows

**Mobile / SPA (token in memory):**
1. `POST /api/auth/register|login` → store `accessToken` (memory) + `refreshToken` (secure storage).
2. Send `Authorization: Bearer <access>`.
3. On 401, `POST /api/auth/refresh { refreshToken }` → replace both, retry once.

**Web (httpOnly cookie):** register/login also set `refresh_token` cookie (`Path=/`, `SameSite=Lax`, `Secure`). The refresh endpoint accepts the cookie, so the browser flow can keep the refresh token out of JS entirely. Access token still goes in `Authorization`.

## Admin promotion

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Or via `scripts/make-admin.sql`. There is no public "make admin" endpoint by design — the first admin is promoted directly in D1 (see `docs/D1.md`).

## Secrets

- `JWT_SECRET` (≥32 chars) — `bunx wrangler secret put JWT_SECRET`, local: `.dev.vars` (copy from `.dev.vars.example`).
- Rotate by setting a new secret; all sessions invalidate (documented behavior, no versioning in v1).

## Future hardening (not in v1)

Login rate-limit (KV or Durable Object), email verification, password reset, OAuth (Google), refresh-token reuse detection (theft signal). See `NEXT_STEPS.md`.
