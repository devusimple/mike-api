import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { shippingZones } from "../db/schema";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const shippingRoutes = new Hono<Env>();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  chargeCents: z.number().int().min(0),
  freeAboveCents: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional().default(true),
  position: z.number().int().min(0).optional().default(0),
});
const updateSchema = createSchema.partial();

/** Public list of active zones for the checkout dropdown. */
shippingRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(shippingZones).where(eq(shippingZones.active, true));
  return c.json({ zones: rows.sort((a, b) => a.position - b.position) });
});

shippingRoutes.get("/all", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(shippingZones);
  return c.json({ zones: rows.sort((a, b) => a.position - b.position) });
});

shippingRoutes.post("/", requireAuth, requireAdmin, zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(shippingZones).values({
    id,
    name: input.name,
    chargeCents: input.chargeCents,
    freeAboveCents: input.freeAboveCents ?? null,
    active: input.active ?? true,
    position: input.position ?? 0,
  });
  const rows = await db.select().from(shippingZones).where(eq(shippingZones.id, id)).limit(1);
  return c.json({ zone: rows[0] }, 201);
});

shippingRoutes.put("/:id", requireAuth, requireAdmin, zValidator("json", updateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const rows = await db.select().from(shippingZones).where(eq(shippingZones.id, id)).limit(1);
  if (!rows[0]) throw new HTTPException(404, { message: "Zone not found" });
  await db
    .update(shippingZones)
    .set({
      name: input.name ?? rows[0].name,
      chargeCents: input.chargeCents ?? rows[0].chargeCents,
      freeAboveCents: input.freeAboveCents !== undefined ? (input.freeAboveCents ?? null) : rows[0].freeAboveCents,
      active: input.active ?? rows[0].active,
      position: input.position ?? rows[0].position,
    })
    .where(eq(shippingZones.id, id));
  const updated = await db.select().from(shippingZones).where(eq(shippingZones.id, id)).limit(1);
  return c.json({ zone: updated[0] });
});

shippingRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(shippingZones).where(eq(shippingZones.id, c.req.param("id")));
  return c.json({ ok: true });
});
