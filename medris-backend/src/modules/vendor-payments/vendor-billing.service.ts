import { SupabaseAdmin, SupabaseUserClient, lookupUser } from "../../integrations/supabase.js";
import { createSubaccount as paystackCreateSubaccount, initializeTransaction, resolveBankAccount } from "../../integrations/paystack.js";
import type { ServiceResult } from "../../types/service.js";

/**
 * Vendor payout set-up and the two vendor billing payments:
 *  - Paystack subaccount (bank account verified with Paystack first),
 *  - settling owed commission by card,
 *  - setting up monthly card billing.
 */

/** Looks up the caller's vendor row with their own token, so RLS applies. */
async function ownVendorRow<T>(accessToken: string, userId: string, columns: string): Promise<T | undefined> {
  const res = await SupabaseUserClient.fromEnv(accessToken).rest(`vendors?user_id=eq.${encodeURIComponent(userId)}&select=${columns}&limit=1`);
  const [row] = (await res.json()) as T[];
  return row;
}

export async function createSubaccount(body: Record<string, unknown>): Promise<ServiceResult> {
  const { accessToken, bankCode, accountNumber } = body as { accessToken?: string; bankCode?: string; accountNumber?: string };
  if (!accessToken || !bankCode || !accountNumber) return { status: 400, body: { error: "accessToken, bankCode and accountNumber are required" } };

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const vendorRow = await ownVendorRow<{ id: string; business_name: string; commission_pct: number | null }>(accessToken, me.id, "id,business_name,commission_pct");
  if (!vendorRow) return { status: 404, body: { error: "No vendor profile found for this account." } };

  const { res: resolveRes, json: resolveJson } = await resolveBankAccount(accountNumber, bankCode);
  if (!resolveRes.ok || !resolveJson.status) return { status: 400, body: { error: resolveJson.message || "Could not verify that bank account." } };
  const accountName = resolveJson.data?.account_name;

  const { res: subRes, json: subJson } = await paystackCreateSubaccount({
    business_name: vendorRow.business_name,
    settlement_bank: bankCode,
    account_number: accountNumber,
    percentage_charge: Number(vendorRow.commission_pct) || 3,
  });
  if (!subRes.ok || !subJson.status) return { status: 400, body: { error: subJson.message || "Could not set up payouts with Paystack." } };

  await db.patch(`vendors?id=eq.${encodeURIComponent(vendorRow.id)}`, {
    bank_code: bankCode,
    account_number: accountNumber,
    account_name: accountName,
    paystack_subaccount_code: subJson.data?.subaccount_code,
  });
  return { status: 200, body: { account_name: accountName, subaccount_code: subJson.data?.subaccount_code } };
}

export async function payCommission(body: Record<string, unknown>, origin: string): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required" } };

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const vendorRow = await ownVendorRow<{ id: string }>(accessToken, me.id, "id");
  if (!vendorRow) return { status: 404, body: { error: "No vendor profile found for this account." } };

  const rpcRes = await SupabaseUserClient.fromEnv(accessToken).rpc("create_commission_payment_intent", { p_vendor_id: vendorRow.id });
  const rpcJson = (await rpcRes.json()) as Record<string, unknown> | Record<string, unknown>[];
  if (!rpcRes.ok) return { status: 400, body: { error: (rpcJson as Record<string, unknown>).message || "Could not start commission payment." } };
  const intent = (Array.isArray(rpcJson) ? rpcJson[0] : rpcJson) as { reference?: string; amount?: number } | undefined;
  const { reference, amount } = intent || {};

  const userRow = await db.first<{ email?: string }>(`users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`);
  const email = userRow?.email || me.email;
  if (!email || !reference || !Number.isFinite(Number(amount))) return { status: 400, body: { error: "Could not prepare the commission payment." } };

  const { res: initRes, json: initJson } = await initializeTransaction({
    email,
    amount: Math.round(Number(amount) * 100),
    reference,
    callback_url: `${origin}/?commissionPaid=1&reference=${encodeURIComponent(reference)}`,
  });
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) return { status: 400, body: { error: initJson.message || "Paystack error" } };
  return { status: 200, body: { authorization_url: initJson.data.authorization_url, reference } };
}

/** Minimum monthly charge, in naira. */
const MONTHLY_BILLING_MINIMUM = 1500;

export async function setupMonthlyBilling(body: Record<string, unknown>, origin: string): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required" } };

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const vendorRow = await db.first<{ id: string; billing_model: string }>(`vendors?user_id=eq.${encodeURIComponent(me.id)}&select=id,billing_model&limit=1`);
  if (!vendorRow) return { status: 404, body: { error: "No vendor profile found for this account." } };
  if (vendorRow.billing_model !== "monthly") return { status: 400, body: { error: "Switch to monthly billing in your profile first." } };

  const amountRes = await db.rest("rpc/compute_monthly_billing_amount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_vendor_id: vendorRow.id }),
  });
  const amountJson = (await amountRes.json()) as { listing_count?: number; amount?: number } | { listing_count?: number; amount?: number }[];
  const intentAmount = Array.isArray(amountJson) ? amountJson[0] : amountJson;
  const listingCount = Number(intentAmount?.listing_count || 0);
  const dueAmount = Math.max(Number(intentAmount?.amount || 0), MONTHLY_BILLING_MINIMUM);

  const u = await db.first<{ email?: string }>(`users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`);
  if (!u?.email) return { status: 400, body: { error: "Could not resolve your email." } };

  const reference = "billing_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const chargeRes = await db.insert("vendor_monthly_charges", {
    vendor_id: vendorRow.id,
    listing_count: listingCount,
    amount: dueAmount,
    status: "pending",
    provider_reference: reference,
  });
  if (!chargeRes.ok) return { status: 500, body: { error: "Could not prepare monthly billing." } };

  const { res: initRes, json: initJson } = await initializeTransaction({
    email: u.email,
    amount: Math.round(dueAmount * 100),
    reference,
    channels: ["card"],
    callback_url: `${origin}/?billingSetup=1&reference=${encodeURIComponent(reference)}`,
  });
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) return { status: 400, body: { error: initJson.message || "Paystack error" } };
  return { status: 200, body: { authorization_url: initJson.data.authorization_url, reference } };
}
