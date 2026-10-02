// Levromart daily billing lifecycle cron.
// Vercel runs this once per day. The actual reminder/expiry logic remains
// in the Supabase SECURITY DEFINER function process_listing_billing_reminders().
const { env } = require("./_util");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const expected = process.env.CRON_SECRET || "";
    if (expected) {
      const supplied =
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
        req.headers["x-cron-secret"] ||
        "";
      if (supplied !== expected) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ error: "Supabase service configuration is missing." });
      return;
    }

    const rpcRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/process_listing_billing_reminders`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    const data = await rpcRes.json().catch(() => ({}));

    if (!rpcRes.ok) {
      res.status(502).json({
        error: data?.message || data?.error || "Listing billing lifecycle processor failed.",
        details: data
      });
      return;
    }

    // Day-level (3/2/1 days out) heads-up before a vendor's storefront gets
    // paused for overdue commission. The finer hour-level countdown (10h/5h/1h)
    // runs from the vendor's own session heartbeat instead -- Vercel's daily
    // cron can't land on an exact hour, only once a day.
    let commissionReminders = null;
    try {
      const commissionRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/process_commission_deadline_reminders`,
        {
          method: "POST",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json"
          },
          body: "{}"
        }
      );
      commissionReminders = await commissionRes.json().catch(() => null);
    } catch (err) {
      console.error("[daily-cron] commission deadline reminders failed:", err);
    }

    // Backstop for the 24h post-completion chat removal: the 30-minute scheduler
    // (GitHub Actions -> /api/order-reminders) does this on the hour; this makes
    // sure it still happens at least once a day if that scheduler isn't set up.
    let purgedChats = null;
    try {
      const { purgeCompletedOrderChats } = require("./order-reminders");
      const svcAuth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
      const svcHeaders = { ...svcAuth, "Content-Type": "application/json", Prefer: "return=minimal" };
      purgedChats = await purgeCompletedOrderChats(SUPABASE_URL, svcAuth, svcHeaders);
    } catch (err) {
      console.error("[daily-cron] chat purge failed:", err);
    }

    res.status(200).json({
      ok: true,
      ...data,
      commissionReminders,
      purgedChats
    });
  } catch (err) {
    console.error("[daily-cron]", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};
