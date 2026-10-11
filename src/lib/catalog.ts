import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index";
import { productTags, productVariants, tags } from "../db/schema";
import { slugify } from "./cloudinary";

type Db = ReturnType<typeof getDb>;

/** Price actually charged: variant override wins, else the base price. */
export function unitPriceFor(
  product: { priceCents: number },
  variant: { priceCents: number | null } | null | undefined,
): number {
  return variant?.priceCents ?? product.priceCents;
}

/** Normalize user tag input ("Cotton, summer ") → ["Cotton", "summer"]. */
export function cleanTagNames(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
}

export async function ensureTagIds(db: Db, names: string[]): Promise<string[]> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  if (!clean.length) return [];
  const lower = clean.map((n) => n.toLowerCase());
  const existing = await db.select().from(tags);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of existing) {
    const i = lower.indexOf(t.name.toLowerCase());
    if (i !== -1 && !seen.has(t.id)) {
      seen.add(t.id);
      ids.push(t.id);
    }
  }
  const have = new Set(existing.map((t) => t.name.toLowerCase()));
  for (const name of clean) {
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    const id = crypto.randomUUID();
    try {
      await db.insert(tags).values({ id, name, slug: slugify(name) });
      ids.push(id);
    } catch {
      const rows = await db.select().from(tags).where(eq(tags.slug, slugify(name))).limit(1);
      if (rows[0] && !seen.has(rows[0].id)) {
        seen.add(rows[0].id);
        ids.push(rows[0].id);
      }
    }
  }
  return ids;
}

/** Replace all tag links of a product. */
export async function setProductTags(db: Db, productId: string, names: string[]) {
  await db.delete(productTags).where(eq(productTags.productId, productId));
  const ids = await ensureTagIds(db, names);
  for (const tagId of ids) {
    await db.insert(productTags).values({ productId, tagId });
  }
}

/** productId → its tags (batch helper for listings). */
export async function tagsForProducts(db: Db, productIds: string[]) {
  if (!productIds.length) return new Map<string, (typeof tags.$inferSelect)[]>();
  const links = await db.select().from(productTags).where(inArray(productTags.productId, productIds));
  const tagIds = [...new Set(links.map((l) => l.tagId))];
  const all = tagIds.length ? await db.select().from(tags).where(inArray(tags.id, tagIds)) : [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const out = new Map<string, (typeof tags.$inferSelect)[]>();
  for (const l of links) {
    const t = byId.get(l.tagId);
    if (!t) continue;
    const arr = out.get(l.productId) ?? [];
    arr.push(t);
    out.set(l.productId, arr);
  }
  return out;
}

/** productId → its active variants, ordered. */
export async function variantsForProducts(db: Db, productIds: string[], onlyActive = true) {
  if (!productIds.length) return new Map<string, (typeof productVariants.$inferSelect)[]>();
  const rows = await db
    .select()
    .from(productVariants)
    .where(inArray(productVariants.productId, productIds));
  const out = new Map<string, (typeof productVariants.$inferSelect)[]>();
  for (const v of rows
    .filter((v) => !onlyActive || v.isActive)
    .sort((a, b) => a.position - b.position)) {
    const arr = out.get(v.productId) ?? [];
    arr.push(v);
    out.set(v.productId, arr);
  }
  return out;
}
