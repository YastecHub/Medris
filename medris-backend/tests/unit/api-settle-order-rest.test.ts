import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// api/_util.js settleReference for an order payment, over a tiny in-memory stand-in for the REST API,
// WITHOUT the database function (migration 0014 not applied yet).
const require = createRequire(import.meta.url);
const { settleReference } = require("../../../api/_util.js");

type Row = Record<string, unknown> & { status?: string; awaiting_confirmation_since?: string };
let payments: Row[];
let order: Row;
let ledger: Row[];
const realFetch = globalThis.fetch;

function fakeFetch(url: string, init: RequestInit = {}) {
  const u = new URL(url);
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const reply = (data: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => data } as Response);
  if (u.pathname.endsWith("/rpc/apply_card_payment_to_order")) return reply({}, false); // not installed
  if (u.pathname.endsWith("/payments")) {
    const ref = u.searchParams.get("provider_reference")?.replace("eq.", "");
    const orderId = u.searchParams.get("order_id")?.replace("eq.", "");
    const type = u.searchParams.get("payment_type")?.replace("eq.", "");
    const status = u.searchParams.get("status")?.replace("eq.", "");
    const match = payments.filter((p) => (!ref || p.provider_reference === ref) && (!orderId || p.order_id === orderId) && (!type || p.payment_type === type) && (!status || p.status === status));
    if (method === "PATCH") { match.forEach((p) => Object.assign(p, body)); return reply(match); }
    return reply(match);
  }
  if (u.pathname.endsWith("/orders")) {
    if (method === "PATCH") { Object.assign(order, body); return reply([]); }
    return reply([order]);
  }
  if (u.pathname.endsWith("/paystack_transactions")) { ledger.forEach((l) => Object.assign(l, body)); return reply([]); }
  return reply([]);
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  payments = [{ id: "p1", order_id: "o1", payment_type: "sale_price", amount: 100, status: "pending", provider_reference: "lvm_ord_abc", created_at: "t" }];
  order = { id: "o1", status: "confirmed", order_type: "sale", delivery_method: "pickup", payment_timing: "pay_before", payout_status: "not_applicable", service_offer_id: null };
  ledger = [{ reference: "lvm_ord_abc", status: "initialized" }];
  globalThis.fetch = fakeFetch as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("settleReference for an order payment (no database function installed)", () => {
  it("marks the payment paid, starts the buyer's confirmation and marks the ledger", async () => {
    await settleReference("lvm_ord_abc", { amount: 10250, id: 7, channel: "bank_transfer" });
    expect(payments[0]!.status).toBe("paid");
    expect(order.awaiting_confirmation_since).toBeTruthy();
    expect(order.status).toBe("confirmed");
    expect(ledger[0]!.status).toBe("success");
  });
  it("does nothing the second time", async () => {
    await settleReference("lvm_ord_abc", { amount: 10250 });
    const first = order.awaiting_confirmation_since;
    order.awaiting_confirmation_since = "keep";
    await settleReference("lvm_ord_abc", { amount: 10250 });
    expect(order.awaiting_confirmation_since).toBe("keep");
    expect(first).toBeTruthy();
  });
  it("refuses when Paystack reports less than the order needs", async () => {
    await settleReference("lvm_ord_abc", { amount: 5000 });
    expect(payments[0]!.status).toBe("pending");
  });
});
