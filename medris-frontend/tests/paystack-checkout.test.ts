import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");
vi.stubEnv("VITE_BACKEND_URL", "https://backend.test");

const { outcomeOf, pollDelays, waitForPaystackPayment, isPaystackOrderReference } = await import("../src/services/paystack-checkout.ts");
const { v1 } = await import("../src/services/api/v1-endpoints.ts");

describe("Paystack checkout polling", () => {
  it("backs off 1 s, 2 s, 4 s, then every 8 s, for about a minute", () => {
    const d = pollDelays();
    expect(d.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(d.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(120_000);
    expect(d.reduce((a, b) => a + b, 0)).toBeLessThan(130_000);
  });
  it("reads statuses the way the screen needs", () => {
    expect(outcomeOf("success")).toBe("paid");
    expect(outcomeOf("failed")).toBe("failed");
    expect(outcomeOf("abandoned")).toBe("pending"); // not finished yet, keep waiting
    expect(outcomeOf("initialized")).toBe("pending");
    expect(outcomeOf(undefined)).toBe("pending");
  });
  it("stops as soon as the payment is paid, and waits between checks", async () => {
    const answers = ["initialized", "initialized", "success"];
    const slept: number[] = [];
    const out = await waitForPaystackPayment(async () => answers.shift(), async (ms) => void slept.push(ms));
    expect(out).toBe("paid");
    expect(slept).toEqual([1000, 2000]);
  });
  it("a failed payment is reported at once", async () => {
    expect(await waitForPaystackPayment(async () => "failed", async () => undefined)).toBe("failed");
  });
  it("a check that errors is tried again; running out of time is 'pending', not 'failed'", async () => {
    let n = 0;
    const out = await waitForPaystackPayment(async () => { n++; throw new Error("network"); }, async () => undefined, [10, 10, 10]);
    expect(out).toBe("pending");
    expect(n).toBe(4);
  });
  it("knows the new reference format", () => {
    expect(isPaystackOrderReference("lvm_ord_ab12cd34_ff")).toBe(true);
    expect(isPaystackOrderReference("medris_abc")).toBe(false);
  });
});

describe("payments API methods", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("call the right endpoints and unwrap { data }", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    }));
    await v1.payments.config();
    await v1.payments.initializePaystack("o 1");
    await v1.payments.paystackStatus("lvm_ord_x");
    expect(calls).toEqual([
      { url: "https://backend.test/api/v1/payments/config", method: "GET" },
      { url: "https://backend.test/api/v1/orders/o%201/paystack/initialize", method: "POST" },
      { url: "https://backend.test/api/v1/payments/paystack/lvm_ord_x", method: "GET" },
    ]);
  });
});
