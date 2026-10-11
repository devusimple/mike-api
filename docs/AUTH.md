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

## Email verification & password reset

- Register / `POST /api/auth/request-verification` mints a single-use token (24h) and emails `FRONTEND_URL/verify-email?token=…`. `POST /api/auth/verify-email` consumes it → `emailVerified: true` (visible in `/me`, not a checkout gate).
- `POST /api/auth/forgot-password` always returns 200 (no email enumeration); `POST /api/auth/reset-password` consumes the 1h token, sets the new hash, and revokes **all** sessions.
- `POST /api/auth/change-password` (logged in) verifies the current password, revokes other sessions, and returns a fresh pair so the client stays logged in.
- Delivery: Resend when the `RESEND_API_KEY` secret is set (plus `MAIL_FROM` var); otherwise the Worker logs the link (`[mail:dev]`) — full flows stay testable locally. To go live: verify a domain at resend.com, `bunx wrangler secret put RESEND_API_KEY`, set `MAIL_FROM`.

## Brute-force protection

`RATE_LIMIT_KV` fixed-window limits per IP: login 10/min, register 5/min, refresh 30/min, forgot/reset 5–10/5min. Exceeding returns 429 + `Retry-After`. No KV binding → fail-open with a warning (never fail-closed on infra gaps).

## Refresh-theft handling

- Unknown token hash + valid signature → revoke **all** user sessions, 401 "Session compromised".
- Known-but-revoked/expired token → plain 401 (covers benign double-refresh / logout races).

## Future hardening (not in v1)

Email verification, password reset — done (see above). Still open: OAuth (Google), refresh-token reuse detection — done (see above), login rate-limit — done (see above). Remaining: WebAuthn/passkeys, per-device session list.
