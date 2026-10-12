import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { addresses } from "../db/schema";
import { requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const addressRoutes = new Hono<Env>();

const addressSchema = z.object({
  label: z.string().min(1).max(30).optional().default("Home"),
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  line1: z.string().min(1).max(300),
  line2: z.string().max(300).optional(),
  city: z.string().min(1).max(100),
  postalCode: z.string().max(20).optional(),
  isDefault: z.boolean().optional().default(false),
});
const addressUpdateSchema = addressSchema.partial();

async function ownOr404(db: ReturnType<typeof getDb>, userId: string, id: string) {
  const rows = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new HTTPException(404, { message: "Address not found" });
  return rows[0];
}

addressRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(addresses).where(eq(addresses.userId, user.id));
  return c.json({
    addresses: rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
  });
});

addressRoutes.post("/", requireAuth, zValidator("json", addressSchema), async (c) => {
  const user = c.get("authUser");
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const existing = await db.select().from(addresses).where(eq(addresses.userId, user.id));
  const makeDefault = input.isDefault || existing.length === 0;
  if (makeDefault) {
    for (const a of existing.filter((x) => x.isDefault)) {
      await db.update(addresses).set({ isDefault: false }).where(eq(addresses.id, a.id));
    }
  }
  const id = crypto.randomUUID();
  await db.insert(addresses).values({
    id,
    userId: user.id,
    label: input.label ?? "Home",
    name: input.name,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    postalCode: input.postalCode,
    isDefault: makeDefault,
  });
  const rows = await db.select().from(addresses).where(eq(addresses.id, id)).limit(1);
  return c.json({ address: rows[0] }, 201);
});

addressRoutes.put("/:id", requireAuth, zValidator("json", addressUpdateSchema), async (c) => {
  const user = c.get("authUser");
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const current = await ownOr404(db, user.id, c.req.param("id"));
  if (input.isDefault) {
    const siblings = await db.select().from(addresses).where(eq(addresses.userId, user.id));
    for (const s of siblings.filter((x) => x.id !== current.id && x.isDefault)) {
      await db.update(addresses).set({ isDefault: false }).where(eq(addresses.id, s.id));
    }
  }
  await db
    .update(addresses)
    .set({
      label: input.label ?? current.label,
      name: input.name ?? current.name,
      phone: input.phone ?? current.phone,
      line1: input.line1 ?? current.line1,
      line2: input.line2 ?? current.line2,
      city: input.city ?? current.city,
      postalCode: input.postalCode ?? current.postalCode,
      isDefault: input.isDefault ?? current.isDefault,
    })
    .where(eq(addresses.id, current.id));
  const updated = await db.select().from(addresses).where(eq(addresses.id, current.id)).limit(1);
  return c.json({ address: updated[0] });
});

addressRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("authUser");
  const db = getDb(c.env.DB);
  const current = await ownOr404(db, user.id, c.req.param("id"));
  await db.delete(addresses).where(eq(addresses.id, current.id));
  // Promote another address to default so checkout always has one.
  if (current.isDefault) {
    const rest = await db.select().from(addresses).where(eq(addresses.userId, user.id)).limit(1);
    if (rest[0]) {
      await db.update(addresses).set({ isDefault: true }).where(eq(addresses.id, rest[0].id));
    }
  }
  return c.json({ ok: true });
});
