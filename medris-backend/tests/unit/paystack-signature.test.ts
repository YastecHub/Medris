import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../../src/integrations/paystack/index.js";

const secret = "sk_test_unit";
const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "r1" } }));
const sign = (b: Buffer | string, s = secret) => crypto.createHmac("sha512", s).update(b).digest("hex");

describe("paystack webhook signature", () => {
  it("accepts a valid signature, for a Buffer or a string body", () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(body.toString(), sign(body), secret)).toBe(true);
  });
  it("rejects a wrong signature, a changed body and a wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(Buffer.from("other")), secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body.toString() + " "), sign(body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "other-secret"), secret)).toBe(false);
  });
  it("rejects a wrong-length, non-hex, empty or missing header", () => {
    expect(verifyWebhookSignature(body, "abcd", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "z".repeat(128), secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
});
