import { describe, expect, it } from "vitest";
import { api, json, newOrder, rowOf, useWorld } from "./harness.js";

// Migration 0014: a payment Paystack confirmed moves the ORDER on by itself (the old medris_ references used to
// only mark the payment row paid and left the order "confirmed").
describe("apply_card_payment_to_order (a Paystack payment moves the order on)", () => {
  const w = useWorld();

  async function pending(orderId: string, reference: string, naira: number) {
    await w.db.query(
      `insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', $2, 'card', 'pending', $3)`,
      [orderId, naira, reference],
    );
  }
  const apply = async (reference: string, kobo: number | null) =>
    (await rowOf<{ r: Record<string, unknown> }>(w, `select public.apply_card_payment_to_order($1, $2) as r`, [reference, kobo]))!.r;
  const order = (id: string) => rowOf(w, `select status::text as status, awaiting_confirmation_since is not null as awaiting from public.orders where id = $1`, [id]);

  it("marks the payment paid; the buyer's confirmation window starts later, at hand-over; only once", async () => {
    const id = await newOrder(w, 4000);
    await pending(id, "medris_testref1", 4000);
    expect(await apply("medris_testref1", 400000)).toMatchObject({ applied: true, awaiting_buyer_confirmation: true });
    expect((await order(id))?.awaiting).toBe(false); // paid, but not handed over yet
    expect((await rowOf(w, `select status::text as s from public.payments where provider_reference = 'medris_testref1'`))?.s).toBe("paid");
    expect(await order(id)).toMatchObject({ status: "confirmed", awaiting: false });
    // webhook and the buyer's return both call it: the second one changes nothing
    expect(await apply("medris_testref1", 400000)).toMatchObject({ applied: false, reason: "already_applied" });
  });

  it("does nothing when Paystack reports less than the order needed", async () => {
    const id = await newOrder(w, 4000);
    await pending(id, "medris_testref2", 4000);
    expect(await apply("medris_testref2", 100)).toMatchObject({ applied: false, reason: "amount_too_low" });
    expect((await rowOf(w, `select status::text as s from public.payments where provider_reference = 'medris_testref2'`))?.s).toBe("pending");
    expect((await order(id))?.awaiting).toBe(false);
  });

  it("ignores a reference it does not know", async () => {
    expect(await apply("medris_nope", 1)).toMatchObject({ applied: false, reason: "unknown_reference" });
  });

  it("the vendor can mark a PAID order out for delivery (not an unpaid one), which starts the buyer's window", async () => {
    const unpaid = await newOrder(w, 4000);
    const refused = await json(await api.post(w, `/orders/${unpaid}/status`, w.vendor.token, { status: "handed_over" }));
    expect(refused.status).toBe(400);

    const id = await newOrder(w, 4000);
    await pending(id, "medris_testref4", 4000);
    await apply("medris_testref4", 400000);
    const ok = await json(await api.post(w, `/orders/${id}/status`, w.vendor.token, { status: "handed_over" }));
    expect(ok.status).toBe(200);
    expect(await order(id)).toMatchObject({ status: "handed_over", awaiting: true });
  });

  it("is received automatically after 48 hours, not after 24", async () => {
    const id = await newOrder(w, 4000);
    await pending(id, "medris_testref5", 4000);
    await apply("medris_testref5", 400000);
    await api.post(w, `/orders/${id}/status`, w.vendor.token, { status: "handed_over" });
    const completable = async () => (await w.db.query(`select o.id from public.orders o where o.id = $1 and o.awaiting_confirmation_since < now() - interval '48 hours'`, [id])).length;
    await w.db.query(`update public.orders set awaiting_confirmation_since = now() - interval '30 hours' where id = $1`, [id]);
    expect(await completable()).toBe(0);
    const fn = await rowOf<{ n: number }>(w, `select public.auto_complete_eligible_orders() as n`);
    expect(fn?.n).toBe(0); // 30 hours: still inside the window
    await w.db.query(`update public.orders set awaiting_confirmation_since = now() - interval '49 hours' where id = $1`, [id]);
    const fn2 = await rowOf<{ n: number }>(w, `select public.auto_complete_eligible_orders() as n`);
    expect(fn2?.n).toBeGreaterThanOrEqual(1);
    expect((await order(id))?.status).toBe("completed");
  });
});
