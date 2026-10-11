import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { cartItems, carts, productImages, products } from "../db/schema";
import { requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const cartRoutes = new Hono<Env>();

const addSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().min(1).max(999).default(1),
});
const updateSchema = z.object({ qty: z.number().int().min(0).max(999) });

async function getOrCreateCart(db: ReturnType<typeof getDb>, userId: string) {
  const rows = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const id = crypto.randomUUID();
  await db.insert(carts).values({ id, userId });
  return { id, userId, createdAt: new Date().toISOString() };
}

cartRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const cart = await getOrCreateCart(db, user.id);
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
  const detailed = [];
  let subtotalCents = 0;
  for (const item of items) {
    const prow = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    const p = prow[0];
    if (!p) continue;
    const imgs = await db.select().from(productImages).where(eq(productImages.productId, p.id)).limit(1);
    subtotalCents += p.priceCents * item.qty;
    detailed.push({ ...item, product: p, thumbnail: imgs[0]?.secureUrl ?? null });
  }
  return c.json({ items: detailed, subtotalCents, currency: "BDT" });
});

cartRoutes.post("/items", requireAuth, zValidator("json", addSchema), async (c) => {
  const user = c.get("authUser");
  const { productId, qty } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const prow = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = prow[0];
  if (!product || !product.isActive) throw new HTTPException(404, { message: "Product not available" });
  if (product.stock < qty) throw new HTTPException(400, { message: `Only ${product.stock} in stock` });

  const cart = await getOrCreateCart(db, user.id);
  const existing = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)))
    .limit(1);
  if (existing[0]) {
    const nextQty = existing[0].qty + qty;
    if (product.stock < nextQty) {
      throw new HTTPException(400, { message: `Only ${product.stock} in stock` });
    }
    await db.update(cartItems).set({ qty: nextQty }).where(eq(cartItems.id, existing[0].id));
    return c.json({ item: { ...existing[0], qty: nextQty } });
  }
  const id = crypto.randomUUID();
  await db.insert(cartItems).values({ id, cartId: cart.id, productId, qty });
  const rows = await db.select().from(cartItems).where(eq(cartItems.id, id)).limit(1);
  return c.json({ item: rows[0] }, 201);
});

cartRoutes.put("/items/:productId", requireAuth, zValidator("json", updateSchema), async (c) => {
  const user = c.get("authUser");
  const { qty } = c.req.valid("json");
  const productId = c.req.param("productId");
  const db = getDb(c.env.DB);
  const cart = await getOrCreateCart(db, user.id);
  const existing = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)))
    .limit(1);
  if (!existing[0]) throw new HTTPException(404, { message: "Item not in cart" });
  if (qty === 0) {
    await db.delete(cartItems).where(eq(cartItems.id, existing[0].id));
    return c.json({ ok: true });
  }
  const prow = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (prow[0] && prow[0].stock < qty) {
    throw new HTTPException(400, { message: `Only ${prow[0].stock} in stock` });
  }
  await db.update(cartItems).set({ qty }).where(eq(cartItems.id, existing[0].id));
  return c.json({ item: { ...existing[0], qty } });
});

cartRoutes.delete("/items/:productId", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const cart = await getOrCreateCart(db, user.id);
  await db.delete(cartItems).where(
    and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, c.req.param("productId"))),
  );
  return c.json({ ok: true });
});

cartRoutes.delete("/", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const cart = await getOrCreateCart(db, user.id);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  return c.json({ ok: true });
});
