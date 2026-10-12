# API reference (v1)

Base URL (dev): `http://localhost:8787` · Prod: `https://mike.<you>.workers.dev`
Machine index: `GET /api/docs` · Health: `GET /health`
Currency: **BDT**, all prices are **integer cents** (`25000` = ৳250.00).
Pagination: `?page=1&limit=20` (max 100).
Errors: `{ "error": "<message>", "status": <code> }`.

## Auth

| Method | Endpoint | Auth | Body |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{ email, password≥8, name }` → 201 `{ user, accessToken, refreshToken }` + `refresh_token` cookie + verification email (best-effort) |
| POST | `/api/auth/login` | – | `{ email, password }` → same as above (10/min/IP) |
| POST | `/api/auth/refresh` | – | `{ refreshToken }` (or cookie) → rotates, returns new pair; unknown-token reuse revokes all sessions |
| POST | `/api/auth/logout` | – | `{ refreshToken }` → revokes |
| GET | `/api/auth/me` | Bearer | → `{ user }` (includes `emailVerified`) |
| POST | `/api/auth/request-verification` | Bearer | re-sends verification email |
| POST | `/api/auth/verify-email` | – | `{ token }` → marks email verified |
| POST | `/api/auth/forgot-password` | – | `{ email }` → always 200, sends reset link if account exists |
| POST | `/api/auth/reset-password` | – | `{ token, password≥8 }` → resets + logs out everywhere |
| POST | `/api/auth/change-password` | Bearer | `{ currentPassword, newPassword≥8 }` → returns fresh pair, revokes other sessions |

## Categories

- `GET /api/categories` → `{ categories }`
- `GET /api/categories/:idOrSlug` → `{ category, productCount }`
- `POST /api/categories` (admin) `{ name, slug?, imageUrl? }`
- `PUT /api/categories/:id` (admin, partial)
- `DELETE /api/categories/:id` (admin, 400 if products reference it)

## Products

- `GET /api/products?search=&category=<slug|id>&brand=&tag=<slug>&featured=1&minRating=&minPrice=<taka>&maxPrice=<taka>&sort=newest|price_asc|price_desc|rating&page=&limit=&all=1` → `{ products: [{...images, variants, tags, ratingAvg, ratingCount}], page, limit, total }` (`all=1` includes inactive + inactive variants)
- `GET /api/products/:slug` (`slug` or `id`) → `{ product: {...} }`
- `POST /api/products` (admin) `{ name, slug?, description?, priceCents, comparePriceCents?, sku?, stock?, categoryId?, isActive?, brand?, featured?, tags?: ["cotton"] }`
- `PUT /api/products/:id` (admin, partial; `tags` replaces all links)
- `DELETE /api/products/:id` (admin; explicitly cleans images, variants, tag links, reviews, cart lines — D1 doesn't enforce cascades)
- Variants (admin): `POST /api/products/:id/variants { name, value?, sku?, priceCents? (null = base price), stock?, isActive?, position? }`, `PUT /:id/variants/:vid` (partial), `DELETE /:id/variants/:vid` (removes cart lines; order history kept)
- `POST /api/products/:id/images` (admin) `{ publicId, secureUrl, width?, height?, position? }` — attach after Cloudinary upload
- `DELETE /api/products/:id/images/:imageId` (admin) — removes DB row only (see CLOUDINARY.md)
- `POST /api/products/:id/thumbnail { publicId, secureUrl }` (admin) — dedicated cover (cards + gallery default; falls back to first gallery image)
- `DELETE /api/products/:id/thumbnail` (admin) — removes cover; `PUT /api/products/:id { thumbnail: {...}|null }` also works
- `PATCH /api/products/:id/images/:imageId` (admin) `{ position }` — reorder gallery (0 = cover = card thumbnail)

Rule: when a product has active variants, cart/checkout require `variantId`; variant price overrides base, stock is per-variant.

## Cart (Bearer **or** `X-Guest-Token` — except merge)

Guest flow (no account needed to fill a cart):
1. `POST /api/cart/guest` → `{ guestToken, cartId }` (idempotent if you resend `X-Guest-Token`)
2. Send `X-Guest-Token: <token>` on all cart endpoints below
3. After login/register: `POST /api/cart/merge` (Bearer) `{ guestToken }` → quantities summed, stock-checked, guest cart deleted

- `GET /api/cart` → `{ items: [{...product, thumbnail}], subtotalCents, currency, guest }`
- `POST /api/cart/items` `{ productId, variantId?, qty }` (checks active + variant-aware stock)
- `PUT /api/cart/items/:productId[?variantId=]` `{ qty }` (`0` removes)
- `DELETE /api/cart/items/:productId[?variantId=]`, `DELETE /api/cart` (clear)

Checkout still requires login — merge first, then `POST /api/orders/checkout`.

## Orders (Bearer required)

- `POST /api/orders/checkout` — header **`Idempotency-Key: <uuid>`** required, body `{ couponCode?, shippingZoneId? }` → 201 `{ order, items }`, replay returns `{ ..., replayed: true }`. Validates cart non-empty, stock, coupon, zone; shipping snapshot on order (`shippingCents`, `shippingZone`); batch-writes order + items + stock decrement + cart clear; fires Telegram owner alert (best-effort).
- `GET /api/orders?page=&limit=` (own); `GET /api/orders?all=1` (admin, all users)
- `GET /api/orders/:id` (own or admin)
- `PATCH /api/orders/:id/status` (admin) `{ status: pending|paid|shipped|delivered|cancelled, carrier?, trackingNumber?, note? }` — records a timeline event
- `POST /api/orders/:id/cancel` (own pending, or admin) — restocks + records event
- `GET /api/orders/:id` returns `{ order, items, events }` (chronological timeline)

## Uploads

- `GET /api/uploads/config` → `{ cloudName, apiKey, folder }`
- `POST /api/uploads/signature` (admin) `{ folder?, publicId?, overwrite? }` → `{ uploadUrl, cloudName, apiKey, timestamp, folder, signature }`

## Meta

- `GET /api/meta` → `{ brands: [...], tags: [{name, slug}] }` (facets for shop filters)

## Users (admin)

- `GET /api/users?search=&page=&limit=` → `{ users: [{id, email, name, role, emailVerified, disabled, createdAt}], total }` (never password hashes)
- `PATCH /api/users/:id { role?, disabled? }` — never yourself; `disabled` rejects login/refresh/all authed calls

## Profile (customer)

- `PATCH /api/auth/profile { name?, phone? }`, `PUT /api/auth/avatar { publicId, secureUrl }` (after `POST /api/uploads/avatar-signature` + direct Cloudinary upload), `DELETE /api/auth/avatar`
- `CRUD /api/addresses` (`label, name, phone, line1, line2?, city, postalCode?, isDefault?`) — owner-only, one default auto-managed
- `GET /api/reviews/mine` — own reviews with product context

## Reviews

- `GET /api/products/:productId/reviews` (public)
- `POST /api/products/:productId/reviews` (auth) `{ rating 1-5, comment? }` — one per user, second POST updates; product `ratingAvg`/`ratingCount` recomputed on write/delete
- `DELETE /api/reviews/:id` (owner or admin)

## Coupons (admin)

- `GET /api/coupons`, `POST /api/coupons { code, percentOff 1-90, expiresAt? }`, `DELETE /api/coupons/:code`

## Shipping zones

- `GET /api/shipping-zones` (public, active only) → checkout dropdown
- `GET /api/shipping-zones/all`, `POST /api/shipping-zones { name, chargeCents, freeAboveCents?, active?, position? }`, `PUT /:id` (partial), `DELETE /:id` (admin)
- Orders snapshot `shippingCents` + `shippingZone`, so edits never rewrite history

## cURL smoke test

```bash
BASE=http://localhost:8787
# register + capture tokens (requires jq)
curl -s -X POST $BASE/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","name":"Admin","password":"password123"}'
# promote to admin (see D1.md), then:
TOKEN=<accessToken>
curl -s $BASE/api/categories -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/categories -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Tees"}'
curl -s "$BASE/api/products?limit=5"
curl -s -X POST $BASE/api/orders/checkout -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: test-1' -d '{}'
```
