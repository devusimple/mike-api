# Mike — E-commerce backend (Hono + D1 + Cloudinary)

Bun + Cloudflare Workers + Hono API. Data in **Cloudflare D1** (Drizzle ORM), images in **Cloudinary** (signed direct uploads). No payments and no admin UI in v1 — orders are created as `pending` (COD/manual) and managed via JSON APIs.

## Quickstart

```bash
bun install
cp .dev.vars.example .dev.vars   # fill JWT_SECRET + CLOUDINARY_API_SECRET
bunx wrangler d1 create mike  # paste database_id into wrangler.jsonc
bun run db:apply:local
bun run db:seed:local            # optional demo catalog
bun run dev                      # http://localhost:8787
```

Health: `GET /health` · Route index: `GET /api/docs`

## Docs (the handoff — read these before extending)

| File | Covers |
|---|---|
| `docs/ARCHITECTURE.md` | Stack, decisions, request lifecycle, "add a domain" checklist |
| `docs/API.md` | Full endpoint reference + cURL smoke test |
| `docs/AUTH.md` | JWT rotation, client flows, admin promotion |
| `docs/DATA_MODEL.md` | Tables, relations, checkout invariants |
| `docs/CLOUDINARY.md` | Signed upload flow + JS snippet, delete caveat |
| `docs/D1.md` | Setup, local vs remote, useful commands, limits |
| `docs/NEXT_STEPS.md` | Payments (Stripe/SSLCommerz), admin UI plan, hardening |
| `docs/FORK_SETUP.md` | Run your own copy: D1+KV+secrets checklist, every value to change |

## Key choices

- **Auth:** PBKDF2 + access (15m) / rotating refresh (30d). First admin via SQL (`scripts/make-admin.sql`).
- **Cart:** guest (`X-Guest-Token`, merge on login) or auth; checkout requires login.
- **Browser access:** CORS allowlist via `ALLOWED_ORIGINS` var (localhost always allowed).
- **Checkout:** `POST /api/orders/checkout` requires `Idempotency-Key`; D1 `batch()` makes order+items+stock+cart-clear atomic.
- **Media:** `POST /api/uploads/signature` (admin) → browser uploads direct to Cloudinary → `POST /api/products/:id/images`.
- **Prices:** integer cents, currency BDT.
- **Catalog:** brand, featured, tags, rating aggregates; variants (size/color) with own SKU/price/stock — required at cart when present.

## Scripts

```bash
bun run dev | bun run deploy | bun run cf-typegen | bun run typecheck
bun run db:apply:local | bun run db:apply:remote | bun run db:seed:local
```
