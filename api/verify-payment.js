// GET /api/verify-payment?reference=... -> { status, settled? }
// Called when someone comes back from Paystack's page. The backend answers it (GET /api/verify-payment on
// Heroku): it asks Paystack and, when the payment succeeded, settles it through the same steps as the
// webhook (amount checked against what was recorded, once). This function only passes the question on, so
// app versions still cached in people's browsers keep working.
const { backendUrl, passOn } = require("./_util");

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const reference = url.searchParams.get("reference");
    if (!reference) { res.status(400).json({ error: "reference is required" }); return; }
    const answer = await fetch(`${backendUrl()}/api/verify-payment?reference=${encodeURIComponent(reference)}`, { headers: { Accept: "application/json" } });
    await passOn(answer, res);
  } catch (err) {
    res.status(502).json({ error: "Could not reach the payment service. Please try again in a moment." });
  }
};
