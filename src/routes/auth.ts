import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { carts, refreshTokens, users } from "../db/schema";
import { hashPassword, sha256Hex, verifyPassword } from "../lib/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt";
import { requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const authRoutes = new Hono<Env>();

const registerSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});
const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

const REFRESH_COOKIE = "refresh_token";
const REFRESH_MAX_AGE = 30 * 24 * 3600;

function publicUser(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

async function issuePair(secret: string, userId: string, role: "customer" | "admin") {
  const accessToken = await signAccessToken(secret, { sub: userId, role });
  const refreshToken = await signRefreshToken(secret, userId);
  return { accessToken, refreshToken };
}

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const { email, password, name } = c.req.valid("json");
  if (!c.env.JWT_SECRET) throw new HTTPException(500, { message: "JWT_SECRET not configured" });
  const db = getDb(c.env.DB);
  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing[0]) throw new HTTPException(409, { message: "Email already registered" });

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    id,
    email: email.toLowerCase(),
    passwordHash,
    name,
    role: "customer",
  });
  // Every user gets a cart row up-front so cart routes stay simple.
  await db.insert(carts).values({ id: crypto.randomUUID(), userId: id });

  const { accessToken, refreshToken } = await issuePair(c.env.JWT_SECRET, id, "customer");
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: id,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000).toISOString(),
  });
  c.header(
    "Set-Cookie",
    `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; Path=/; Max-Age=${REFRESH_MAX_AGE}; SameSite=Lax; Secure`,
  );
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return c.json({ user: publicUser(rows[0]), accessToken, refreshToken }, 201);
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HTTPException(401, { message: "Invalid credentials" });
  }
  const { accessToken, refreshToken } = await issuePair(
    c.env.JWT_SECRET,
    user.id,
    user.role as "customer" | "admin",
  );
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000).toISOString(),
  });
  c.header(
    "Set-Cookie",
    `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; Path=/; Max-Age=${REFRESH_MAX_AGE}; SameSite=Lax; Secure`,
  );
  return c.json({ user: publicUser(user), accessToken, refreshToken });
});

function tokenFromBodyOrCookie(c: { req: { valid: (k: "json") => { refreshToken: string } } }): string {
  return c.req.valid("json").refreshToken;
}

authRoutes.post("/refresh", zValidator("json", refreshSchema), async (c) => {
  // Accepts JSON { refreshToken } — clients using httpOnly cookies can also
  // POST the cookie value; see docs/AUTH.md for the web flow.
  const bodyToken = tokenFromBodyOrCookie(c);
  const cookieHeader = c.req.header("Cookie") ?? "";
  const cookieToken = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${REFRESH_COOKIE}=`))
    ?.slice(REFRESH_COOKIE.length + 1);
  const token = bodyToken || cookieToken;
  if (!token) throw new HTTPException(401, { message: "Missing refresh token" });

  let userId: string;
  try {
    userId = await verifyRefreshToken(c.env.JWT_SECRET, token);
  } catch {
    throw new HTTPException(401, { message: "Invalid refresh token" });
  }
  const db = getDb(c.env.DB);
  const hash = await sha256Hex(token);
  const stored = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);
  const row = stored[0];
  if (!row || row.revoked || new Date(row.expiresAt).getTime() < Date.now()) {
    throw new HTTPException(401, { message: "Refresh token revoked or expired" });
  }
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) throw new HTTPException(401, { message: "User no longer exists" });

  // Rotate: revoke old, issue new pair.
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, row.id));
  const { accessToken, refreshToken } = await issuePair(
    c.env.JWT_SECRET,
    userId,
    userRows[0].role as "customer" | "admin",
  );
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000).toISOString(),
  });
  return c.json({ accessToken, refreshToken });
});

authRoutes.post("/logout", zValidator("json", refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await sha256Hex(refreshToken)))
    .limit(1);
  if (rows[0]) {
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, rows[0].id));
  }
  c.header("Set-Cookie", `${REFRESH_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("authUser") });
});
