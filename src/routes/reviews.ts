import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { products, reviews } from "../db/schema";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
type Db = ReturnType<typeof getDb>;
export const reviewRoutes = new Hono<Env>();

const upsertSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().default(""),
});

/** Keep products.rating_avg / rating_count in sync (listings read them directly). */
async function refreshRating(db: Db, productId: string) {
  const rows = await db
    .select({
      avg: sql<number | null>`avg(${reviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(reviews)
    .where(eq(reviews.productId, productId));
  await db
    .update(products)
    .set({ ratingAvg: rows[0]?.avg ?? 0, ratingCount: rows[0]?.count ?? 0 })
    .where(eq(products.id, productId));
}

// Nested under /api/products/:productId/reviews — mounted in index.ts.
reviewRoutes.get("/:productId/reviews", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.productId, c.req.param("productId")));
  return c.json({ reviews: rows });
});

reviewRoutes.post(
  "/:productId/reviews",
  requireAuth,
  zValidator("json", upsertSchema),
  async (c) => {
    const user = c.get("authUser");
    const productId = c.req.param("productId");
    const input = c.req.valid("json");
    const db = getDb(c.env.DB);
    const prow = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!prow[0]) throw new HTTPException(404, { message: "Product not found" });
    const existing = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.userId, user.id)))
      .limit(1);
    if (existing[0]) {
      await db
        .update(reviews)
        .set({ rating: input.rating, comment: input.comment })
        .where(eq(reviews.id, existing[0].id));
      await refreshRating(db, productId);
      const updated = await db.select().from(reviews).where(eq(reviews.id, existing[0].id)).limit(1);
      return c.json({ review: updated[0] });
    }
    const id = crypto.randomUUID();
    await db.insert(reviews).values({
      id,
      productId,
      userId: user.id,
      rating: input.rating,
      comment: input.comment,
    });
    await refreshRating(db, productId);
    const rows = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return c.json({ review: rows[0] }, 201);
  },
);

reviewRoutes.delete("/reviews/:id", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(reviews).where(eq(reviews.id, c.req.param("id"))).limit(1);
  const review = rows[0];
  if (!review) throw new HTTPException(404, { message: "Review not found" });
  if (review.userId !== user.id && user.role !== "admin") {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  await db.delete(reviews).where(eq(reviews.id, review.id));
  await refreshRating(db, review.productId);
  return c.json({ ok: true });
});

// Standalone admin moderation endpoint.
export const adminReviewRoutes = new Hono<Env>();
adminReviewRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(reviews).where(eq(reviews.id, c.req.param("id")));
  return c.json({ ok: true });
});
