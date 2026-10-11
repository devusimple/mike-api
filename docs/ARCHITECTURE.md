# Architecture

```
browser/app  ──HTTPS──>  Cloudflare Worker (Hono, `src/index.ts`)
                              │  D1 binding `DB` (SQLite, Drizzle ORM)
                              │  Secrets: JWT_SECRET, CLOUDINARY_API_SECRET
                              │  Vars: CLOUDINARY_CLOUD_NAME/KEY/FOLDER
                              │
browser/app  ──HTTPS──>  Cloudinary (images, direct upload — never proxied)
```

## Decisions (chosen for v1)

| Concern | Choice | Why |
|---|---|---|
| Auth | Email+password, PBKDF2-SHA256 (WebCrypto) + JWT access (15m) + rotating refresh (30d, sha256-hashed in D1) | No external provider, works on Workers (bcrypt/jose-node don't), rotation allows logout |
| DB access | Drizzle ORM (`drizzle-orm/d1`) + hand-written SQL migration in `drizzle/` | Type-safe, D1-compatible, migrations auditable |
| Prices | Integer cents (`price_cents`) | No float rounding bugs |
| Cart | Auth-required, one row per user | Simple, no guest-merge logic in v1; extension documented in NEXT_STEPS |
| Checkout | `POST /api/orders/checkout` with `Idempotency-Key`, D1 `batch()` write set | Safe retries, atomic order+items+stock+cart-clear |
| Media | Server signs, client uploads direct to Cloudinary | Workers have 10ms–CPU/128MB limits; proxying uploads wastes both |
| Payments | None in v1 (`pending` orders = COD/manual) | Stripe/SSLCommerz stubbed in NEXT_STEPS |
| Admin UI | None in v1 (JSON APIs only) | Same — `/api/docs` index + markdown docs are the contract |

## Request lifecycle

1. `src/index.ts` — CORS, logger, route mounting, `onError` JSON envelope.
2. `requireAuth` — verifies Bearer JWT, loads user from D1, sets `c.get("authUser")`.
3. `requireAdmin` — 403 unless `role === "admin"`.
4. Route handlers — zod validation (`@hono/zod-validator`), `getDb(c.env.DB)` per request.
5. Errors — `HTTPException(status, message)` → `{ error, status }` JSON.

## Adding a new domain (checklist)

1. Add table(s) to `src/db/schema.ts`.
2. Append SQL to a new `drizzle/NNNN_*.sql` (keep in sync with schema).
3. Apply: `bunx wrangler d1 migrations apply mike --local` (add `--remote` for prod).
4. Add `src/routes/<domain>.ts` + zod schemas, mount in `src/index.ts`.
5. Document in `docs/API.md` + `docs/DATA_MODEL.md`.
