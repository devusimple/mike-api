import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { products, tags } from "../db/schema";

type Env = { Bindings: CloudflareBindings };
export const metaRoutes = new Hono<Env>();

/** Filter facets for the shop: distinct brands + all tags. */
metaRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const [prows, trows] = await Promise.all([
    db.select({ brand: products.brand }).from(products).where(eq(products.isActive, true)),
    db.select().from(tags),
  ]);
  const brands = [...new Set(prows.map((r) => r.brand).filter((b): b is string => !!b && b.trim() !== ""))].sort();
  return c.json({
    brands,
    tags: trows.map((t) => ({ name: t.name, slug: t.slug })).sort((a, b) => a.name.localeCompare(b.name)),
  });
});
