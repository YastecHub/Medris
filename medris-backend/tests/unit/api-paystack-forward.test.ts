import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

// The old Vercel payment functions (api/paystack-webhook.js, api/verify-payment.js) only pass requests on to the
// backend, the one place that settles Paystack payments. They must pass the webhook body on byte for byte, with
// its signature, and answer with the backend's answer.
const require = createRequire(import.meta.url);
const webhook = require("../../../api/paystack-webhook.js");
const verify = require("../../../api/verify-payment.js");
const { refundOrderPayout } = require("../../../api/_util.js");

function request(method: string, url: string, headers: Record<string, string>, body?: Buffer) {
  const req = Object.assign(new EventEmitter(), { method, url, headers });
  queueMicrotask(() => {
    if (body) req.emit("data", body);
    req.emit("end");
  });
  return req;
}
function response() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    json(v: unknown) {
      res.body = JSON.stringify(v);
    },
    end(text?: string) {
      res.body = text ?? "";
    },
  };
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BACKEND_URL;
});

describe("api/paystack-webhook.js", () => {
  it("passes the raw body and signature on to the backend's webhook and answers with its answer", async () => {
    process.env.BACKEND_URL = "https://backend.test/";
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ received: true, result: "settled" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const raw = Buffer.from('{"event":"charge.success","data":{"reference":"lvm_ord_x","note":"naïra ₦"}}', "utf8");
    const res = response();
    await webhook(request("POST", "/api/paystack-webhook", { "x-paystack-signature": "sig123" }, raw), res);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://backend.test/api/v1/payments/paystack/webhook");
    expect((seen[0]!.init.headers as Record<string, string>)["x-paystack-signature"]).toBe("sig123");
    expect(Buffer.compare(seen[0]!.init.body as Buffer, raw)).toBe(0);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true, result: "settled" });
  });

  it("keeps the backend's refusal (a bad signature stays 401), and answers 502 when the backend cannot be reached so Paystack retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 })));
    const refused = response();
    await webhook(request("POST", "/api/paystack-webhook", { "x-paystack-signature": "bad" }, Buffer.from("{}")), refused);
    expect(refused.statusCode).toBe(401);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const down = response();
    await webhook(request("POST", "/api/paystack-webhook", {}, Buffer.from("{}")), down);
    expect(down.statusCode).toBe(502);
  });
});

describe("api/verify-payment.js", () => {
  it("asks the backend and answers with its answer", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ status: "success", settled: "settled" }), { status: 200 });
    }));
    const res = response();
    await verify(request("GET", "/api/verify-payment?reference=commission_a%20b", { host: "levromart.app" }), res);
    expect(seen).toEqual(["https://levromart-5212f03a7e44.herokuapp.com/api/verify-payment?reference=commission_a%20b"]);
    expect(JSON.parse(res.body)).toEqual({ status: "success", settled: "settled" });
  });
});

describe("api/_util.js refundOrderPayout", () => {
  const env = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "svc", PAYSTACK_SECRET_KEY: "sk_test_x" };
  function stub(orderStatus: string) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/rest/v1/orders?")) return new Response(JSON.stringify([{ id: "o1", status: orderStatus, payout_status: null }]));
      if (url.includes("/rest/v1/payments?")) return new Response(JSON.stringify([{ id: "p1", provider_reference: "lvm_ord_abc" }]));
      return new Response(JSON.stringify({ status: true, data: {} }));
    }));
    return calls;
  }

  it("never refunds an order paid through the app's checkout: the backend's refund queue does that, once", async () => {
    Object.assign(process.env, env);
    const calls = stub("disputed");
    await expect(refundOrderPayout("o1")).rejects.toThrow(/Admin → Payments → Refunds/);
    expect(calls.some((u) => u.includes("api.paystack.co"))).toBe(false);

    const cancelled = stub("cancelled");
    expect(await refundOrderPayout("o1")).toEqual({ refunded: true, queued: true });
    expect(cancelled.some((u) => u.includes("api.paystack.co"))).toBe(false);
  });
});
