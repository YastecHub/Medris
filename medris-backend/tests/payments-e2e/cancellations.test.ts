/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { describe, expect, it } from "vitest";
import { api, handOver, json, newOrder, payOrder, rowOf, useWorld } from "./harness.js";

// Migration 0018: the buyer cancels until the order is out for delivery; a shop cannot cancel a paid order itself, it asks an admin.
describe("cancelling paid orders", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));
  const refundsOf = (orderId: string) => w.db.query<{ amount_kobo: string; status: string }>(`select amount_kobo::text, status from public.paystack_refunds where order_id = $1`, [orderId]);

  it("a refund can only be asked for within 24 hours of the order", async () => {
    const o = await newOrder(w, 5000);
    await payOrder(w, o);
    await w.db.query(`update public.orders set created_at = now() - interval '25 hours' where id = $1`, [o]);
    const r = await call("buyer_cancel_order", w.buyer.token, { p_order_id: o });
    expect(r.status).toBe(400);
    expect(String(r.body?.error?.message ?? r.body?.message ?? JSON.stringify(r.body))).toMatch(/within 24 hours/);
  });

  it("the buyer cancelling a paid order asks for a refund; nothing moves until the shop (or an admin) agrees", async () => {
    const o = await newOrder(w, 5000);
    await payOrder(w, o);
    const r = await call("buyer_cancel_order", w.buyer.token, { p_order_id: o, p_reason: "Changed my mind" });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ cancelled: false, requested: true });
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("confirmed"); // still on
    expect(await refundsOf(o)).toHaveLength(0);
    // the shop and the admins were told at once
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and type = 'refund_requested'`, [w.vendor.id])).toBeTruthy();
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and title = 'Refund request'`, [w.admin.id])).toBeTruthy();
    expect((await call("buyer_cancel_order", w.buyer.token, { p_order_id: o })).status).toBe(409); // one request at a time
    // the buyer, the shop and an admin can see it; a stranger cannot
    expect((await call("get_order_cancellation", w.buyer.token, { p_order_id: o })).data).toMatchObject({ requester_role: "buyer", status: "requested" });
    expect((await call("get_order_cancellation", w.buyer2.token, { p_order_id: o })).status).toBe(403);
    const req = await rowOf<any>(w, `select id from public.cancellation_requests where order_id = $1`, [o]);
    expect((await call("vendor_decide_cancellation", w.buyer.token, { p_request_id: req.id, p_decision: "refund" })).status).toBe(403); // only the shop
    const ok = await call("vendor_decide_cancellation", w.vendor.token, { p_request_id: req.id, p_decision: "refund" });
    expect(ok.status).toBe(200);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("cancelled");
    const rows = await refundsOf(o);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.amount_kobo)).toBe(485000);
    expect((await call("buyer_cancel_order", w.buyer.token, { p_order_id: o })).status).toBe(400);
  });

  it("when the shop declines, an admin can still refund the buyer", async () => {
    const o = await newOrder(w, 4500);
    await payOrder(w, o);
    await call("buyer_cancel_order", w.buyer.token, { p_order_id: o });
    const req = await rowOf<any>(w, `select id from public.cancellation_requests where order_id = $1`, [o]);
    expect((await call("vendor_decide_cancellation", w.vendor.token, { p_request_id: req.id, p_decision: "decline" })).status).toBe(400); // a reason is needed
    const no = await call("vendor_decide_cancellation", w.vendor.token, { p_request_id: req.id, p_decision: "decline", p_reason: "Already prepared" });
    expect(no.data).toMatchObject({ vendor_decision: "declined" });
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and type = 'refund_declined'`, [w.buyer.id])).toBeTruthy();
    expect(await refundsOf(o)).toHaveLength(0);
    expect((await call("get_order_cancellation", w.admin.token, { p_order_id: o })).data).toMatchObject({ vendor_decision: "declined", status: "requested" });
    const adminOk = await call("admin_decide_cancellation", w.admin.token, { p_request_id: req.id, p_decision: "approve" });
    expect(adminOk.status).toBe(200);
    expect(Number((await refundsOf(o))[0]!.amount_kobo)).toBe(436500);
  });

  it("nobody else can cancel it, and the buyer cannot once it is out for delivery", async () => {
    const o = await newOrder(w, 4000);
    await payOrder(w, o);
    expect((await call("buyer_cancel_order", w.buyer2.token, { p_order_id: o })).status).toBe(403);
    await handOver(w, o);
    const r = await call("buyer_cancel_order", w.buyer.token, { p_order_id: o });
    expect(r.status).toBe(400);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("handed_over");
  });

  it("an unpaid order is cancelled without any refund", async () => {
    const o = await newOrder(w, 3000);
    const r = await call("buyer_cancel_order", w.buyer.token, { p_order_id: o });
    expect(r.data).toMatchObject({ cancelled: true, refunded: false });
    expect(await refundsOf(o)).toHaveLength(0);
  });

  it("a shop asks to cancel a paid order; the admin approves and the buyer is refunded", async () => {
    const o = await newOrder(w, 6000);
    expect((await call("request_order_cancellation", w.vendor.token, { p_order_id: o, p_reason: "Out of stock" })).status).toBe(400); // not paid yet
    await payOrder(w, o);
    expect((await call("request_order_cancellation", w.buyer.token, { p_order_id: o, p_reason: "no thanks" })).status).toBe(403);
    expect((await call("request_order_cancellation", w.vendor.token, { p_order_id: o, p_reason: "  " })).status).toBe(400);
    expect((await call("request_order_cancellation", w.vendor.token, { p_order_id: o, p_reason: "Out of stock" })).status).toBe(200);
    expect((await call("request_order_cancellation", w.vendor.token, { p_order_id: o, p_reason: "Out of stock" })).status).toBe(409);
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and title = 'Cancellation request'`, [w.admin.id])).toBeTruthy();
    const open = await rowOf<any>(w, `select id from public.cancellation_requests where order_id = $1`, [o]);
    expect((await call("admin_decide_cancellation", w.vendor.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(403);
    const ok = await call("admin_decide_cancellation", w.admin.token, { p_request_id: open.id, p_decision: "approve" });
    expect(ok.status).toBe(200);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("cancelled");
    expect(Number((await refundsOf(o))[0]!.amount_kobo)).toBe(582000);
    expect((await call("admin_decide_cancellation", w.admin.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(409);
  });

  it("a rejection needs a reason and the shop sees it", async () => {
    const o = await newOrder(w, 2500);
    await payOrder(w, o);
    await call("request_order_cancellation", w.vendor.token, { p_order_id: o, p_reason: "Changed my mind" });
    const open = await rowOf<any>(w, `select id from public.cancellation_requests where order_id = $1`, [o]);
    expect((await call("admin_decide_cancellation", w.admin.token, { p_request_id: open.id, p_decision: "reject", p_reason: "" })).status).toBe(400);
    expect((await call("admin_decide_cancellation", w.admin.token, { p_request_id: open.id, p_decision: "reject", p_reason: "The buyer already collected it." })).status).toBe(200);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("confirmed");
    const told = await rowOf<any>(w, `select body from public.notifications where user_id = $1 and type = 'cancellation_rejected'`, [w.vendor.id]);
    expect(told.body).toContain("already collected");
    expect(await refundsOf(o)).toHaveLength(0);
  });
});

describe("confirming receipt early", () => {
  const w = useWorld();
  it("the buyer can say they have received a paid order before the shop marks it out for delivery", async () => {
    const o = await newOrder(w, 4500);
    expect((await json(await api.post(w, `/orders/${o}/received`, w.buyer.token))).status).toBe(400); // not paid yet
    await payOrder(w, o);
    expect((await json(await api.post(w, `/orders/${o}/received`, w.buyer2.token))).status).toBe(403);
    expect((await json(await api.post(w, `/orders/${o}/received`, w.buyer.token))).status).toBe(200);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [o]))?.s).toBe("completed");
  });
});
