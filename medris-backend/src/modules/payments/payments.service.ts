import { AppError } from "../../shared/errors/app-error.js";
import { PaymentClaimsService } from "../payment-claims/payment-claims.service.js";
import { findPgError } from "../../database/errors.js";
import { getDataContext } from "../../database/index.js";
import { OrdersRepository } from "../../database/repositories/orders.repository.js";
import { initializeTransaction } from "../../integrations/paystack.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome } from "../../integrations/paystack/index.js";
import { PaystackWebhookService } from "../paystack-webhook/paystack-webhook.service.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { identityFromAccessToken } from "../auth/caller.js";

/**
 * Card payments for orders through Paystack:
 *  - start a checkout for an order (amount from the database, never the client);
 *  - confirm right after checkout, and the old webhook address: both go through PaystackWebhookService, the one place that
 *    settles Paystack payments (signature, Paystack's own answer, the recorded amount, once).
 */

export async function initiatePayment(body: { orderId?: string; accessToken?: string }, origin: string): Promise<ServiceResult> {
  const { orderId, accessToken } = body;
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };

  // The port of create_payment_intent() checks "this order belongs to you" (and charges the total once: B2).
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 400, body: { error: "Could not start payment." } };
  const data = getDataContext();
  let intent: { reference: string; amount: number };
  try {
    [intent] = (await new PaymentClaimsService(() => data).paymentIntent(me, orderId)) as [{ reference: string; amount: number }];
  } catch (err) {
    if (err instanceof AppError && err.status < 500) return { status: 400, body: { error: err.message || "Could not start payment." } };
    const pg = findPgError(err);
    if (!pg) throw err;
    return { status: 400, body: { error: pg.message || "Could not start payment." } };
  }
  const { reference, amount } = intent;

  const orderRow = await data.asService((tx) => new OrdersRepository(tx).checkoutContacts(orderId));
  const email = orderRow?.buyer?.email;
  if (!email) return { status: 400, body: { error: "Could not resolve buyer email." } };

  // Split payment: a vendor with payouts set up receives their cut at
  // settlement through their Paystack subaccount; otherwise the full amount
  // lands on the platform balance for a manual payout.
  const subaccountCode = orderRow?.vendor?.paystack_subaccount_code || null;
  const { res: initRes, json: initJson } = await initializeTransaction({
    email,
    amount: Math.round(Number(amount) * 100), // kobo
    reference,
    callback_url: `${origin}/?paid=1&reference=${encodeURIComponent(reference)}&orderId=${encodeURIComponent(orderId)}`,
    ...(subaccountCode ? { subaccount: subaccountCode } : {}),
  });
  if (!initRes.ok || !initJson.status) return { status: 400, body: { error: initJson.message || "Paystack error" } };
  return { status: 200, body: { authorization_url: initJson.data?.authorization_url, reference } };
}

/**
 * The buyer (or vendor) coming back from Paystack: asks Paystack and, when the payment succeeded, settles it through the same
 * steps and the same event key as the webhook (PaystackWebhookService.confirmByReference): the amount is checked against what
 * was recorded, and whichever of the two comes first settles it, once.
 */
export async function verifyPayment(reference: string | undefined): Promise<ServiceResult> {
  if (!reference) return { status: 400, body: { error: "reference is required" } };
  try {
    const r = await new PaystackWebhookService(() => getDataContext()).confirmByReference(reference);
    return { status: 200, body: { status: r.paystackStatus, ...(r.result ? { settled: r.result } : {}) } };
  } catch (err) {
    if (err instanceof PaystackRejected) return { status: 400, body: { error: err.message || "Verify failed" } };
    if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) return { status: 502, body: { error: "Paystack could not be reached. Please try again in a moment." } };
    throw err;
  }
}

/** The old webhook address: handled exactly like /api/v1/payments/paystack/webhook (one place settles Paystack payments). */
export function handlePaystackWebhook(rawBody: string, signature: string | undefined): Promise<ServiceResult> {
  return new PaystackWebhookService(() => getDataContext()).handle(rawBody, signature);
}
