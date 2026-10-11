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

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    // TODO: lock down to your storefront origin before launch, e.g.
    // origin: ["https://shop.example.com"],
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
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
      "GET /api/products, GET /api/products/:slug, POST/PUT/DELETE (admin)",
      "GET /api/cart, POST /api/cart/items, PUT/DELETE /api/cart/items/:productId",
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
