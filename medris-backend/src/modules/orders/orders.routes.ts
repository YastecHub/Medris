import { Hono } from "hono";
import { SupabaseAdmin, lookupUser } from "../../integrations/supabase.js";
import { errorMessage, json, methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { requireBearerCronSecret } from "../../middleware/cron-auth.js";
import { buyerCancel, markManual, refund, release, vendorDecline } from "./payout-actions.service.js";
import { runOrderReminderSweep } from "./reminders.service.js";

/**
 *   POST /api/order-payout-action { action, orderId, accessToken, reason? }
 *   ANY  /api/order-reminders     (Authorization: Bearer CRON_SECRET)
 *   POST /api/order-notify        { orderId, eventType, accessToken }
 */
export const ordersRoutes = new Hono()
  .all("/order-payout-action", async (c) => {
    if (c.req.method !== "POST") return methodNotAllowed(c);
    try {
      const body = await readJsonBody<{ action?: string; orderId?: string; accessToken?: string; reason?: string }>(c);
      const result =
        body.action === "refund"
          ? await refund(body)
          : body.action === "mark-manual"
            ? await markManual(body)
            : body.action === "buyer-cancel"
              ? await buyerCancel(body)
              : body.action === "vendor-decline"
                ? await vendorDecline(body)
                : await release(body);
      return json(c, result.status, result.body);
    } catch (err) {
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  })
  .all("/order-reminders", requireBearerCronSecret, async (c) => {
    try {
      return json(c, 200, await runOrderReminderSweep());
    } catch (err) {
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  })
  .all("/order-notify", async (c) => {
    // Order e-mails were never implemented: the original api/order-notify.js
    // imported a `sendOrderEmails` helper that did not exist, so every call
    // ended in a 500 after authorisation. Nothing in the app calls this route.
    // It is kept (same checks, same outcome) until order e-mails are built.
    if (c.req.method !== "POST") return methodNotAllowed(c);
    try {
      const { orderId, eventType, accessToken } = await readJsonBody<{ orderId?: string; eventType?: string; accessToken?: string }>(c);
      if (!orderId || !eventType || !accessToken) return json(c, 400, { error: "orderId, eventType and accessToken are required" });
      const { user: me } = await lookupUser(accessToken);
      if (!me) return json(c, 401, { error: "Invalid session" });
      const db = SupabaseAdmin.fromEnv();
      const order = await db.first<{ buyer_id: string; vendor_id: string }>(`orders?id=eq.${orderId}&select=*`);
      if (!order) return json(c, 404, { error: "Order not found" });
      const vendorRow = await db.first<{ user_id?: string }>(`vendors?id=eq.${order.vendor_id}&select=id,business_name,user_id`);
      if (order.buyer_id !== me.id && vendorRow?.user_id !== me.id) return json(c, 403, { error: "Not authorized for this order" });
      return json(c, 500, { error: "Order e-mails are not implemented." });
    } catch (err) {
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  });
