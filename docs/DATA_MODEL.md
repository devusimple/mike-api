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
| `products` | `slug/sku UNIQUE`, `price_cents`, `stock`, `category_id FK`, `is_active`, `brand`, `featured`, `rating_avg/count` (denormalized) | `compare_price_cents` = strikethrough MRP; `stock` used only when the product has no variants |
| `product_variants` | `product_id FK`, `name` ("Size") + `value` ("L"), `sku UNIQUE`, `price_cents` nullable (= base price), `stock`, `is_active` | Displayed as value ?? name; cart/checkout require a variant when actives exist; deletion removes cart lines, keeps order history |
| `tags` / `product_tags` | `UNIQUE(name)`, `UNIQUE(product_id, tag_id)` | Faceted filtering; `PUT product {tags}` replaces all links |
| `product_images` | `product_id → products ON DELETE CASCADE` | Stores `cloudinary_public_id` + `secure_url` + dims |
| `carts` / `cart_items` | `user_id` nullable (guest) or `guest_token` (secret uuid), `UNIQUE(cart_id, product_id, variant_id)` | One user cart (created at register) or one guest cart (`POST /cart/guest`); merged on login, quantities summed per (product, variant) |
| `coupons` | `code PK`, `percent_off`, `active`, `expires_at` | Code uppercased; discount = round(subtotal × pct/100) |
| `shipping_zones` | `name`, `charge_cents`, `free_above_cents` nullable, `active` | Free when subtotal ≥ threshold; order snapshots charge+name |
| `orders` | `status pending\|paid\|shipped\|cancelled`, `idempotency_key UNIQUE`, `shipping_cents` + `shipping_zone` snapshot | Totals snapshotted at checkout |
| `order_items` | `product_name` + `variant_name` snapshots | `product_id`/`variant_id` nullable so history survives deletion |
| `reviews` | `UNIQUE(product_id, user_id)`, `rating 1-5` | Re-POST updates existing review |
| `refresh_tokens` | `token_hash UNIQUE`, `expires_at`, `revoked` | sha256 of JWT, never the token |

## Invariants enforced in code

1. Checkout validates stock per line (variant stock when a variant is chosen, else base stock); insufficient stock → 400, nothing written.
2. Checkout batch = insert order + insert items (with variant snapshots) + decrement stock + clear cart (atomic via D1 `batch()`).
3. `Idempotency-Key` → replay returns original order (`replayed: true`).
4. Cancel restocks only `pending` orders (variant or base stock, whichever was consumed).
5. Product delete explicitly cleans images, variants, tag links, reviews, cart lines (D1 doesn't enforce FK cascades); order history is kept.

## Changing the schema

```bash
# 1. edit src/db/schema.ts
# 2. add drizzle/0002_<what>.sql with ALTER/CREATE statements
bunx wrangler d1 migrations apply mike --local   # then --remote when live
```
