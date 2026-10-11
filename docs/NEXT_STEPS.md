# Next steps (payments, admin UI, and upgrades — in recommended order)

## 1. Payments (orders already support it: `status` → `paid`)

- **Stripe:** add `payment_intent_id` to `orders`, `POST /api/payments/checkout` (create PI from order total), `POST /api/payments/webhook` (verify signature with `STRIPE_WEBHOOK_SECRET`, set `paid` + decrement stock *there* instead of at checkout). Keep idempotency keys.
- **Bangladesh (SSLCommerz/bKash):** same shape — `POST /api/payments/init` returns gateway URL, gateway callback hits `/api/payments/callback` → verify → mark `paid`. COD stays default until then.
- Until then: manual bKash number in checkout response + admin marks `paid`.

## 2. Admin UI (no UI in v1 — APIs are ready)

Build against: `GET /api/orders?all=1`, `PATCH /api/orders/:id/status`, product/category CRUD, `GET/POST/DELETE /api/coupons`, `GET /api/uploads/config` + signature flow. Suggested pages: login (`/auth/login` + `/me`), product table (image attach via Cloudinary widget), order board (pending→shipped), coupon list, low-stock (`stock<5`) via `GET /api/products?all=1`.

## 3. Storefront upgrades

- Guest checkout: allow `POST /api/orders/checkout` with `X-Guest-Token` + email capture (orders need nullable `user_id` + `guest_email`); fraud/abuse review before enabling.
- Search: D1 `LIKE` is fine <10k products; beyond that use Cloudflare Workers Search or Algolia.
- Wishlist, addresses table, shipping zones, VAT, order tracking timeline.
- Reviews: photos (reuse Cloudinary flow), helpful votes, admin moderation queue.

## 4. Hardening before launch

- Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to your shop + admin domains (localhost is always allowed for dev).
- Rate-limit login/refresh (KV or Durable Objects) — done via `RATE_LIMIT_KV`.
- Known D1 limit: truly-parallel writes (e.g. 5 logins in the same millisecond from different tabs) can hit single-writer contention and 500 once; sequential retries succeed. Double-submits are safe. If this ever matters, add one retry on `SQLITE_BUSY` in the write paths.
- `DELETE /api/uploads/:publicId` proxy (Admin API destroy) so image delete frees storage.
- Audit log table (`admin_actions`), Sentry/workers observability, `bun run cf-typegen` in CI.
- Backups: cron `wrangler d1 export` to R2.
