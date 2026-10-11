# Data model (D1 / SQLite)

Source of truth: `src/db/schema.ts` (Drizzle) + `drizzle/*.sql` (migrations — keep in sync).
IDs: `crypto.randomUUID()` text PKs. Money: integer cents. Time: `datetime('now')` ISO text.

```
users 1──1 carts 1──* cart_items *──1 products
users 1──* orders 1──* order_items (productName snapshotted, productId nullable for history)
users 1──* reviews *──1 products
products *──1 categories
products 1──* product_images
users 1──* refresh_tokens
coupons (code PK, percent_off, active, expires_at)
```

## Tables

| Table | Key columns | Notes |
|---|---|---|
| `users` | `email UNIQUE`, `role customer\|admin` | Password hash is PBKDF2 string, never raw |
| `categories` | `name/slug UNIQUE` | Delete blocked while products reference it |
| `products` | `slug/slug UNIQUE`, `price_cents`, `stock`, `category_id FK`, `is_active` | `compare_price_cents` = strikethrough MRP |
| `product_images` | `product_id → products ON DELETE CASCADE` | Stores `cloudinary_public_id` + `secure_url` + dims |
| `carts` / `cart_items` | `UNIQUE(user_id)`, `UNIQUE(cart_id, product_id)` | One cart per user, created at register |
| `coupons` | `code PK`, `percent_off`, `active`, `expires_at` | Code uppercased; discount = round(subtotal × pct/100) |
| `orders` | `status pending\|paid\|shipped\|cancelled`, `idempotency_key UNIQUE` | Totals snapshotted at checkout |
| `order_items` | `product_name` snapshot | `product_id` nullable so history survives deletion |
| `reviews` | `UNIQUE(product_id, user_id)`, `rating 1-5` | Re-POST updates existing review |
| `refresh_tokens` | `token_hash UNIQUE`, `expires_at`, `revoked` | sha256 of JWT, never the token |

## Invariants enforced in code

1. Checkout validates stock per line; insufficient stock → 400, nothing written.
2. Checkout batch = insert order + insert items + decrement stock + clear cart (atomic via D1 `batch()`).
3. `Idempotency-Key` → replay returns original order (`replayed: true`).
4. Cancel restocks only `pending` orders.
5. Product delete cascades images; category delete blocked when referenced.

## Changing the schema

```bash
# 1. edit src/db/schema.ts
# 2. add drizzle/0002_<what>.sql with ALTER/CREATE statements
bunx wrangler d1 migrations apply mike --local   # then --remote when live
```
