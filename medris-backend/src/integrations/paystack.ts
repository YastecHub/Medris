import crypto from "node:crypto";
import { requireEnv } from "../config/env.js";

/**
 * Paystack REST API. All calls use the secret key from the environment and
 * return `{ res, json }` so callers keep the original success checks
 * (`res.ok && json.status`) and error messages (`json.message`).
 */

const PAYSTACK_API = "https://api.paystack.co";

export interface PaystackEnvelope<T = Record<string, unknown>> {
  status?: boolean;
  message?: string;
  data?: T;
}

export interface PaystackResult<T> {
  res: Response;
  json: PaystackEnvelope<T>;
}

export interface PaystackTransaction {
  status?: string;
  reference?: string;
  amount?: number;
  metadata?: Record<string, unknown> | null;
  authorization?: { authorization_code?: string } | null;
  customer?: { customer_code?: string } | null;
  [key: string]: unknown;
}

async function call<T>(path: string, init: RequestInit = {}, parse: "strict" | "lenient" = "strict"): Promise<PaystackResult<T>> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const json = (parse === "strict" ? await res.json() : await res.json().catch(() => ({}))) as PaystackEnvelope<T>;
  return { res, json };
}

export interface InitializeTransactionInput {
  email: string;
  amount: number; // kobo
  reference: string;
  callback_url: string;
  subaccount?: string;
  channels?: string[];
  currency?: string;
  metadata?: Record<string, unknown>;
}

export function initializeTransaction(input: InitializeTransactionInput, parse: "strict" | "lenient" = "strict") {
  return call<{ authorization_url?: string; reference?: string }>(
    "/transaction/initialize",
    { method: "POST", body: JSON.stringify(input) },
    parse,
  );
}

export function verifyTransaction(reference: string, parse: "strict" | "lenient" = "strict") {
  return call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`, {}, parse);
}

export function resolveBankAccount(accountNumber: string, bankCode: string) {
  return call<{ account_name?: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
}

export function createSubaccount(input: { business_name: string; settlement_bank: string; account_number: string; percentage_charge: number }) {
  return call<{ subaccount_code?: string }>("/subaccount", { method: "POST", body: JSON.stringify(input) });
}

export function createTransferRecipient(input: { type: "nuban"; name: string; account_number: string; bank_code: string; currency: "NGN" }) {
  return call<{ recipient_code?: string }>("/transferrecipient", { method: "POST", body: JSON.stringify(input) });
}

export function createTransfer(input: { source: "balance"; amount: number; recipient: string; reason: string; reference: string }) {
  return call<{ transfer_code?: string; reference?: string }>("/transfer", { method: "POST", body: JSON.stringify(input) });
}

export function createRefund(transactionReference: string) {
  return call("/refund", { method: "POST", body: JSON.stringify({ transaction: transactionReference }) });
}

/** HMAC-SHA512 of the raw request body with the secret key, compared in constant time. */
export function isValidWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha512", requireEnv("PAYSTACK_SECRET_KEY")).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
