import { optionalEnv, requireEnv } from "../../config/env.js";
import { PaystackClient } from "./paystack.client.js";

export * from "./paystack.client.js";
export * from "./errors.js";
export * from "./money.js";
export * from "./fees.js";
export * from "./signature.js";

/** The shared client. The key is read when a call is made (like the original functions), so a missing key only fails Paystack features. */
let shared: PaystackClient | null = null;
let sharedKey = "";
let sharedBase = "";
/** `PAYSTACK_BASE_URL` is for tests only (a fake Paystack); it is unset in every real deployment, so the real API is used. */
export function getPaystackClient(): PaystackClient {
  const key = requireEnv("PAYSTACK_SECRET_KEY");
  const base = optionalEnv("PAYSTACK_BASE_URL");
  const timeout = Number(optionalEnv("PAYSTACK_TIMEOUT_MS")) || 0; // tests only: a short wait so a "no answer" fault does not take 15 s
  if (!shared || sharedKey !== key || sharedBase !== `${base}|${timeout}`) {
    shared = new PaystackClient({ secretKey: key, ...(base ? { baseUrl: base } : {}), ...(timeout ? { timeoutMs: timeout } : {}) });
    sharedKey = key;
    sharedBase = `${base}|${timeout}`;
  }
  return shared;
}
