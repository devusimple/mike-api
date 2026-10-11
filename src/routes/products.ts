import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import {
  cartItems,
  categories,
  orderItems,
  productImages,
  productTags,
  productVariants,
  products,
  reviews,
  tags,
} from "../db/schema";
import { slugify } from "../lib/cloudinary";
import {
  cleanTagNames,
  setProductTags,
  tagsForProducts,
  variantsForProducts,
} from "../lib/catalog";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
type Db = ReturnType<typeof getDb>;
export const productRoutes = new Hono<Env>();

const thumbnailSchema = z.object({
  publicId: z.string().min(1).max(300),
  secureUrl: z.url().max(500),
});

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
  brand: z.string().max(100).optional(),
  featured: z.boolean().optional().default(false),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  thumbnail: thumbnailSchema.nullable().optional(),
});
const updateSchema = createSchema.partial();

const imageSchema = z.object({
  publicId: z.string().min(1).max(300),
  secureUrl: z.url().max(500),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  position: z.number().int().min(0).optional().default(0),
});

const variantSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().max(100).optional(),
  sku: z.string().max(100).optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).default(0),
  isActive: z.boolean().optional().default(true),
  position: z.number().int().min(0).optional().default(0),
});
const variantUpdateSchema = variantSchema.partial();

async function withExtras(
  db: Db,
  rows: (typeof products.$inferSelect)[],
  includeInactiveVariants: boolean,
) {
  const ids = rows.map((p) => p.id);
  if (!ids.length) return [];
  const [images, variants, tagMap] = await Promise.all([
    db.select().from(productImages).where(inArray(productImages.productId, ids)),
    variantsForProducts(db, ids, !includeInactiveVariants),
    tagsForProducts(db, ids),
  ]);
  return rows.map((p) => ({
    ...p,
    images: images.filter((i) => i.productId === p.id).sort((a, b) => a.position - b.position),
    variants: variants.get(p.id) ?? [],
    tags: tagMap.get(p.id) ?? [],
  }));
}

productRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query("search")?.trim() ?? "";
  const category = c.req.query("category");
  const brand = c.req.query("brand")?.trim();
  const tag = c.req.query("tag")?.trim();
  const featuredOnly = c.req.query("featured") === "1";
  const minRating = Number(c.req.query("minRating") ?? "NaN");
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
    const cats = await db.select().from(categories);
    const hit = cats.find((x) => x.id === category || x.slug === category);
    filters.push(eq(products.categoryId, hit ? hit.id : "__none__"));
  }
  if (brand) filters.push(eq(products.brand, brand));
  if (featuredOnly) filters.push(eq(products.featured, true));
  if (!Number.isNaN(minRating)) filters.push(gte(products.ratingAvg, minRating));
  if (tag) {
    const found = await db.select().from(tags).where(eq(tags.slug, slugify(tag))).limit(1);
    if (!found[0]) return c.json({ products: [], page, limit, total: 0 });
    const links = await db.select().from(productTags).where(eq(productTags.tagId, found[0].id));
    const ids = links.map((l) => l.productId);
    if (!ids.length) return c.json({ products: [], page, limit, total: 0 });
    filters.push(inArray(products.id, ids));
  }
  if (!Number.isNaN(minPrice)) filters.push(gte(products.priceCents, Math.round(minPrice * 100)));
  if (!Number.isNaN(maxPrice)) filters.push(lte(products.priceCents, Math.round(maxPrice * 100)));

  const where = filters.length ? and(...filters) : undefined;
  const orderBy =
    sort === "price_asc"
      ? products.priceCents
      : sort === "price_desc"
        ? desc(products.priceCents)
        : sort === "rating"
          ? desc(products.ratingAvg)
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

  return c.json({ products: await withExtras(db, rows, includeInactive), page, limit, total });
});

productRoutes.get("/:slug", async (c) => {
  const db = getDb(c.env.DB);
  const key = c.req.param("slug");
  const all = await db.select().from(products);
  const product = all.find((p) => p.id === key || p.slug === key);
  if (!product) throw new HTTPException(404, { message: "Product not found" });
  const [full] = await withExtras(db, [product], true);
  return c.json({ product: full });
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
      brand: input.brand?.trim() || null,
      featured: input.featured ?? false,
      thumbnailPublicId: input.thumbnail?.publicId ?? null,
      thumbnailSecureUrl: input.thumbnail?.secureUrl ?? null,
    });
  } catch {
    throw new HTTPException(409, { message: "Slug or SKU already exists" });
  }
  await setProductTags(db, id, cleanTagNames(input.tags));
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const [full] = await withExtras(db, rows, true);
  return c.json({ product: full }, 201);
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
      brand: input.brand !== undefined ? input.brand.trim() || null : rows[0].brand,
      featured: input.featured ?? rows[0].featured,
      thumbnailPublicId:
        input.thumbnail !== undefined ? (input.thumbnail?.publicId ?? null) : rows[0].thumbnailPublicId,
      thumbnailSecureUrl:
        input.thumbnail !== undefined ? (input.thumbnail?.secureUrl ?? null) : rows[0].thumbnailSecureUrl,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(products.id, id));
  if (input.tags !== undefined) await setProductTags(db, id, cleanTagNames(input.tags));
  const updated = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const [full] = await withExtras(db, updated, true);
  return c.json({ product: full });
});

productRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  // D1 does not enforce FK cascades — clean children explicitly.
  // Order history is kept: order_items.productId is nulled (names/prices stay).
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id));
  const variantIds = variants.map((v) => v.id);
  await db.batch([
    db.update(orderItems).set({ productId: null }).where(eq(orderItems.productId, id)),
    ...(variantIds.length
      ? [db.delete(cartItems).where(inArray(cartItems.variantId, variantIds))]
      : []),
    db.delete(cartItems).where(eq(cartItems.productId, id)),
    db.delete(productImages).where(eq(productImages.productId, id)),
    db.delete(productVariants).where(eq(productVariants.productId, id)),
    db.delete(productTags).where(eq(productTags.productId, id)),
    db.delete(reviews).where(eq(reviews.productId, id)),
    db.delete(products).where(eq(products.id, id)),
  ] as any);
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

const imageUpdateSchema = z.object({
  position: z.number().int().min(0).max(1000),
});

/** Reorder gallery images (position 0 = cover). Used by admin arrows/star. */
productRoutes.patch(
  "/:id/images/:imageId",
  requireAuth,
  requireAdmin,
  zValidator("json", imageUpdateSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(productImages)
      .where(
        and(
          eq(productImages.id, c.req.param("imageId")),
          eq(productImages.productId, c.req.param("id")),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new HTTPException(404, { message: "Image not found" });
    await db
      .update(productImages)
      .set({ position: c.req.valid("json").position })
      .where(eq(productImages.id, rows[0].id));
    const updated = await db
      .select()
      .from(productImages)
      .where(eq(productImages.id, rows[0].id))
      .limit(1);
    return c.json({ image: updated[0] });
  },
);

/* ---------------- thumbnail (admin, separate from gallery) ---------------- */

/** Set/replace the product thumbnail (card + gallery main fallback). */
productRoutes.post(
  "/:id/thumbnail",
  requireAuth,
  requireAdmin,
  zValidator("json", thumbnailSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const productId = c.req.param("id");
    const found = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!found[0]) throw new HTTPException(404, { message: "Product not found" });
    const input = c.req.valid("json");
    await db
      .update(products)
      .set({
        thumbnailPublicId: input.publicId,
        thumbnailSecureUrl: input.secureUrl,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, productId));
    // NOTE: replacing leaves the old Cloudinary asset orphaned — delete it
    // via the Admin API/Dashboard (same policy as gallery images).
    return c.json({
      thumbnail: { publicId: input.publicId, secureUrl: input.secureUrl },
    });
  },
);

/** Remove the thumbnail (cards fall back to the first gallery image). */
productRoutes.delete("/:id/thumbnail", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db
    .update(products)
    .set({ thumbnailPublicId: null, thumbnailSecureUrl: null, updatedAt: new Date().toISOString() })
    .where(eq(products.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- variants (admin) ---------------- */

productRoutes.post(
  "/:id/variants",
  requireAuth,
  requireAdmin,
  zValidator("json", variantSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const productId = c.req.param("id");
    const found = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!found[0]) throw new HTTPException(404, { message: "Product not found" });
    const input = c.req.valid("json");
    const id = crypto.randomUUID();
    try {
      await db.insert(productVariants).values({
        id,
        productId,
        name: input.name,
        value: input.value?.trim() || null,
        sku: input.sku,
        priceCents: input.priceCents ?? null,
        stock: input.stock ?? 0,
        isActive: input.isActive ?? true,
        position: input.position ?? 0,
      });
    } catch {
      throw new HTTPException(409, { message: "Variant SKU already exists" });
    }
    const rows = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
    return c.json({ variant: rows[0] }, 201);
  },
);

productRoutes.put(
  "/:id/variants/:vid",
  requireAuth,
  requireAdmin,
  zValidator("json", variantUpdateSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const input = c.req.valid("json");
    const rows = await db
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, c.req.param("vid")),
          eq(productVariants.productId, c.req.param("id")),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new HTTPException(404, { message: "Variant not found" });
    await db
      .update(productVariants)
      .set({
        name: input.name ?? rows[0].name,
        value: input.value !== undefined ? input.value.trim() || null : rows[0].value,
        sku: input.sku ?? rows[0].sku,
        priceCents: input.priceCents !== undefined ? (input.priceCents ?? null) : rows[0].priceCents,
        stock: input.stock ?? rows[0].stock,
        isActive: input.isActive ?? rows[0].isActive,
        position: input.position ?? rows[0].position,
      })
      .where(eq(productVariants.id, rows[0].id));
    const updated = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, rows[0].id))
      .limit(1);
    return c.json({ variant: updated[0] });
  },
);

productRoutes.delete("/:id/variants/:vid", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const vid = c.req.param("vid");
  // Remove dangling cart lines; order history keeps variantId + variantName.
  await db.batch([
    db.delete(cartItems).where(eq(cartItems.variantId, vid)),
    db.delete(productVariants).where(eq(productVariants.id, vid)),
  ] as any);
  return c.json({ ok: true });
});
