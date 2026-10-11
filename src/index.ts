import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth";
import { categoryRoutes } from "./routes/categories";
import { productRoutes } from "./routes/products";
import { cartRoutes } from "./routes/cart";
import { orderRoutes } from "./routes/orders";
import { uploadRoutes } from "./routes/uploads";
import { adminReviewRoutes, reviewRoutes } from "./routes/reviews";
import { couponRoutes } from "./routes/coupons";
import { metaRoutes } from "./routes/meta";
import { shippingRoutes } from "./routes/shipping";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", logger());

/** Localhost origins are always allowed (dev storefronts). */
function isLocalhost(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

app.use(
  "*",
  cors({
    // Allowed browser origins = ALLOWED_ORIGINS (comma-separated, set in
    // wrangler.jsonc `vars`) + localhost. Anything else gets no ACAO
    // header, so browsers block it. Non-browser clients (curl, mobile
    // apps) don't enforce CORS and are unaffected.
    origin: (origin, c) => {
      if (!origin) return "*";
      const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "");
      const configured = ((c.env.ALLOWED_ORIGINS ?? "") as string)
        .split(",")
        .map(norm)
        .filter(Boolean);
      if (configured.includes(norm(origin)) || isLocalhost(origin)) {
        return origin;
      }
      console.warn(`Blocked CORS origin: ${origin}`);
      return undefined;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Guest-Token"],
    exposeHeaders: ["Content-Length"],
    credentials: true,
  }),
);

app.get("/", (c) =>
  c.json({
    name: "mike e-commerce API",
    version: "1.0.0",
    docs: "/api/docs",
    health: "/health",
    routes: [
      "GET /health",
      "POST /api/auth/register|login|refresh|logout, GET /api/auth/me",
      "GET /api/categories, POST/PUT/DELETE (admin)",
      "GET /api/products?search=&category=&brand=&tag=&featured=1&minRating=&minPrice=&maxPrice=&sort=newest|price_asc|price_desc|rating&page=&limit=",
      "GET /api/products/:slug (images, variants, tags), POST/PUT/DELETE (admin), variant + image subroutes (admin)",
      "GET /api/meta (brands + tags facets)",
      "GET /api/shipping-zones (active), CRUD /api/shipping-zones/all + /:id (admin)",
      "GET /api/cart (Bearer or X-Guest-Token), POST /api/cart/guest, POST /api/cart/merge (auth), POST /api/cart/items, PUT/DELETE /api/cart/items/:productId",
      "POST /api/orders/checkout (Idempotency-Key), GET /api/orders, PATCH /api/orders/:id/status (admin)",
      "GET /api/uploads/config, POST /api/uploads/signature (admin)",
      "GET|POST /api/products/:productId/reviews, DELETE /api/reviews/:id",
      "GET|POST /api/coupons, DELETE /api/coupons/:code (admin)",
    ],
  }),
);

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route("/api/auth", authRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/products", productRoutes);
app.route("/api/products", reviewRoutes); // nested :productId/reviews
app.route("/api/reviews", adminReviewRoutes);
app.route("/api/cart", cartRoutes);
app.route("/api/orders", orderRoutes);
app.route("/api/uploads", uploadRoutes);
app.route("/api/coupons", couponRoutes);
app.route("/api/meta", metaRoutes);
app.route("/api/shipping-zones", shippingRoutes);

// Minimal machine-readable route index for the future docs site / admin UI.
app.get("/api/docs", (c) => {
  return c.json({
    version: "1.0.0",
    auth: "Bearer access token (15m) + rotating refresh token (30d). See docs/AUTH.md.",
    media: "Signed Cloudinary uploads. See docs/CLOUDINARY.md.",
    currency: "BDT, prices in integer cents",
    pagination: "?page=1&limit=20",
    idempotency: "POST /api/orders/checkout requires Idempotency-Key header",
    fullDocs: "See docs/ folder: API.md, DATA_MODEL.md, AUTH.md, CLOUDINARY.md, D1.md",
  });
});

app.notFound((c) => c.json({ error: "NotFound", message: "Route not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status);
  }
  console.error(err);
  return c.json({ error: "InternalServerError", message: "Something went wrong" }, 500);
});

export default app;
