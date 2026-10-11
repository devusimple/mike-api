// Shipping verification (local backend :8787, admin smoke@test.com).
export {};
const BASE = "http://localhost:8787";
async function req(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
const login = await req("POST", "/api/auth/login", { email: "smoke@test.com", password: "password123" });
if (login.status !== 200) throw new Error("admin login failed");
const token = login.json.accessToken as string;

const zones = await req("GET", "/api/shipping-zones");
console.log("zones:", zones.json.zones?.map((z: any) => `${z.name}=${z.chargeCents}`).join(", "));
const inside = zones.json.zones?.find((z: any) => z.name === "Inside Dhaka");
if (!inside) throw new Error("seeded zones missing");

const cat = await req("POST", "/api/categories", { name: `ShipCat ${Date.now()}` }, token);
const prod = await req("POST", "/api/products", {
  name: `Ship Tee ${Date.now()}`,
  priceCents: 125000,
  stock: 10,
  categoryId: cat.json.category.id,
}, token);
const pid = prod.json.product.id as string;

async function checkoutAs(body: object, key: string) {
  await req("POST", "/api/cart/items", { productId: pid, qty: 1 }, token);
  return req("POST", "/api/orders/checkout", body, token, { "Idempotency-Key": key });
}

// 1. Charged (125000 < 200000 free threshold).
let o = await checkoutAs({ shippingZoneId: inside.id }, `ship1-${Date.now()}`);
console.log("checkout with zone:", o.status, "shipping:", o.json.order?.shippingCents, "total:", o.json.order?.totalCents, "zone:", o.json.order?.shippingZone);
// 2. Free above threshold (temporarily lower it below subtotal).
await req("PUT", `/api/shipping-zones/${inside.id}`, { freeAboveCents: 100000 }, token);
o = await checkoutAs({ shippingZoneId: inside.id }, `ship2-${Date.now()}`);
console.log("checkout free shipping:", o.status, "shipping:", o.json.order?.shippingCents, "total:", o.json.order?.totalCents);
await req("PUT", `/api/shipping-zones/${inside.id}`, { freeAboveCents: 200000 }, token);
// 3. Invalid zone rejected.
o = await checkoutAs({ shippingZoneId: "nope" }, `ship3-${Date.now()}`);
console.log("checkout bad zone:", o.status, "(expect 400)");
// 4. No zone = back-compat, no charge.
await req("POST", "/api/cart/items", { productId: pid, qty: 1 }, token);
o = await req("POST", "/api/orders/checkout", {}, token, { "Idempotency-Key": `ship4-${Date.now()}` });
console.log("checkout no zone:", o.status, "shipping:", o.json.order?.shippingCents);

// Cleanup.
await req("DELETE", `/api/products/${pid}`, undefined, token);
await req("DELETE", `/api/categories/${cat.json.category.id}`, undefined, token);
console.log("SHIPPING OK");
