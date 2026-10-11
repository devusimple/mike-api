// Product-delete-with-history test (local :8787).
// First run registers del@test.com (then promote it); rerun does the full test.
export {};
const BASE = "http://localhost:8787";
const EMAIL = "del@test.com";
async function req(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
let login = await req("POST", "/api/auth/login", { email: EMAIL, password: "password123" });
if (login.status !== 200) {
  const reg = await req("POST", "/api/auth/register", { email: EMAIL, password: "password123", name: "Del" });
  console.log("registered:", reg.status, "— promote del@test.com to admin, then rerun");
  process.exit(0);
}
if (login.json.user.role !== "admin") {
  console.log("not admin yet — promote del@test.com, then rerun");
  process.exit(0);
}
const token = login.json.accessToken as string;
const cat = await req("POST", "/api/categories", { name: `DelCat ${Date.now()}` }, token);
const prod = await req("POST", "/api/products", {
  name: `Del Tee ${Date.now()}`, priceCents: 50000, stock: 5, categoryId: cat.json.category.id,
}, token);
const pid = prod.json.product.id as string;
await req("POST", "/api/cart/items", { productId: pid, qty: 1 }, token);
const o = await req("POST", "/api/orders/checkout", {}, token, { "Idempotency-Key": `del-${Date.now()}` });
const oid = o.json.order.id as string;
console.log("checkout:", o.status);

const del = await req("DELETE", `/api/products/${pid}`, undefined, token);
console.log("delete ordered product:", del.status, "(expect 200)");
const got = await req("GET", `/api/orders/${oid}`, undefined, token);
console.log("order intact:", got.status, "items:", got.json.items?.length, "productId:", JSON.stringify(got.json.items?.[0]?.productId), "name kept:", got.json.items?.[0]?.productName);
await req("DELETE", `/api/categories/${cat.json.category.id}`, undefined, token);
const ok = del.status === 200 && got.status === 200 && got.json.items?.[0]?.productId === null;
console.log(ok ? "DELETE-WITH-HISTORY OK" : "FAILED");
process.exit(ok ? 0 : 1);
