# API reference (v1)

Base URL (dev): `http://localhost:8787` · Prod: `https://mike.<you>.workers.dev`
Machine index: `GET /api/docs` · Health: `GET /health`
Currency: **BDT**, all prices are **integer cents** (`25000` = ৳250.00).
Pagination: `?page=1&limit=20` (max 100).
Errors: `{ "error": "<message>", "status": <code> }`.

## Auth

| Method | Endpoint | Auth | Body |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{ email, password≥8, name }` → 201 `{ user, accessToken, refreshToken }` + `refresh_token` cookie |
| POST | `/api/auth/login` | – | `{ email, password }` → same as above |
| POST | `/api/auth/refresh` | – | `{ refreshToken }` (or cookie) → rotates, returns new pair |
| POST | `/api/auth/logout` | – | `{ refreshToken }` → revokes |
| GET | `/api/auth/me` | Bearer | → `{ user }` |

## Categories

- `GET /api/categories` → `{ categories }`
- `GET /api/categories/:idOrSlug` → `{ category, productCount }`
- `POST /api/categories` (admin) `{ name, slug?, imageUrl? }`
- `PUT /api/categories/:id` (admin, partial)
- `DELETE /api/categories/:id` (admin, 400 if products reference it)

## Products

- `GET /api/products?search=&category=<slug|id>&minPrice=<taka>&maxPrice=<taka>&sort=newest|price_asc|price_desc&page=&limit=&all=1` → `{ products: [{...images}], page, limit, total }` (`all=1` includes inactive; normally filtered)
- `GET /api/products/:slug` (`slug` or `id`) → `{ product: {...images} }`
- `POST /api/products` (admin) `{ name, slug?, description?, priceCents, comparePriceCents?, sku?, stock?, categoryId?, isActive? }`
- `PUT /api/products/:id` (admin, partial)
- `DELETE /api/products/:id` (admin, cascades images)
- `POST /api/products/:id/images` (admin) `{ publicId, secureUrl, width?, height?, position? }` — attach after Cloudinary upload
- `DELETE /api/products/:id/images/:imageId` (admin) — removes DB row only (see CLOUDINARY.md)

## Cart (Bearer required)

- `GET /api/cart` → `{ items: [{...product, thumbnail}], subtotalCents, currency }`
- `POST /api/cart/items` `{ productId, qty }` (checks active + stock)
- `PUT /api/cart/items/:productId` `{ qty }` (`0` removes)
- `DELETE /api/cart/items/:productId`, `DELETE /api/cart` (clear)

## Orders (Bearer required)

- `POST /api/orders/checkout` — header **`Idempotency-Key: <uuid>`** required, body `{ couponCode? }` → 201 `{ order, items }`, replay returns `{ ..., replayed: true }`. Validates cart non-empty, stock, coupon; batch-writes order + items + stock decrement + cart clear.
- `GET /api/orders?page=&limit=` (own); `GET /api/orders?all=1` (admin, all users)
- `GET /api/orders/:id` (own or admin)
- `PATCH /api/orders/:id/status` (admin) `{ status: pending|paid|shipped|cancelled }`
- `POST /api/orders/:id/cancel` (own pending, or admin) — restocks

## Uploads

- `GET /api/uploads/config` → `{ cloudName, apiKey, folder }`
- `POST /api/uploads/signature` (admin) `{ folder?, publicId?, overwrite? }` → `{ uploadUrl, cloudName, apiKey, timestamp, folder, signature }`

## Reviews

- `GET /api/products/:productId/reviews` (public)
- `POST /api/products/:productId/reviews` (auth) `{ rating 1-5, comment? }` — one per user, second POST updates
- `DELETE /api/reviews/:id` (owner or admin)

## Coupons (admin)

- `GET /api/coupons`, `POST /api/coupons { code, percentOff 1-90, expiresAt? }`, `DELETE /api/coupons/:code`

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
