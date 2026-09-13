// Paystack calls this directly (server-to-server) whenever a transaction
// event happens. This is the authoritative confirmation path — it does not
// depend on the buyer's browser being open.
// Configure this URL in the Paystack dashboard: Settings -> API Keys & Webhooks.
const crypto = require("crypto");
const { env, settleReference } = require("./_util");

const MONTHLY_LISTING_KOBO = 100000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["x-paystack-signature"];
    const expected = crypto.createHmac("sha512", env("PAYSTACK_SECRET_KEY")).update(rawBody).digest("hex");
    if (!signature || signature !== expected) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const event = JSON.parse(rawBody);
    if (event.event === "charge.success") {
      const tx = event.data || {};
      const metadata = tx.metadata || {};

      // Listing activation is handled explicitly here rather than depending on
      // the generic settlement helper. This guarantees that a successful
      // ₦1,000 listing payment flips the exact listing active even if the
      // customer's browser is closed before the callback is reached.
      if (
        metadata?.purpose === "levromart_listing_monthly" &&
        metadata?.listing_id &&
        metadata?.vendor_id &&
        (metadata?.kind === "product" || metadata?.kind === "package") &&
        tx.status === "success" &&
        Number(tx.amount) === MONTHLY_LISTING_KOBO
      ) {
        await settleListingPayment(tx.reference, metadata);
      } else {
        // Preserve all existing commission/order settlement behaviour.
        await settleReference(tx.reference, tx);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paystack-webhook]", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};

async function settleListingPayment(reference, metadata) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase server configuration is missing.");

  const table = metadata.kind === "product" ? "products" : "vendor_packages";

  const listingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(metadata.listing_id)}&vendor_id=eq.${encodeURIComponent(metadata.vendor_id)}&select=id,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`
      }
    }
  );
  const [listing] = await listingRes.json().catch(() => []);

  if (!listing || listing.billing_model !== "monthly") {
    throw new Error("Monthly listing not found for Paystack reference.");
  }

  // Idempotent: if another confirmation path already activated it, do not
  // add another month or alter the existing paid period.
  if (
    listing.billing_status === "active" &&
    listing.billing_paid_until &&
    new Date(listing.billing_paid_until).getTime() > Date.now()
  ) {
    return;
  }

  if (String(listing.billing_reference || "") !== String(reference)) {
    throw new Error("Paystack reference does not match the listing's pending activation.");
  }

  const now = new Date();
  const baseDate =
    listing.billing_paid_until &&
    new Date(listing.billing_paid_until).getTime() > now.getTime()
      ? new Date(listing.billing_paid_until)
      : now;

  const paidUntil = addOneCalendarMonth(baseDate);

  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(metadata.listing_id)}&vendor_id=eq.${encodeURIComponent(metadata.vendor_id)}&billing_reference=eq.${encodeURIComponent(reference)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status: "active",
        billing_status: "active",
        billing_paid_until: paidUntil.toISOString(),
        billing_reference: null
      })
    }
  );
  if (!updateRes.ok) {
    throw new Error("Could not activate the paid listing.");
  }

  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(reference)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          status: "paid",
          paid_at: new Date().toISOString()
        })
      }
    );
  } catch (_) {}
}

function addOneCalendarMonth(date) {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
