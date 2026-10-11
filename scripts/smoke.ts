// Smoke test: exercises the API against local or remote Worker.
// Run local:  bun scripts/smoke.ts
// Run remote: set API_BASE=https://<worker>.workers.dev && bun scripts/smoke.ts
// Full media check (uploads a 1px test PNG to Cloudinary):
//   set TEST_CLOUDINARY_UPLOAD=1 && bun scripts/smoke.ts
// To also delete the test asset from Cloudinary afterwards:
//   set CLOUDINARY_API_SECRET=<secret> (otherwise its public_id is printed)
export {};

// Bun-only dev script (not part of the Worker bundle).
declare const Bun: {
  file(path: string | URL): { text(): Promise<string> };
};

const BASE = process.argv[2] ?? process.env.API_BASE ?? "http://localhost:8787";
const TEST_UPLOAD = process.argv[3] === "upload" || process.env.TEST_CLOUDINARY_UPLOAD === "1";

async function waitForServer(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function req(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json: json as any };
}

const email = "smoke@test.com";
const password = "password123";
console.log(`target: ${BASE}\nwaiting for server...`);
if (!(await waitForServer())) {
  console.error("SERVER NOT UP");
  process.exit(1);
}
console.log("server up");

let r = await req("GET", "/health");
console.log("GET /health ->", r.status, JSON.stringify(r.json));

r = await req("POST", "/api/auth/register", { email, password, name: "Smoke" });
console.log("POST register ->", r.status);
if (r.status === 409) {
  r = await req("POST", "/api/auth/login", { email, password });
  console.log("POST login (fallback) ->", r.status);
}
const token = r.json.accessToken as string;
if (!token) {
  console.error("AUTH FAILED", JSON.stringify(r.json));
  process.exit(1);
}

r = await req("GET", "/api/auth/me", undefined, token);
console.log("GET me ->", r.status, JSON.stringify(r.json.user));
const isAdmin = r.json.user?.role === "admin";

if (!isAdmin) {
  const scope = BASE.includes("localhost") || BASE.includes("127.0.0.1") ? "--local" : "--remote";
  console.log("NOTE: user is not admin — admin steps skipped. Promote then rerun.");
  console.log(`  create scripts/promote.sql with: UPDATE users SET role = 'admin' WHERE email = 'smoke@test.com';`);
  console.log(`  bunx wrangler d1 execute mike ${scope} --file ./scripts/promote.sql`);
  console.log("SMOKE PARTIAL OK (auth works)");
  process.exit(0);
}

r = await req("POST", "/api/categories", { name: `SmokeCat ${Date.now()}` }, token);
console.log("POST category ->", r.status);
const categoryId = r.json.category?.id;

r = await req("POST", "/api/products", {
  name: `Smoke Tee ${Date.now()}`,
  priceCents: 125000,
  stock: 10,
  categoryId,
}, token);
console.log("POST product ->", r.status);
const product = r.json.product;
if (!product) {
  console.error("PRODUCT CREATE FAILED", JSON.stringify(r.json));
  process.exit(1);
}

r = await req("GET", "/api/products?limit=5");
console.log("GET products ->", r.status, "total=", r.json.total);

r = await req("POST", "/api/cart/items", { productId: product.id, qty: 2 }, token);
console.log("POST cart item ->", r.status);

r = await req("GET", "/api/cart", undefined, token);
console.log("GET cart ->", r.status, "subtotal=", r.json.subtotalCents);

r = await req("POST", "/api/orders/checkout", {}, token, { "Idempotency-Key": `smoke-${Date.now()}` });
console.log("POST checkout ->", r.status, JSON.stringify(r.json).slice(0, 200));

r = await req("GET", "/api/orders", undefined, token);
console.log("GET orders ->", r.status, "count=", r.json.orders?.length);

// --- Media: signature flow (admin) ---
r = await req("GET", "/api/uploads/config", undefined, token);
console.log("GET uploads/config ->", r.status, JSON.stringify(r.json));

r = await req("POST", "/api/uploads/signature", {}, token);
console.log("POST uploads/signature ->", r.status, r.status === 200 ? "signed" : JSON.stringify(r.json));

if (TEST_UPLOAD && r.status === 200) {
  const sig = r.json;
  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "smoke-1px.png");
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);
  const up = await fetch(sig.uploadUrl, { method: "POST", body: form });
  const upJson: any = await up.json().catch(() => ({}));
  console.log("Cloudinary upload ->", up.status, up.status === 200 ? upJson.secure_url : JSON.stringify(upJson));
  if (up.status === 200) {
    const attach = await req("POST", `/api/products/${product.id}/images`, {
      publicId: upJson.public_id,
      secureUrl: upJson.secure_url,
      width: upJson.width,
      height: upJson.height,
    }, token);
    console.log("POST product image ->", attach.status);
    if (attach.status === 201) {
      const del = await req("DELETE", `/api/products/${product.id}/images/${attach.json.image.id}`, undefined, token);
      console.log("DELETE product image row ->", del.status);
    }
    const devVars = await Bun.file(new URL("../.dev.vars", import.meta.url)).text().catch(() => "");
    const secret = devVars.match(/^CLOUDINARY_API_SECRET=(.+)$/m)?.[1]?.trim();
    if (secret) {
      const basic = Buffer.from(`${sig.apiKey}:${secret}`).toString("base64");
      const destroy = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/destroy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
          body: JSON.stringify({ public_id: upJson.public_id }),
        },
      );
      console.log("Cloudinary destroy test asset ->", destroy.status, JSON.stringify(await destroy.json().catch(() => ({}))));
    } else {
      console.log(`NOTE: test asset left in Cloudinary: ${upJson.public_id} (set CLOUDINARY_API_SECRET to auto-delete)`);
    }
  } else {
    console.error("UPLOAD FAILED — check CLOUDINARY_API_SECRET / vars");
    process.exit(1);
  }
}

console.log("SMOKE OK");
