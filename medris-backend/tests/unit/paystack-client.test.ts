import { describe, expect, it, vi } from "vitest";
import { PaystackClient, PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome } from "../../src/integrations/paystack/index.js";

const KEY = "sk_test_unit_secret";
type Call = { url: string; init: RequestInit };

function setup(answer: unknown | ((c: Call) => Response | Promise<Response>), options: { timeoutMs?: number } = {}) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    if (typeof answer === "function") return (answer as (c: Call) => Response | Promise<Response>)(call);
    return new Response(JSON.stringify({ status: true, message: "ok", data: answer }), { status: 200 });
  });
  return { client: new PaystackClient({ secretKey: KEY, fetch: f as unknown as typeof fetch, ...options }), calls };
}
const body = (c: Call) => JSON.parse(String(c.init.body));
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("PaystackClient requests", () => {
  it("initializeTransaction", async () => {
    const { client, calls } = setup({ authorization_url: "https://u", access_code: "ac", reference: "r1" });
    const out = await client.initializeTransaction({ email: "a@b.c", amountKobo: 50000, reference: "r1", callbackUrl: "https://app/o", metadata: { order_id: "o" }, channels: ["card"] });
    expect(out.access_code).toBe("ac");
    expect(calls[0]!.url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0]!.init.method).toBe("POST");
    expect(header(calls[0]!, "Authorization")).toBe(`Bearer ${KEY}`);
    expect(body(calls[0]!)).toEqual({ email: "a@b.c", amount: 50000, reference: "r1", callback_url: "https://app/o", metadata: { order_id: "o" }, channels: ["card"] });
  });
  it("verify, fetch and list transactions", async () => {
    const { client, calls } = setup({ status: "success" });
    await client.verifyTransaction("a b/c");
    await client.fetchTransaction(42);
    await client.listTransactions({ from: "2026-10-01", status: "success", page: 2 });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.paystack.co/transaction/verify/a%20b%2Fc",
      "https://api.paystack.co/transaction/42",
      "https://api.paystack.co/transaction?from=2026-10-01&status=success&page=2",
    ]);
    expect(calls.every((c) => c.init.method === "GET")).toBe(true);
  });
  it("createRefund with and without an amount", async () => {
    const { client, calls } = setup({});
    await client.createRefund({ transaction: "r1" });
    await client.createRefund({ transaction: "r1", amountKobo: 1000 });
    expect(body(calls[0]!)).toEqual({ transaction: "r1" });
    expect(body(calls[1]!)).toEqual({ transaction: "r1", amount: 1000 });
    expect(calls[0]!.url).toBe("https://api.paystack.co/refund");
  });
  it("banks, account check and transfer recipient", async () => {
    const { client, calls } = setup({});
    await client.listBanks();
    await client.resolveAccount({ accountNumber: "0123456789", bankCode: "058" });
    await client.createTransferRecipient({ name: "Dayo", accountNumber: "0123456789", bankCode: "058" });
    expect(calls[0]!.url).toContain("/bank?country=nigeria&currency=NGN");
    expect(calls[1]!.url).toBe("https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058");
    expect(body(calls[2]!)).toEqual({ type: "nuban", name: "Dayo", account_number: "0123456789", bank_code: "058", currency: "NGN" });
  });
  it("initiateTransfer and verifyTransfer", async () => {
    const { client, calls } = setup({});
    await client.initiateTransfer({ amountKobo: 9700, recipientCode: "RCP_1", reference: "pay_1", reason: "Order payout" });
    await client.verifyTransfer("pay_1");
    expect(body(calls[0]!)).toEqual({ source: "balance", amount: 9700, recipient: "RCP_1", reference: "pay_1", reason: "Order payout" });
    expect(calls[1]!.url).toBe("https://api.paystack.co/transfer/verify/pay_1");
  });
});

describe("PaystackClient errors", () => {
  it("a timeout is an unknown outcome", async () => {
    const { client } = setup((c: Call) => new Promise<Response>((_, reject) => (c.init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 20 });
    await expect(client.verifyTransaction("r1")).rejects.toBeInstanceOf(PaystackUnknownOutcome);
  });
  it("a network error is an unknown outcome", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("fetch failed")));
    await expect(client.verifyTransaction("r1")).rejects.toBeInstanceOf(PaystackUnknownOutcome);
  });
  it("4xx is Rejected with Paystack's message", async () => {
    const { client } = setup(() => new Response(JSON.stringify({ status: false, message: "Duplicate Transaction Reference" }), { status: 400 }));
    await expect(client.initializeTransaction({ email: "a@b.c", amountKobo: 1, reference: "r" })).rejects.toMatchObject({ name: "PaystackRejected", message: "Duplicate Transaction Reference", status: 400 });
  });
  it("5xx is Unavailable, also when the body is not JSON", async () => {
    const { client } = setup(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(client.verifyTransaction("r1")).rejects.toBeInstanceOf(PaystackUnavailable);
  });
  it("errors never carry the secret key or a full account number", async () => {
    const { client } = setup(() => new Response(JSON.stringify({ status: false, message: "Could not resolve account" }), { status: 422 }));
    const err = await client.resolveAccount({ accountNumber: "0123456789", bankCode: "058" }).catch((e: unknown) => e as Error);
    const text = `${(err as Error).name} ${(err as Error).message} ${(err as Error).stack ?? ""}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("0123456789");
    expect(err).toBeInstanceOf(PaystackRejected);
  });
});
