import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { cartItems, carts, productImages, productVariants, products } from "../db/schema";
import { unitPriceFor, variantLabel } from "../lib/catalog";
import { getOptionalUser, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
type Ctx = { req: { header(name: string): string | undefined }; env: CloudflareBindings };
type Db = ReturnType<typeof getDb>;
export const cartRoutes = new Hono<Env>();

const addSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  qty: z.number().int().min(1).max(999).default(1),
});
const updateSchema = z.object({ qty: z.number().int().min(0).max(999) });
const mergeSchema = z.object({ guestToken: z.string().min(1) });

async function getOrCreateUserCart(db: Db, userId: string) {
  const rows = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const id = crypto.randomUUID();
  await db.insert(carts).values({ id, userId, guestToken: null });
  const created = await db.select().from(carts).where(eq(carts.id, id)).limit(1);
  return created[0];
}

/**
 * Resolve the caller's cart from either auth or guest identity:
 * - `Authorization: Bearer <token>` → the user's cart (created on demand)
 * - `X-Guest-Token: <token>` → an existing guest cart (from POST /guest)
 */
async function resolveCart(c: Ctx, db: Db) {
  const user = await getOptionalUser(c);
  if (user) return getOrCreateUserCart(db, user.id);
  const guestToken = c.req.header("X-Guest-Token")?.trim();
  if (!guestToken) {
    throw new HTTPException(401, {
      message: "Login or send X-Guest-Token header (get one from POST /api/cart/guest)",
    });
  }
  const rows = await db.select().from(carts).where(eq(carts.guestToken, guestToken)).limit(1);
  const cart = rows[0];
  if (!cart) {
    throw new HTTPException(404, {
      message: "Guest cart not found or expired — POST /api/cart/guest for a new one",
    });
  }
  return cart;
}

/** Match one cart line: variant-aware (NULL variant = base product). */
function lineCondition(cartId: string, productId: string, variantId?: string | null) {
  return variantId
    ? and(
        eq(cartItems.cartId, cartId),
        eq(cartItems.productId, productId),
        eq(cartItems.variantId, variantId),
      )
    : and(
        eq(cartItems.cartId, cartId),
        eq(cartItems.productId, productId),
        isNull(cartItems.variantId),
      );
}

/** Validate product + variant choice; returns pricing/stock source. */
async function resolveStock(
  db: Db,
  productId: string,
  variantId?: string,
): Promise<{ product: typeof products.$inferSelect; variant: typeof productVariants.$inferSelect | null }> {
  const prow = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = prow[0];
  if (!product || !product.isActive) throw new HTTPException(404, { message: "Product not available" });
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  const active = variants.filter((v) => v.isActive);
  if (active.length > 0) {
    if (!variantId) {
      throw new HTTPException(400, {
        message: `Pick an option: ${active.map((v) => variantLabel(v)).join(", ")}`,
      });
    }
    const variant = active.find((v) => v.id === variantId);
    if (!variant) throw new HTTPException(400, { message: "Invalid variant for this product" });
    return { product, variant };
  }
  if (variantId) throw new HTTPException(400, { message: "This product has no variants" });
  return { product, variant: null };
}

function availableStock(
  product: typeof products.$inferSelect,
  variant: typeof productVariants.$inferSelect | null,
): number {
  return variant ? variant.stock : product.stock;
}

async function cartDetail(db: Db, cartId: string, guest: boolean) {
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
  const detailed = [];
  let subtotalCents = 0;
  for (const item of items) {
    const prow = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    const p = prow[0];
    if (!p) continue;
    let variant = null;
    if (item.variantId) {
      const vrows = await db.select().from(productVariants).where(eq(productVariants.id, item.variantId)).limit(1);
      variant = vrows[0] ?? null;
      if (!variant) continue; // variant deleted — line will be cleaned on next write
    }
    const unit = unitPriceFor(p, variant);
    const imgs = await db.select().from(productImages).where(eq(productImages.productId, p.id)).limit(1);
    subtotalCents += unit * item.qty;
    detailed.push({
      ...item,
      product: p,
      variant: variant
        ? { id: variant.id, name: variant.name, value: variant.value, priceCents: variant.priceCents }
        : null,
      unitPriceCents: unit,
      thumbnail: p.thumbnailSecureUrl ?? imgs[0]?.secureUrl ?? null,
    });
  }
  return { items: detailed, subtotalCents, currency: "BDT", guest };
}

/** Issue a guest cart. Public — call before adding items anonymously. */
cartRoutes.post("/guest", async (c) => {
  const db = getDb(c.env.DB);
  const existing = c.req.header("X-Guest-Token")?.trim();
  if (existing) {
    const rows = await db.select().from(carts).where(eq(carts.guestToken, existing)).limit(1);
    if (rows[0]) return c.json({ guestToken: existing, cartId: rows[0].id });
  }
  const guestToken = crypto.randomUUID();
  const id = crypto.randomUUID();
  await db.insert(carts).values({ id, userId: null, guestToken });
  return c.json({ guestToken, cartId: id }, 201);
});

/**
 * Merge a guest cart into the logged-in user's cart (call after login/register).
 * Quantities are summed per (product, variant); stock is validated; the guest cart is deleted.
 */
cartRoutes.post("/merge", requireAuth, zValidator("json", mergeSchema), async (c) => {
  const user = c.get("authUser");
  const { guestToken } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const guestRows = await db.select().from(carts).where(eq(carts.guestToken, guestToken)).limit(1);
  const guest = guestRows[0];
  if (!guest) throw new HTTPException(404, { message: "Guest cart not found" });
  const userCart = await getOrCreateUserCart(db, user.id);
  if (guest.id === userCart.id) return c.json({ merged: 0 });

  const lines = await db.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
  // Heterogeneous list of drizzle query builders for one atomic batch.
  const ops: any[] = [];
  for (const line of lines) {
    const { product, variant } = await resolveStock(db, line.productId, line.variantId ?? undefined).catch(
      () => ({ product: null as any, variant: null }),
    );
    if (!product) {
      throw new HTTPException(400, { message: `Product unavailable: ${line.productId}` });
    }
    const existing = await db
      .select()
      .from(cartItems)
      .where(lineCondition(userCart.id, line.productId, line.variantId))
      .limit(1);
    const total = (existing[0]?.qty ?? 0) + line.qty;
    if (availableStock(product, variant) < total) {
      const label = variant ? `${product.name} (${variantLabel(variant)})` : product.name;
      throw new HTTPException(400, {
        message: `Insufficient stock for ${label} (${availableStock(product, variant)} left)`,
      });
    }
    if (existing[0]) {
      ops.push(db.update(cartItems).set({ qty: total }).where(eq(cartItems.id, existing[0].id)));
    } else {
      ops.push(
        db.insert(cartItems).values({
          id: crypto.randomUUID(),
          cartId: userCart.id,
          productId: line.productId,
          variantId: line.variantId,
          qty: line.qty,
        }),
      );
    }
  }
  ops.push(db.delete(cartItems).where(eq(cartItems.cartId, guest.id)));
  ops.push(db.delete(carts).where(eq(carts.id, guest.id)));
  // Non-empty by construction (always ends with the two deletes above).
  await db.batch(ops as any);
  return c.json({ merged: lines.length });
});

cartRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const cart = await resolveCart(c, db);
  return c.json(await cartDetail(db, cart.id, cart.userId == null));
});

cartRoutes.post("/items", zValidator("json", addSchema), async (c) => {
  const { productId, variantId, qty } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const { product, variant } = await resolveStock(db, productId, variantId);
  if (availableStock(product, variant) < qty) {
    throw new HTTPException(400, { message: `Only ${availableStock(product, variant)} in stock` });
  }

  const cart = await resolveCart(c, db);
  const existing = await db
    .select()
    .from(cartItems)
    .where(lineCondition(cart.id, productId, variant?.id ?? null))
    .limit(1);
  if (existing[0]) {
    const nextQty = existing[0].qty + qty;
    if (availableStock(product, variant) < nextQty) {
      throw new HTTPException(400, { message: `Only ${availableStock(product, variant)} in stock` });
    }
    await db.update(cartItems).set({ qty: nextQty }).where(eq(cartItems.id, existing[0].id));
    return c.json({ item: { ...existing[0], qty: nextQty } });
  }
  const id = crypto.randomUUID();
  await db.insert(cartItems).values({ id, cartId: cart.id, productId, variantId: variant?.id ?? null, qty });
  const rows = await db.select().from(cartItems).where(eq(cartItems.id, id)).limit(1);
  return c.json({ item: rows[0] }, 201);
});

cartRoutes.put("/items/:productId", zValidator("json", updateSchema), async (c) => {
  const { qty } = c.req.valid("json");
  const productId = c.req.param("productId");
  const variantId = c.req.query("variantId")?.trim() || null;
  const db = getDb(c.env.DB);
  const cart = await resolveCart(c, db);
  const existing = await db
    .select()
    .from(cartItems)
    .where(lineCondition(cart.id, productId, variantId))
    .limit(1);
  if (!existing[0]) throw new HTTPException(404, { message: "Item not in cart" });
  if (qty === 0) {
    await db.delete(cartItems).where(eq(cartItems.id, existing[0].id));
    return c.json({ ok: true });
  }
  const { product, variant } = await resolveStock(db, productId, variantId ?? undefined);
  if (availableStock(product, variant) < qty) {
    throw new HTTPException(400, { message: `Only ${availableStock(product, variant)} in stock` });
  }
  await db.update(cartItems).set({ qty }).where(eq(cartItems.id, existing[0].id));
  return c.json({ item: { ...existing[0], qty } });
});

cartRoutes.delete("/items/:productId", async (c) => {
  const db = getDb(c.env.DB);
  const cart = await resolveCart(c, db);
  const variantId = c.req.query("variantId")?.trim() || null;
  await db.delete(cartItems).where(lineCondition(cart.id, c.req.param("productId"), variantId));
  return c.json({ ok: true });
});

cartRoutes.delete("/", async (c) => {
  const db = getDb(c.env.DB);
  const cart = await resolveCart(c, db);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  return c.json({ ok: true });
});
