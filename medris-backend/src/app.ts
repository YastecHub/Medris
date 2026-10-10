import { Hono } from "hono";
import { cors } from "hono/cors";
import { corsAllowedOrigins } from "./config/env.js";
import { errorMessage } from "./lib/http.js";
import { accountsRoutes, sharePreviewHandler } from "./modules/accounts/accounts.routes.js";
import { authOtpRoutes } from "./modules/auth-otp/auth-otp.routes.js";
import { cronRoutes } from "./modules/cron/cron.routes.js";
import { leviRoutes } from "./modules/levi/levi.routes.js";
import { notifyRoutes } from "./modules/notify/notify.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { vendorPaymentsRoutes } from "./modules/vendor-payments/vendor-payments.routes.js";

/**
 * The Medris (Levromart) API. Every public URL of the previous Vercel
 * functions is served at the same path under /api, with the same request and
 * response shapes.
 */
export function createApp(): Hono {
  const api = new Hono()
    .route("/", accountsRoutes)
    .route("/", authOtpRoutes)
    .route("/", leviRoutes)
    .route("/", cronRoutes)
    .route("/", paymentsRoutes)
    .route("/", notifyRoutes)
    .route("/", ordersRoutes)
    .route("/", vendorPaymentsRoutes);

  const app = new Hono();

  // In production the app and API share one origin, so no CORS headers are
  // sent. Set CORS_ALLOWED_ORIGINS to allow a separately hosted frontend.
  const allowed = corsAllowedOrigins();
  if (allowed.length) {
    app.use(
      "/api/*",
      cors({
        origin: (origin) => (allowed.includes(origin.replace(/\/$/, "")) ? origin : null),
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "x-cron-secret"],
        maxAge: 600,
      }),
    );
  }

  app.route("/api", api);

  // Link previews. vercel.json rewrites "/?storefront=|product=|package=..." and the
  // short links /s/<id>, /p/<id>, /k/<id> to /api/delete-account (handled there).
  // These routes answer the same URLs when a request arrives without the rewrite
  // applied to its URL (local server, other hosts).
  app.get("/", (c) => sharePreviewHandler(c));
  app.get("/s/:id", (c) => sharePreviewHandler(c, { storefront: c.req.param("id") }));
  app.get("/p/:id", (c) => sharePreviewHandler(c, { product: c.req.param("id") }));
  app.get("/k/:id", (c) => sharePreviewHandler(c, { package: c.req.param("id") }));

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error("[medris-backend] unhandled error:", err);
    return c.json({ error: errorMessage(err) || "Server error" }, 500);
  });

  return app;
}
