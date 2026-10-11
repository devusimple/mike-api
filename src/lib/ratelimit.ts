import { HTTPException } from "hono/http-exception";

// Fixed-window rate limiting on the RATE_LIMIT_KV namespace.
// Counters are approximate under concurrency — fine for abuse mitigation.

interface RateCtx {
  req: { header(name: string): string | undefined };
  header(name: string, value: string): void;
}

export function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return (
    c.req.header("CF-Connecting-IP")?.trim() ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function enforceRateLimit(
  c: RateCtx,
  kv: KVNamespace | undefined,
  scope: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  if (!kv) {
    console.warn(`RATE_LIMIT_KV missing — skipping ${scope} rate limit`);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const key = `rl:${scope}:${clientIp(c)}:${windowStart}`;
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (count >= limit) {
    const retryAfter = Math.max(1, windowStart + windowSec - now);
    c.header("Retry-After", String(retryAfter));
    throw new HTTPException(429, { message: "Too many attempts — try again shortly" });
  }
  await kv.put(key, String(count + 1), { expirationTtl: windowSec + 10 });
}
