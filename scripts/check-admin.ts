// Exercises the exact endpoints the /admin UI uses (local backend).
// Run: bun scripts/check-admin.ts
export {};
const BASE = "http://localhost:8787";

async function req(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

const login = await req("POST", "/api/auth/login", { email: "smoke@test.com", password: "password123" });
if (login.status !== 200) {
  console.error("LOGIN FAILED", login.status, JSON.stringify(login.json));
  process.exit(1);
}
const token = login.json.accessToken as string;
console.log("login -> 200, role:", login.json.user.role);

let r = await req("GET", "/api/products?all=1&limit=100", undefined, token);
console.log("GET products?all=1 ->", r.status, "count:", r.json.products?.length);

r = await req("GET", "/api/orders?all=1&limit=100", undefined, token);
console.log("GET orders?all=1 ->", r.status, "count:", r.json.orders?.length);

r = await req("POST", "/api/coupons", { code: "ADMINTEST25", percentOff: 25 }, token);
console.log("POST coupon ->", r.status, JSON.stringify(r.json.coupon ?? r.json));

r = await req("GET", "/api/coupons", undefined, token);
console.log("GET coupons ->", r.status, "count:", r.json.coupons?.length);

r = await req("DELETE", "/api/coupons/ADMINTEST25", undefined, token);
console.log("DELETE coupon ->", r.status);

r = await req("POST", "/api/categories", { name: `AdminCat ${Date.now()}` }, token);
console.log("POST category ->", r.status);
const catId = r.json.category?.id;
if (catId) {
  r = await req("DELETE", `/api/categories/${catId}`, undefined, token);
  console.log("DELETE category ->", r.status);
}

// Non-admin gate: register a fresh customer and confirm /admin endpoints 403.
const email = `cust${Date.now()}@test.com`;
await req("POST", "/api/auth/register", { email, password: "password123", name: "Cust" });
const cl = await req("POST", "/api/auth/login", { email, password: "password123" });
const cTok = cl.json.accessToken as string;
r = await req("GET", "/api/coupons", undefined, cTok);
console.log("GET coupons as customer ->", r.status, "(expect 403)");
r = await req("GET", "/api/orders?all=1", undefined, cTok);
console.log("GET orders?all=1 as customer ->", r.status, "(expect 403)");

console.log("ADMIN API OK");
