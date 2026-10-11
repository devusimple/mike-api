import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { categories, products } from "../db/schema";
import { slugify } from "../lib/cloudinary";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const categoryRoutes = new Hono<Env>();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  imageUrl: z.url().max(500).optional(),
});
const updateSchema = createSchema.partial();

categoryRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(categories);
  return c.json({ categories: rows });
});

categoryRoutes.get("/:idOrSlug", async (c) => {
  const db = getDb(c.env.DB);
  const key = c.req.param("idOrSlug");
  const all = await db.select().from(categories);
  const cat = all.find((r) => r.id === key || r.slug === key);
  if (!cat) throw new HTTPException(404, { message: "Category not found" });
  const [{ value: productCount }] = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.categoryId, cat.id));
  return c.json({ category: cat, productCount });
});

categoryRoutes.post("/", requireAuth, requireAdmin, zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const slug = slugify(input.slug ?? input.name);
  try {
    const id = crypto.randomUUID();
    await db.insert(categories).values({
      id,
      name: input.name,
      slug,
      imageUrl: input.imageUrl,
    });
    const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    return c.json({ category: rows[0] }, 201);
  } catch {
    throw new HTTPException(409, { message: "Category name/slug already exists" });
  }
});

categoryRoutes.put("/:id", requireAuth, requireAdmin, zValidator("json", updateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!rows[0]) throw new HTTPException(404, { message: "Category not found" });
  await db
    .update(categories)
    .set({
      name: input.name ?? rows[0].name,
      slug: input.slug ? slugify(input.slug) : rows[0].slug,
      imageUrl: input.imageUrl ?? rows[0].imageUrl,
    })
    .where(eq(categories.id, id));
  const updated = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return c.json({ category: updated[0] });
});

categoryRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const used = await db.select().from(products).where(eq(products.categoryId, id)).limit(1);
  if (used[0]) {
    throw new HTTPException(400, { message: "Cannot delete category with products" });
  }
  await db.delete(categories).where(eq(categories.id, id));
  return c.json({ ok: true });
});
