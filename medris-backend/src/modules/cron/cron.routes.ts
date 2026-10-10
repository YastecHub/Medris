import { Hono } from "hono";
import { SupabaseAdmin } from "../../integrations/supabase.js";
import { errorMessage, json } from "../../lib/http.js";
import { requireCronSecret } from "../../middleware/cron-auth.js";

/**
 * GET|POST /api/daily-cron - Vercel Cron, 03:00 UTC daily.
 *  1. listing billing reminders/expiry (process_listing_billing_reminders)
 *  2. commission deadline heads-up 3/2/1 days out (process_commission_deadline_reminders)
 *  3. deletes read notifications older than 60 days
 */
export const cronRoutes = new Hono().on(["GET", "POST"], "/daily-cron", requireCronSecret, async (c) => {
  try {
    const db = SupabaseAdmin.fromEnv();

    const rpcRes = await db.rpc("process_listing_billing_reminders", "{}");
    const data = (await rpcRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!rpcRes.ok) {
      return json(c, 502, { error: data?.message || data?.error || "Listing billing lifecycle processor failed.", details: data });
    }

    let commissionReminders: unknown = null;
    try {
      const commissionRes = await db.rpc("process_commission_deadline_reminders", "{}");
      commissionReminders = await commissionRes.json().catch(() => null);
    } catch (err) {
      console.error("[daily-cron] commission deadline reminders failed:", err);
    }

    let notificationsTrimmed: boolean | null = null;
    try {
      const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
      const r = await db.delete(`notifications?read=eq.true&created_at=lt.${encodeURIComponent(cutoff)}`, "return=minimal");
      notificationsTrimmed = r.ok;
    } catch (err) {
      console.error("[daily-cron] notification cleanup failed:", err);
    }

    return json(c, 200, { ok: true, notificationsTrimmed, ...data, commissionReminders });
  } catch (err) {
    console.error("[daily-cron]", err);
    return json(c, 500, { error: errorMessage(err) || "Server error" });
  }
});

cronRoutes.all("/daily-cron", (c) => json(c, 405, { error: "Method not allowed" }));
