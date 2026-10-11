import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** User roles. `admin` can manage catalog/coupons/orders. */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["customer", "admin"] })
      .notNull()
      .default("customer"),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    imageUrl: text("image_url"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("categories_name_unique").on(t.name),
    uniqueIndex("categories_slug_unique").on(t.slug),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    /** Prices stored as integer cents to avoid float errors. */
    priceCents: integer("price_cents").notNull(),
    comparePriceCents: integer("compare_price_cents"),
    sku: text("sku"),
    stock: integer("stock").notNull().default(0),
    categoryId: text("category_id").references(() => categories.id),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Brand facet, e.g. "Aarong". */
    brand: text("brand"),
    /** Curated flag for homepage shelves. */
    featured: integer("featured", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Denormalized from reviews on every write (avoids N+1 on listings). */
    ratingAvg: real("rating_avg").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("products_slug_unique").on(t.slug),
    uniqueIndex("products_sku_unique").on(t.sku),
    index("products_category_idx").on(t.categoryId),
    index("products_active_idx").on(t.isActive),
  ],
);

export const productImages = sqliteTable("product_images", {  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  cloudinaryPublicId: text("cloudinary_public_id").notNull(),
  secureUrl: text("secure_url").notNull(),
  width: integer("width"),
  height: integer("height"),
  position: integer("position").notNull().default(0),
});

/** Size/color options with own SKU, price, and stock (e.g. "Black / L"). */
export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    /** Null = inherit the product's price. */
    priceCents: integer("price_cents"),
    stock: integer("stock").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("product_variants_sku_unique").on(t.sku),
    index("product_variants_product_idx").on(t.productId),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [
    uniqueIndex("tags_name_unique").on(t.name),
    uniqueIndex("tags_slug_unique").on(t.slug),
  ],
);

export const productTags = sqliteTable(
  "product_tags",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("product_tags_unique").on(t.productId, t.tagId),
    index("product_tags_tag_idx").on(t.tagId),
  ],
);

export const carts = sqliteTable(
  "carts",
  {
    id: text("id").primaryKey(),
    /** Null for guest carts (identified by `guestToken` instead). */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Secret token issued to anonymous shoppers; sent as `X-Guest-Token`. */
    guestToken: text("guest_token"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("carts_user_unique").on(t.userId),
    uniqueIndex("carts_guest_unique").on(t.guestToken),
  ],
);

export const cartItems = sqliteTable(
  "cart_items",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Null = base product. Required by API when the product has variants. */
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    qty: integer("qty").notNull().default(1),
  },
  (t) => [uniqueIndex("cart_items_cart_product_variant_unique").on(t.cartId, t.productId, t.variantId)],
);

export const coupons = sqliteTable(
  "coupons",
  {
    code: text("code").primaryKey(),
    percentOff: integer("percent_off").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    expiresAt: text("expires_at"),
  },
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status", {
      enum: ["pending", "paid", "shipped", "cancelled"],
    })
      .notNull()
      .default("pending"),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    couponCode: text("coupon_code"),
    /** Client-supplied `Idempotency-Key` header; prevents double checkout. */
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("orders_idempotency_unique").on(t.idempotencyKey),
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
  ],
);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").references(() => products.id),
  productName: text("product_name").notNull(),
  /** Snapshots; variant rows are never deleted so history stays intact. */
  variantId: text("variant_id").references(() => productVariants.id),
  variantName: text("variant_name"),
  qty: integer("qty").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment").default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("reviews_product_user_unique").on(t.productId, t.userId),
    index("reviews_product_idx").on(t.productId),
  ],
);

/** Hashed refresh tokens for rotation + logout. Stores sha256(token). */
export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

/**
 * Single-use email tokens (email verification + password reset).
 * Only sha256 hashes are stored — raw tokens travel by email link only.
 */
export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose", { enum: ["verify_email", "reset_password"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);
