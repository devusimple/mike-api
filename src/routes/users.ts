import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { users } from "../db/schema";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const userRoutes = new Hono<Env>();

const updateSchema = z.object({
  role: z.enum(["customer", "admin"]).optional(),
  disabled: z.boolean().optional(),
});

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: !!u.emailVerified,
    disabled: !!u.disabled,
    createdAt: u.createdAt,
  };
}

/** Paginated user list (admin). Password hashes never leave the server. */
userRoutes.get("/", requireAuth, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query("search")?.trim() ?? "";
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
  const where = q ? or(like(users.email, `%${q}%`), like(users.name, `%${q}%`)) : undefined;
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ value: total }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(users)
    .where(where);
  return c.json({ users: rows.map(publicUser), page, limit, total });
});

/** Change role / disabled flag (admin). Never on yourself. */
userRoutes.patch("/:id", requireAuth, requireAdmin, zValidator("json", updateSchema), async (c) => {
  const me = c.get("authUser");
  const id = c.req.param("id");
  if (id === me.id) {
    throw new HTTPException(400, { message: "You cannot change your own role or status" });
  }
  const input = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!rows[0]) throw new HTTPException(404, { message: "User not found" });
  await db
    .update(users)
    .set({
      role: input.role ?? rows[0].role,
      disabled: input.disabled ?? rows[0].disabled,
    })
    .where(eq(users.id, id));
  const updated = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return c.json({ user: publicUser(updated[0]) });
});
