import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { users } from "../db/schema";
import { verifyAccessToken, type Role } from "../lib/jwt";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser;
  }
}

type Env = { Bindings: CloudflareBindings };

/** Require a valid `Authorization: Bearer <accessToken>` header. */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }
  const token = header.slice(7);
  let claims;
  try {
    claims = await verifyAccessToken(c.env.JWT_SECRET, token);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const user = rows[0];
  if (!user) throw new HTTPException(401, { message: "User no longer exists" });
  c.set("authUser", {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  });
  await next();
});

/** Require `admin` role (must be used after `requireAuth`). */
export const requireAdmin = createMiddleware(async (c, next) => {
  const user = c.get("authUser");
  if (!user) throw new HTTPException(401, { message: "Unauthorized" });
  if (user.role !== "admin") {
    throw new HTTPException(403, { message: "Admin only" });
  }
  await next();
});

/**
 * Optional auth: returns the user when a valid Bearer token is present,
 * null when absent. An invalid/expired token is still a 401 (we don't
 * silently downgrade a logged-in user to guest).
 */
export async function getOptionalUser(
  c: { req: { header(name: string): string | undefined }; env: CloudflareBindings },
): Promise<AuthUser | null> {
  const header = c.req.header("Authorization");
  if (!header) return null;
  if (!header.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Malformed authorization header" });
  }
  let claims;
  try {
    claims = await verifyAccessToken(c.env.JWT_SECRET, header.slice(7));
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
  const db = getDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const user = rows[0];
  if (!user) throw new HTTPException(401, { message: "User no longer exists" });
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role };
}
