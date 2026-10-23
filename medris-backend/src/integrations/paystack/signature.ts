import crypto from "node:crypto";

/**
 * Paystack signs the raw request body with HMAC-SHA512 using the secret key and sends it in `x-paystack-signature`.
 * Check it on the raw bytes, before parsing the JSON, and compare in constant time.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest();
  if (!/^[0-9a-fA-F]+$/.test(header)) return false;
  const given = Buffer.from(header, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
