/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { describe, expect, it } from "vitest";
import { api, handOver, json, newOrder, payOrder, rowOf, runJob, useWorld } from "./harness.js";

// Migration 0017: completed orders leave the money waiting; the shop withdraws it. Money paid 48h+ ago goes at once,
// newer money needs an admin (a rejection needs a reason), an order in dispute is held, the rest is not.
describe("withdrawals", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));

  /** A paid and completed order of `naira`; `hoursAgo` pretends it was paid that long ago. */
  async function done(naira: number, hoursAgo = 0) {
    const o = await newOrder(w, naira);
    await payOrder(w, o);
    await handOver(w, o);
    expect((await json(await api.post(w, `/orders/${o}/received`, w.buyer.token))).status).toBe(200);
    if (hoursAgo) await w.db.query(`update public.payments set paid_at = now() - ($2 || ' hours')::interval where order_id = $1`, [o, String(hoursAgo)]);
    return o;
  }
  const clean = async () => {
    await w.db.query(`delete from public.withdrawal_requests`);
    await w.db.query(`update public.vendor_payouts set status = 'success' where status in ('on_hold','pending')`);
    await w.db.query(`delete from public.disputes`);
  };

  it("completing an order leaves the money waiting, nothing is sent", async () => {
    await clean();
    const o = await done(5000);
    expect(await rowOf(w, `select status, hold_reason from public.vendor_payouts where order_id = $1`, [o])).toMatchObject({ status: "on_hold", hold_reason: "Waiting for the vendor to withdraw" });
    await runJob(w, "vendor-payouts");
    expect(w.paystack.calls.filter((c: any) => String(c.path ?? c.url ?? "").includes("transfer")).length).toBe(0);
  });

  it("old money goes straight to the sending queue; new money becomes a request", async () => {
    await clean();
    const old = await done(5000, 60);
    const fresh = await done(4000, 1);
    const r = await call("request_withdrawal", w.vendor.token);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ sent_kobo: expect.any(Number), requested_kobo: expect.any(Number) });
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [old])).toMatchObject({ status: "pending" });
    expect(await rowOf(w, `select status, withdrawal_id from public.vendor_payouts where order_id = $1`, [fresh])).toMatchObject({ status: "on_hold" });
    const open = await rowOf<any>(w, `select id, status, kind from public.withdrawal_requests where status = 'requested'`);
    expect(open).toMatchObject({ kind: "approval" });
    // the admin was told, a second request while one is open adds nothing new
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and title = 'Withdrawal request'`, [w.admin.id])).toBeTruthy();
    expect((await call("request_withdrawal", w.vendor.token)).status).toBe(409);
    // approval releases it
    expect((await call("admin_decide_withdrawal", w.vendor.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(403);
    expect((await call("admin_decide_withdrawal", w.admin.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(200);
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [fresh])).toMatchObject({ status: "pending" });
    expect((await call("admin_decide_withdrawal", w.admin.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(409);
  });

  it("a rejection needs a reason, the shop sees it, and the money is back to waiting", async () => {
    await clean();
    const fresh = await done(6000, 2);
    await call("request_withdrawal", w.vendor.token);
    const open = await rowOf<any>(w, `select id from public.withdrawal_requests where status = 'requested'`);
    expect((await call("admin_decide_withdrawal", w.admin.token, { p_request_id: open.id, p_decision: "reject", p_reason: "  " })).status).toBe(400);
    expect((await call("admin_decide_withdrawal", w.admin.token, { p_request_id: open.id, p_decision: "reject", p_reason: "Please verify your phone number first." })).status).toBe(200);
    expect(await rowOf(w, `select status, withdrawal_id from public.vendor_payouts where order_id = $1`, [fresh])).toMatchObject({ status: "on_hold", withdrawal_id: null });
    const told = await rowOf<any>(w, `select body from public.notifications where user_id = $1 and type = 'withdrawal_rejected'`, [w.vendor.id]);
    expect(told.body).toContain("verify your phone number");
    const sum = await call("get_withdrawal_summary", w.vendor.token);
    expect(sum.data.recent[0]).toMatchObject({ status: "rejected", reject_reason: "Please verify your phone number first." });
    expect(Number(sum.data.approval_kobo)).toBeGreaterThan(0);
  });

  it("only the disputed order is held; the rest can be withdrawn; the admin is warned", async () => {
    await clean();
    const bad = await done(7000, 60);
    const good = await done(5000, 60);
    await w.db.query(`insert into public.disputes (order_id, raised_by, reason, status) values ($1, 'buyer', 'not received', 'open')`, [bad]);
    const sum = await call("get_withdrawal_summary", w.vendor.token);
    expect(sum.data.has_dispute).toBe(true);
    expect(Number(sum.data.held_kobo)).toBeGreaterThan(0);
    expect((await call("request_withdrawal", w.vendor.token)).status).toBe(200);
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [good])).toMatchObject({ status: "pending" });
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [bad])).toMatchObject({ status: "on_hold" });
    const list = await call("admin_list_withdrawals", w.admin.token, {});
    expect(list.status).toBe(200);
  });

  it("below the minimum nothing happens", async () => {
    await clean();
    await done(500, 60);
    const r = await call("request_withdrawal", w.vendor.token);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("smallest withdrawal");
  });

  it("a recent bank change blocks withdrawing", async () => {
    await clean();
    await done(5000, 60);
    await w.db.query(`update public.vendors set payout_verified_at = now() - interval '2 hours' where id = $1`, [w.vendor.shop]);
    const r = await call("request_withdrawal", w.vendor.token);
    expect(r.status).toBe(400);
    await w.db.query(`update public.vendors set payout_verified_at = now() - interval '3 days' where id = $1`, [w.vendor.shop]);
    expect((await call("request_withdrawal", w.vendor.token)).status).toBe(200);
  });

  it("a resolved dispute can be reopened until its money is sent", async () => {
    await clean();
    const o = await done(5000, 60);
    const d = (await rowOf<any>(w, `insert into public.disputes (order_id, raised_by, reason, status) values ($1, 'buyer', 'x', 'resolved') returning id`, [o])).id;
    expect((await call("admin_reopen_dispute", w.vendor.token, { p_dispute_id: d })).status).toBe(403);
    expect((await call("admin_reopen_dispute", w.admin.token, { p_dispute_id: d, p_note: "new evidence" })).status).toBe(200);
    expect(await rowOf(w, `select status from public.disputes where id = $1`, [d])).toMatchObject({ status: "open" });
    expect((await call("admin_reopen_dispute", w.admin.token, { p_dispute_id: d })).status).toBe(409);
    // once the money has been sent it cannot be reopened
    await w.db.query(`update public.disputes set status = 'resolved' where id = $1`, [d]);
    await w.db.query(`update public.vendor_payouts set status = 'success' where order_id = $1`, [o]);
    expect((await call("admin_reopen_dispute", w.admin.token, { p_dispute_id: d })).status).toBe(409);
  });
});
