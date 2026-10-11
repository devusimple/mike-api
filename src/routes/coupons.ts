import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { coupons } from "../db/schema";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const couponRoutes = new Hono<Env>();

const createSchema = z.object({
  code: z.string().min(3).max(50),
  percentOff: z.number().int().min(1).max(90),
  expiresAt: z.iso.datetime().optional(),
});

couponRoutes.get("/", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  return c.json({ coupons: await db.select().from(coupons) });
});

couponRoutes.post("/", requireAuth, requireAdmin, zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const code = input.code.toUpperCase().trim();
  try {
    await db.insert(coupons).values({
      code,
      percentOff: input.percentOff,
      active: true,
      expiresAt: input.expiresAt,
    });
  } catch {
    throw new HTTPException(409, { message: "Coupon code already exists" });
  }
  const rows = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  return c.json({ coupon: rows[0] }, 201);
});

couponRoutes.delete("/:code", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(coupons).where(eq(coupons.code, c.req.param("code").toUpperCase()));
  return c.json({ ok: true });
});
