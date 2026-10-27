// The old Paystack webhook address. Paystack's notifications are handled in one place, the backend
// (POST /api/v1/payments/paystack/webhook on Heroku): it checks the signature, asks Paystack about the
// payment, compares the amount with what was recorded and settles it once. This function only passes a
// notification sent here on to it, byte for byte with its signature, and answers with the backend's answer,
// so a dashboard still pointing at this address keeps working. The webhook URL to set in the Paystack
// dashboard is the backend's: https://levromart-5212f03a7e44.herokuapp.com/api/v1/payments/paystack/webhook
const { backendUrl, readRawBytes, passOn } = require("./_util");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  try {
    const body = await readRawBytes(req);
    const answer = await fetch(`${backendUrl()}/api/v1/payments/paystack/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-paystack-signature": String(req.headers["x-paystack-signature"] || "") },
      body,
    });
    await passOn(answer, res);
  } catch (err) {
    // not processed: Paystack sends it again
    console.error("[paystack-webhook] could not pass the event on to the backend:", err && err.message);
    res.status(502).json({ error: "Could not process the event" });
  }
};
