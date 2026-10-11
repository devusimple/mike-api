import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { cartItems, carts, coupons, orderItems, orders, productVariants, products } from "../db/schema";
import { unitPriceFor } from "../lib/catalog";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const orderRoutes = new Hono<Env>();

const checkoutSchema = z.object({
  couponCode: z.string().max(50).optional(),
});

const statusSchema = z.object({
  status: z.enum(["pending", "paid", "shipped", "cancelled"]),
});

/**
 * POST /api/orders/checkout
 * Requires `Idempotency-Key` header to safely retry checkout.
 * No payment gateway in v1 — orders are created as `pending`
 * (cash-on-delivery / manual bKash). See docs/NEXT_STEPS.md for Stripe/SSLCommerz.
 */
orderRoutes.post("/checkout", requireAuth, zValidator("json", checkoutSchema), async (c) => {
  const user = c.get("authUser");
  const { couponCode } = c.req.valid("json");
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    throw new HTTPException(400, { message: "Idempotency-Key header is required" });
  }
  const db = getDb(c.env.DB);

  // Idempotent replay: return the original order.
  const prior = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
  if (prior[0]) {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, prior[0].id));
    return c.json({ order: prior[0], items, replayed: true });
  }

  const cartRows = await db.select().from(carts).where(eq(carts.userId, user.id)).limit(1);
  if (!cartRows[0]) throw new HTTPException(400, { message: "Cart is empty" });
  const lines = await db.select().from(cartItems).where(eq(cartItems.cartId, cartRows[0].id));
  if (!lines.length) throw new HTTPException(400, { message: "Cart is empty" });

  // Validate stock + snapshot prices (variant-aware).
  let subtotal = 0;
  const snapshots = [];
  for (const line of lines) {
    const prow = await db.select().from(products).where(eq(products.id, line.productId)).limit(1);
    const p = prow[0];
    if (!p || !p.isActive) throw new HTTPException(400, { message: `Product unavailable: ${line.productId}` });
    let variant = null;
    if (line.variantId) {
      const vrows = await db.select().from(productVariants).where(eq(productVariants.id, line.variantId)).limit(1);
      variant = vrows[0] ?? null;
      if (!variant || !variant.isActive) {
        throw new HTTPException(400, { message: `Variant unavailable: ${p.name}` });
      }
    }
    const stock = variant ? variant.stock : p.stock;
    if (stock < line.qty) {
      const label = variant ? `${p.name} (${variant.name})` : p.name;
      throw new HTTPException(400, { message: `Insufficient stock for ${label} (${stock} left)` });
    }
    const unit = unitPriceFor(p, variant);
    subtotal += unit * line.qty;
    snapshots.push({ product: p, variant, qty: line.qty, unit });
  }

  let discount = 0;
  let coupon: string | undefined;
  if (couponCode) {
    const code = couponCode.toUpperCase().trim();
    const found = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
    const cp = found[0];
    if (!cp || !cp.active || (cp.expiresAt && new Date(cp.expiresAt).getTime() < Date.now())) {
      throw new HTTPException(400, { message: "Invalid or expired coupon" });
    }
    discount = Math.round((subtotal * cp.percentOff) / 100);
    coupon = code;
  }
  const total = subtotal - discount;
  const orderId = crypto.randomUUID();

  // D1 has no multi-statement transactions via Drizzle; use a batch so the
  // write set (order, items, stock decrement, cart clear) applies atomically.
  await db.batch([
    db.insert(orders).values({
      id: orderId,
      userId: user.id,
      status: "pending",
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: total,
      couponCode: coupon,
      idempotencyKey,
    }),
    ...snapshots.map((s) =>
      db.insert(orderItems).values({
        id: crypto.randomUUID(),
        orderId,
        productId: s.product.id,
        productName: s.product.name,
        variantId: s.variant?.id ?? null,
        variantName: s.variant?.name ?? null,
        qty: s.qty,
        unitPriceCents: s.unit,
      }),
    ),
    ...snapshots.map((s) =>
      s.variant
        ? db
            .update(productVariants)
            .set({ stock: s.variant.stock - s.qty })
            .where(eq(productVariants.id, s.variant.id))
        : db
            .update(products)
            .set({ stock: s.product.stock - s.qty, updatedAt: new Date().toISOString() })
            .where(eq(products.id, s.product.id)),
    ),
    db.delete(cartItems).where(eq(cartItems.cartId, cartRows[0].id)),
  ] as any);

  const created = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const createdItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return c.json({ order: created[0], items: createdItems }, 201);
});

orderRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const showAll = c.req.query("all") === "1";
  if (showAll && user.role !== "admin") {
    throw new HTTPException(403, { message: "Admin only" });
  }
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
  let rows;
  if (showAll) {
    rows = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
  } else {
    rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, user.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
  }
  return c.json({ orders: rows, page, limit });
});

orderRoutes.get("/:id", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(orders).where(eq(orders.id, c.req.param("id"))).limit(1);
  const order = rows[0];
  if (!order) throw new HTTPException(404, { message: "Order not found" });
  if (order.userId !== user.id && user.role !== "admin") {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return c.json({ order, items });
});

orderRoutes.patch(
  "/:id/status",
  requireAuth,
  requireAdmin,
  zValidator("json", statusSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const { status } = c.req.valid("json");
    const rows = await db.select().from(orders).where(eq(orders.id, c.req.param("id"))).limit(1);
    if (!rows[0]) throw new HTTPException(404, { message: "Order not found" });
    await db.update(orders).set({ status }).where(eq(orders.id, rows[0].id));
    const updated = await db.select().from(orders).where(eq(orders.id, rows[0].id)).limit(1);
    return c.json({ order: updated[0] });
  },
);

orderRoutes.post("/:id/cancel", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(orders).where(eq(orders.id, c.req.param("id"))).limit(1);
  const order = rows[0];
  if (!order) throw new HTTPException(404, { message: "Order not found" });
  if (order.userId !== user.id && user.role !== "admin") {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  if (order.status !== "pending") {
    throw new HTTPException(400, { message: "Only pending orders can be cancelled" });
  }
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
  // Restock whatever the order consumed (variant or base stock).
  for (const item of items) {
    if (item.variantId) {
      const vrows = await db.select().from(productVariants).where(eq(productVariants.id, item.variantId)).limit(1);
      if (vrows[0]) {
        await db
          .update(productVariants)
          .set({ stock: vrows[0].stock + item.qty })
          .where(eq(productVariants.id, item.variantId));
      }
    } else if (item.productId) {
      const prow = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
      if (prow[0]) {
        await db
          .update(products)
          .set({ stock: prow[0].stock + item.qty })
          .where(eq(products.id, item.productId));
      }
    }
  }
  const updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  return c.json({ order: updated[0] });
});
