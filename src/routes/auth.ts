import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { authTokens, carts, refreshTokens, users } from "../db/schema";
import { hashPassword, sha256Hex, verifyPassword } from "../lib/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt";
import { frontendBase, sendMail } from "../lib/mail";
import { enforceRateLimit } from "../lib/ratelimit";
import { requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
type Db = ReturnType<typeof getDb>;
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
const emailSchema = z.object({ email: z.email() });
const verifySchema = z.object({ token: z.string().min(1).max(200) });
const resetSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
});
const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const REFRESH_COOKIE = "refresh_token";
const REFRESH_MAX_AGE = 30 * 24 * 3600;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: !!u.emailVerified,
  };
}

async function issuePair(secret: string, userId: string, role: "customer" | "admin") {
  const accessToken = await signAccessToken(secret, { sub: userId, role });
  const refreshToken = await signRefreshToken(secret, userId);
  return { accessToken, refreshToken };
}

function refreshCookie(value: string, maxAge: number): string {
  return `${REFRESH_COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
}

/** Mint a single-use email token (verification or reset). Returns the raw token. */
async function mintEmailToken(
  db: Db,
  userId: string,
  purpose: "verify_email" | "reset_password",
  ttlMs: number,
): Promise<string> {
  // One live token per purpose — invalidate older ones first.
  const prior = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)));
  for (const p of prior) {
    await db.delete(authTokens).where(eq(authTokens.id, p.id));
  }
  const raw = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await db.insert(authTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Hex(raw),
    purpose,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
  return raw;
}

/** Validate + consume a token. Returns the user id or throws 400. */
async function consumeEmailToken(
  db: Db,
  raw: string,
  purpose: "verify_email" | "reset_password",
): Promise<string> {
  const rows = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, await sha256Hex(raw.trim())))
    .limit(1);
  const row = rows[0];
  if (!row || row.purpose !== purpose || row.used || new Date(row.expiresAt).getTime() < Date.now()) {
    throw new HTTPException(400, { message: "Invalid or expired token" });
  }
  await db.delete(authTokens).where(eq(authTokens.id, row.id));
  return row.userId;
}

async function sendVerificationMail(
  env: CloudflareBindings,
  origin: string | undefined,
  user: typeof users.$inferSelect,
  raw: string,
) {
  const link = `${frontendBase(env, origin)}/verify-email?token=${raw}`;
  await sendMail(
    env,
    user.email,
    "Verify your email",
    `Hi ${user.name},\n\nConfirm your email address:\n${link}\n\nThis link expires in 24 hours.`,
  );
}

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "register", 5, 60);
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
  c.header("Set-Cookie", refreshCookie(refreshToken, REFRESH_MAX_AGE));

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  // Verification email is best-effort — registration succeeds regardless.
  try {
    const raw = await mintEmailToken(db, id, "verify_email", VERIFY_TTL_MS);
    await sendVerificationMail(c.env, c.req.header("Origin"), rows[0], raw);
  } catch (e) {
    console.error("verification mail failed:", e);
  }
  return c.json({ user: publicUser(rows[0]), accessToken, refreshToken }, 201);
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "login", 10, 60);
  const { email, password } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HTTPException(401, { message: "Invalid credentials" });
  }
  if (user.disabled) {
    throw new HTTPException(401, { message: "Account disabled" });
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
  c.header("Set-Cookie", refreshCookie(refreshToken, REFRESH_MAX_AGE));
  return c.json({ user: publicUser(user), accessToken, refreshToken });
});

authRoutes.post("/refresh", zValidator("json", refreshSchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "refresh", 30, 60);
  // Accepts JSON { refreshToken } — clients using httpOnly cookies can also
  // POST the cookie value; see docs/AUTH.md for the web flow.
  const bodyToken = c.req.valid("json").refreshToken;
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
  if (!row) {
    // Valid signature but never issued (or DB was reset): possible theft —
    // kill every session for this user.
    const doomed = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    for (const d of doomed) {
      await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, d.id));
    }
    throw new HTTPException(401, { message: "Session compromised — please login again" });
  }
  if (row.revoked || new Date(row.expiresAt).getTime() < Date.now()) {
    // Known row, already rotated/expired: benign race (e.g. double refresh
    // or logout-then-refresh), so just reject without nuking sessions.
    throw new HTTPException(401, { message: "Refresh token revoked or expired" });
  }
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) throw new HTTPException(401, { message: "User no longer exists" });
  if (userRows[0].disabled) throw new HTTPException(401, { message: "Account disabled" });

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
  c.header("Set-Cookie", refreshCookie("", 0));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("authUser") });
});

/** Re-send the verification email (authenticated). */
authRoutes.post("/request-verification", requireAuth, async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "request-verification", 3, 300);
  const user = c.get("authUser");
  if (user.emailVerified) return c.json({ ok: true, alreadyVerified: true });
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!rows[0]) throw new HTTPException(401, { message: "User no longer exists" });
  const raw = await mintEmailToken(db, user.id, "verify_email", VERIFY_TTL_MS);
  await sendVerificationMail(c.env, c.req.header("Origin"), rows[0], raw);
  return c.json({ ok: true });
});

/** Consume a verification link token. */
authRoutes.post("/verify-email", zValidator("json", verifySchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "verify-email", 20, 60);
  const db = getDb(c.env.DB);
  const userId = await consumeEmailToken(db, c.req.valid("json").token, "verify_email");
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  return c.json({ ok: true });
});

/** Start password reset. Always 200 to avoid email enumeration. */
authRoutes.post("/forgot-password", zValidator("json", emailSchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "forgot-password", 5, 300);
  const { email } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (rows[0]) {
    try {
      const raw = await mintEmailToken(db, rows[0].id, "reset_password", RESET_TTL_MS);
      const link = `${frontendBase(c.env, c.req.header("Origin"))}/reset-password?token=${raw}`;
      await sendMail(
        c.env,
        rows[0].email,
        "Reset your password",
        `Hi ${rows[0].name},\n\nReset your password:\n${link}\n\nThis link expires in 1 hour. If you didn't ask, ignore this email.`,
      );
    } catch (e) {
      console.error("reset mail failed:", e);
    }
  }
  return c.json({ ok: true });
});

/** Complete password reset. Logs the user out everywhere. */
authRoutes.post("/reset-password", zValidator("json", resetSchema), async (c) => {
  await enforceRateLimit(c, c.env.RATE_LIMIT_KV, "reset-password", 10, 300);
  const { token, password } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const userId = await consumeEmailToken(db, token, "reset_password");
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  const sessions = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
  for (const s of sessions) {
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, s.id));
  }
  return c.json({ ok: true });
});

/** Change password while logged in. Returns a fresh pair (other sessions revoked). */
authRoutes.post("/change-password", requireAuth, zValidator("json", changeSchema), async (c) => {
  const user = c.get("authUser");
  const { currentPassword, newPassword } = c.req.valid("json");
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].passwordHash))) {
    throw new HTTPException(401, { message: "Current password is incorrect" });
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, user.id));
  const sessions = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
  for (const s of sessions) {
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, s.id));
  }
  const pair = await issuePair(c.env.JWT_SECRET, user.id, user.role);
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256Hex(pair.refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000).toISOString(),
  });
  return c.json(pair);
});
