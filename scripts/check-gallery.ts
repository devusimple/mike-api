// Gallery proof: real photos (picsum) → Cloudinary → attach → reorder → verify.
// Run: bun scripts/check-gallery.ts  (local backend on :8787, admin smoke@test.com)
export {};
// Bun-only dev script (not part of the Worker bundle).
declare const Bun: {
  file(path: string | URL): { text(): Promise<string> };
};
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
if (login.status !== 200) throw new Error("admin login failed");
const token = login.json.accessToken as string;

const cat = await req("POST", "/api/categories", { name: `GalCat ${Date.now()}` }, token);
const prod = await req("POST", "/api/products", {
  name: `Gallery Tee ${Date.now()}`,
  priceCents: 99000,
  stock: 5,
  categoryId: cat.json.category.id,
}, token);
const pid = prod.json.product.id as string;
console.log("product:", pid);

const sig = await req("POST", "/api/uploads/signature", {}, token);
const publicIds: string[] = [];
for (let i = 0; i < 3; i++) {
  const photo = await fetch(`https://picsum.photos/seed/gal${Date.now()}${i}/800/600`);
  const buf = await photo.arrayBuffer();
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/jpeg" }), `gal${i}.jpg`);
  form.append("api_key", sig.json.apiKey);
  form.append("timestamp", String(sig.json.timestamp));
  form.append("folder", sig.json.folder);
  form.append("signature", sig.json.signature);
  // NOTE: same signature reused — timestamp/folder identical, no public_id signed. OK.
  const up = (await (await fetch(sig.json.uploadUrl, { method: "POST", body: form })).json()) as any;
  if (!up.secure_url) throw new Error(`upload ${i} failed: ${JSON.stringify(up)}`);
  publicIds.push(up.public_id);
  const at = await req("POST", `/api/products/${pid}/images`, {
    publicId: up.public_id,
    secureUrl: up.secure_url,
    width: up.width,
    height: up.height,
    position: i,
  }, token);
  console.log(`image ${i}: upload+attach ->`, at.status, up.width, "x", up.height);
}

// Reorder: move last image to cover (position 0), push others down.
let det = await req("GET", `/api/products/${pid}`);
let imgs = det.json.product.images as any[];
console.log("order before:", imgs.map((im) => im.position));
const last = imgs[imgs.length - 1];
const ordered = [last, ...imgs.slice(0, -1)];
for (let i = 0; i < ordered.length; i++) {
  await req("PATCH", `/api/products/${pid}/images/${ordered[i].id}`, { position: i }, token);
}
det = await req("GET", `/api/products/${pid}`);
imgs = det.json.product.images as any[];
console.log("order after:", imgs.map((im) => `${im.position}:${im.cloudinaryPublicId.slice(-6)}`));
const coverOk = imgs[0].id === last.id;
console.log("cover is last-uploaded:", coverOk);

// Cover = card thumbnail = images[0]. Simulate storefront thumb().
const thumbUrl = imgs[0].secureUrl.replace("/image/upload/", "/image/upload/w_600,q_auto,f_auto/");
console.log("card thumbnail URL ok:", thumbUrl.includes("w_600") && thumbUrl.startsWith("https://"));

// Cleanup: delete product (+DB image rows), destroy Cloudinary assets.
await req("DELETE", `/api/products/${pid}`, undefined, token);
const devVars = await Bun.file(new URL("../.dev.vars", import.meta.url)).text().catch(() => "");
const secret = devVars.match(/^CLOUDINARY_API_SECRET=(.+)$/m)?.[1]?.trim();
if (secret) {
  const basic = Buffer.from(`${sig.json.apiKey}:${secret}`).toString("base64");
  for (const publicId of publicIds) {
    const d = await fetch(`https://api.cloudinary.com/v1_1/${sig.json.cloudName}/image/destroy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
      body: JSON.stringify({ public_id: publicId }),
    });
    console.log("destroy", publicId.slice(-6), d.status);
  }
}
await req("DELETE", `/api/categories/${cat.json.category.id}`, undefined, token);
console.log(coverOk ? "GALLERY OK" : "GALLERY ORDER WRONG");
if (!coverOk) process.exit(1);
