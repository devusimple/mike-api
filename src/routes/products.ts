import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { categories, productImages, products } from "../db/schema";
import { slugify } from "../lib/cloudinary";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const productRoutes = new Hono<Env>();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().default(""),
  priceCents: z.number().int().min(0),
  comparePriceCents: z.number().int().min(0).optional(),
  sku: z.string().max(100).optional(),
  stock: z.number().int().min(0).default(0),
  categoryId: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});
const updateSchema = createSchema.partial();

const imageSchema = z.object({
  publicId: z.string().min(1).max(300),
  secureUrl: z.url().max(500),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  position: z.number().int().min(0).optional().default(0),
});

productRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query("search")?.trim() ?? "";
  const category = c.req.query("category");
  const minPrice = Number(c.req.query("minPrice") ?? "NaN");
  const maxPrice = Number(c.req.query("maxPrice") ?? "NaN");
  const sort = c.req.query("sort") ?? "newest";
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
  const includeInactive = c.req.query("all") === "1";

  const filters = [];
  if (!includeInactive) filters.push(eq(products.isActive, true));
  if (q) filters.push(or(like(products.name, `%${q}%`), like(products.description, `%${q}%`))!);
  if (category) {
    // Allow filtering by category slug or id.
    const cats = await db.select().from(categories);
    const hit = cats.find((x) => x.id === category || x.slug === category);
    filters.push(eq(products.categoryId, hit ? hit.id : "__none__"));
  }
  if (!Number.isNaN(minPrice)) filters.push(gte(products.priceCents, Math.round(minPrice * 100)));
  if (!Number.isNaN(maxPrice)) filters.push(lte(products.priceCents, Math.round(maxPrice * 100)));

  const where = filters.length ? and(...filters) : undefined;
  const orderBy =
    sort === "price_asc"
      ? products.priceCents
      : sort === "price_desc"
        ? desc(products.priceCents)
        : desc(products.createdAt);

  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ value: total }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(products)
    .where(where);

  // Attach first image per product for listing cards (1 extra query total).
  const images = await db.select().from(productImages);
  const withImages = rows.map((p) => ({
    ...p,
    images: images
      .filter((i) => i.productId === p.id)
      .sort((a, b) => a.position - b.position),
  }));
  return c.json({ products: withImages, page, limit, total });
});

productRoutes.get("/:slug", async (c) => {
  const db = getDb(c.env.DB);
  const key = c.req.param("slug");
  const all = await db.select().from(products);
  const product = all.find((p) => p.id === key || p.slug === key);
  if (!product) throw new HTTPException(404, { message: "Product not found" });
  const images = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, product.id));
  return c.json({
    product: { ...product, images: images.sort((a, b) => a.position - b.position) },
  });
});

productRoutes.post("/", requireAuth, requireAdmin, zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  if (input.categoryId) {
    const cat = await db.select().from(categories).where(eq(categories.id, input.categoryId)).limit(1);
    if (!cat[0]) throw new HTTPException(400, { message: "Invalid categoryId" });
  }
  const id = crypto.randomUUID();
  const slug = slugify(input.slug ?? input.name);
  try {
    await db.insert(products).values({
      id,
      slug,
      name: input.name,
      description: input.description ?? "",
      priceCents: input.priceCents,
      comparePriceCents: input.comparePriceCents,
      sku: input.sku,
      stock: input.stock ?? 0,
      categoryId: input.categoryId,
      isActive: input.isActive ?? true,
    });
  } catch {
    throw new HTTPException(409, { message: "Slug or SKU already exists" });
  }
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return c.json({ product: rows[0] }, 201);
});

productRoutes.put("/:id", requireAuth, requireAdmin, zValidator("json", updateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!rows[0]) throw new HTTPException(404, { message: "Product not found" });
  await db
    .update(products)
    .set({
      name: input.name ?? rows[0].name,
      slug: input.slug ? slugify(input.slug) : rows[0].slug,
      description: input.description ?? rows[0].description,
      priceCents: input.priceCents ?? rows[0].priceCents,
      comparePriceCents: input.comparePriceCents ?? rows[0].comparePriceCents,
      sku: input.sku ?? rows[0].sku,
      stock: input.stock ?? rows[0].stock,
      categoryId: input.categoryId ?? rows[0].categoryId,
      isActive: input.isActive ?? rows[0].isActive,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(products.id, id));
  const updated = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return c.json({ product: updated[0] });
});

productRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(products).where(eq(products.id, c.req.param("id")));
  return c.json({ ok: true });
});

// Attach an already-uploaded Cloudinary image to a product.
// Client flow: POST /api/uploads/signature -> upload to Cloudinary -> POST here.
productRoutes.post(
  "/:id/images",
  requireAuth,
  requireAdmin,
  zValidator("json", imageSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const productId = c.req.param("id");
    const found = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!found[0]) throw new HTTPException(404, { message: "Product not found" });
    const input = c.req.valid("json");
    const id = crypto.randomUUID();
    await db.insert(productImages).values({
      id,
      productId,
      cloudinaryPublicId: input.publicId,
      secureUrl: input.secureUrl,
      width: input.width,
      height: input.height,
      position: input.position ?? 0,
    });
    const rows = await db.select().from(productImages).where(eq(productImages.id, id)).limit(1);
    return c.json({ image: rows[0] }, 201);
  },
);

productRoutes.delete("/:id/images/:imageId", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(productImages).where(eq(productImages.id, c.req.param("imageId")));
  // NOTE: this only removes the DB row. Delete the asset in Cloudinary via
  // the Admin API (server-side) or Dashboard — see docs/CLOUDINARY.md.
  return c.json({ ok: true });
});
