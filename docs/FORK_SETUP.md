# Running your own copy (fork guide)

Everything is parameterized — no code changes needed to run this stack on
your own Cloudflare + Cloudinary accounts. You need: a Cloudflare account,
`bun`, a Cloudinary account, and (for the shop) any static host (Vercel used here).

## Backend (`mike-api`)

```bash
git clone <your-fork> mike && cd mike
bun install
cp .dev.vars.example .dev.vars
bunx wrangler login
```

**1. Database** — create your own D1 and point the config at it:
```bash
bunx wrangler d1 create <pick-a-name>   # e.g. myshop-db
```
Paste the returned `database_id` (and name) into `wrangler.jsonc` → `d1_databases`.

**2. Rate-limit KV:**
```bash
bunx wrangler kv namespace create RATE_LIMIT_KV
```
Paste the returned `id` into `wrangler.jsonc` → `kv_namespaces`.

**3. Secrets** (never in files — `wrangler secret` store + local `.dev.vars`):
```bash
bunx wrangler secret put JWT_SECRET            # 32+ random chars
bunx wrangler secret put CLOUDINARY_API_SECRET # from cloudinary.com dashboard
# optional:
bunx wrangler secret put TELEGRAM_BOT_TOKEN    # owner order alerts
bunx wrangler secret put RESEND_API_KEY        # verification/reset emails
```
Mirror the same values into `.dev.vars` for local dev.

**4. Public vars** in `wrangler.jsonc` → `vars` (safe to commit):

| Var | Yours |
|---|---|
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` | your Cloudinary dashboard values |
| `CLOUDINARY_FOLDER` | any folder path, e.g. `myshop/products` |
| `ALLOWED_ORIGINS` | your shop domain(s), comma-separated |
| `FRONTEND_URL` | your shop URL (email links) |
| `TELEGRAM_CHAT_ID` | only if using alerts |
| `MAIL_FROM` | only if using Resend |

**5. Migrate + launch:**
```bash
bun run db:apply:local
bun run dev                                # http://localhost:8787 + smoke.ts
bun run db:apply:remote
bun run deploy
bunx wrangler d1 execute <db> --remote --file ./scripts/seed.sql   # optional demo catalog
# promote yourself:
#   UPDATE users SET role='admin' WHERE email='you@shop.com';
```

## Storefront (`mike-storefront`)

```bash
git clone <your-fork> && cd mike-storefront
bun install
cp .env.example .env   # set VITE_API_BASE to your Worker URL (or localhost:8787)
bun run dev            # http://localhost:5173
bun run build          # deploy dist/ to Vercel/Pages/your host
```
Then add your shop domain to the backend's `ALLOWED_ORIGINS` and redeploy the Worker.
`vercel.json` already contains the SPA fallback so `/admin`, `/cart`, … resolve.

## What transfers unchanged

Schema + migrations (`drizzle/`), all API routes, auth model, Cloudinary signed-upload
flow, Telegram/Resend integrations (inert until configured), docs, smoke scripts.

## Conventions a fork inherits (rename if you like)

Worker name `mike`, D1 name `mike`, `mike/products` Cloudinary folder, `mike:` localStorage
keys, `৳`/BDT currency formatting (`src/lib/format.ts` in the storefront).
