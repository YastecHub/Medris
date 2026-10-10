import { Hono } from "hono";
import { SupabaseAdmin, SupabaseUserClient } from "../../integrations/supabase.js";
import { initializeTransaction, isValidWebhookSignature, verifyTransaction, type PaystackTransaction } from "../../integrations/paystack.js";
import { errorMessage, json, methodNotAllowed, readJsonBody, requestOrigin } from "../../lib/http.js";
import { settleReference } from "./settlement.service.js";
import { settleListingPaymentFromWebhook, MONTHLY_LISTING_KOBO } from "../vendor-payments/listing-payment.service.js";

/**
 * Card payments through Paystack:
 *   POST /api/initiate-payment  { orderId, accessToken } -> { authorization_url, reference }
 *   GET  /api/verify-payment?reference=...               -> { status }
 *   POST /api/paystack-webhook  (Paystack server-to-server, signed)
 */
export const paymentsRoutes = new Hono()
  .all("/initiate-payment", async (c) => {
    if (c.req.method !== "POST") return methodNotAllowed(c);
    try {
      const { orderId, accessToken } = await readJsonBody<{ orderId?: string; accessToken?: string }>(c);
      if (!orderId || !accessToken) return json(c, 400, { error: "orderId and accessToken are required" });

      // The buyer's own token is used, so Postgres enforces "this order belongs to you";
      // the amount comes from the database, never from the client.
      const rpcRes = await SupabaseUserClient.fromEnv(accessToken).rpc("create_payment_intent", { p_order_id: orderId });
      const rpcJson = (await rpcRes.json()) as Record<string, unknown> | Record<string, unknown>[];
      if (!rpcRes.ok) return json(c, 400, { error: (rpcJson as Record<string, unknown>).message || "Could not start payment." });
      const intent = (Array.isArray(rpcJson) ? rpcJson[0] : rpcJson) as { reference: string; amount: number };
      const { reference, amount } = intent;

      const orderRow = await SupabaseAdmin.fromEnv().first<{ buyer?: { email?: string }; vendor?: { paystack_subaccount_code?: string | null } }>(
        `orders?id=eq.${orderId}&select=buyer:users(email),vendor:vendors(paystack_subaccount_code)`,
      );
      const email = orderRow?.buyer?.email;
      if (!email) return json(c, 400, { error: "Could not resolve buyer email." });

      // Split payment: a vendor with payouts set up receives their cut at
      // settlement through their Paystack subaccount; otherwise the full
      // amount lands on the platform balance for a manual payout.
      const subaccountCode = orderRow?.vendor?.paystack_subaccount_code || null;
      const origin = requestOrigin(c);
      const { res: initRes, json: initJson } = await initializeTransaction({
        email,
        amount: Math.round(Number(amount) * 100), // kobo
        reference,
        callback_url: `${origin}/?paid=1&reference=${encodeURIComponent(reference)}&orderId=${encodeURIComponent(orderId)}`,
        ...(subaccountCode ? { subaccount: subaccountCode } : {}),
      });
      if (!initRes.ok || !initJson.status) return json(c, 400, { error: initJson.message || "Paystack error" });
      return json(c, 200, { authorization_url: initJson.data?.authorization_url, reference });
    } catch (err) {
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  })
  .all("/verify-payment", async (c) => {
    // Lets the UI confirm right after Paystack checkout; the webhook remains the source of truth.
    try {
      const reference = c.req.query("reference");
      if (!reference) return json(c, 400, { error: "reference is required" });
      const { res, json: verifyJson } = await verifyTransaction(reference);
      if (!res.ok || !verifyJson.status) return json(c, 400, { error: verifyJson.message || "Verify failed" });
      if (verifyJson.data?.status === "success") await settleReference(reference, verifyJson.data);
      return json(c, 200, { status: verifyJson.data?.status });
    } catch (err) {
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  })
  .all("/paystack-webhook", async (c) => {
    if (c.req.method !== "POST") return c.body(null, 405);
    try {
      const rawBody = await c.req.text();
      if (!isValidWebhookSignature(rawBody, c.req.header("x-paystack-signature"))) {
        return json(c, 401, { error: "Invalid signature" });
      }
      const event = JSON.parse(rawBody) as { event?: string; data?: PaystackTransaction };
      if (event.event === "charge.success") {
        const tx = event.data || {};
        const metadata = (tx.metadata || {}) as Record<string, unknown>;
        // A successful ₦999 listing payment activates that exact listing even
        // if the vendor's browser closed before the callback.
        if (
          metadata?.purpose === "levromart_listing_monthly" &&
          metadata?.listing_id &&
          metadata?.vendor_id &&
          (metadata?.kind === "product" || metadata?.kind === "package") &&
          tx.status === "success" &&
          Number(tx.amount) === MONTHLY_LISTING_KOBO
        ) {
          await settleListingPaymentFromWebhook(tx.reference as string, metadata);
        } else {
          await settleReference(tx.reference as string, tx);
        }
      }
      return json(c, 200, { received: true });
    } catch (err) {
      console.error("[paystack-webhook]", err);
      return json(c, 500, { error: errorMessage(err) || "Server error" });
    }
  });
