import * as jose from "jose";

export type Role = "customer" | "admin";

export interface AccessClaims {
  sub: string;
  role: Role;
}

const ACCESS_TTL = "15m";
const REFRESH_TTL = "30d";

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  secret: string,
  user: AccessClaims,
): Promise<string> {
  return await new jose.SignJWT({ role: user.role, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretKey(secret));
}

export async function signRefreshToken(
  secret: string,
  userId: string,
): Promise<string> {
  return await new jose.SignJWT({ type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims> {
  const { payload } = await jose.jwtVerify(token, secretKey(secret));
  if (payload.type !== "access" || typeof payload.sub !== "string") {
    throw new Error("invalid access token");
  }
  return { sub: payload.sub, role: payload.role as Role };
}

export async function verifyRefreshToken(
  secret: string,
  token: string,
): Promise<string> {
  const { payload } = await jose.jwtVerify(token, secretKey(secret));
  if (payload.type !== "refresh" || typeof payload.sub !== "string") {
    throw new Error("invalid refresh token");
  }
  return payload.sub;
}
