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

    res.status(200).json({
      ok: true,
      ...data
    });
  } catch (err) {
    console.error("[daily-cron]", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};
