import { describe, expect, it } from "vitest";
import { newOrder, rowOf, useWorld } from "./harness.js";

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

  it("marks the payment paid and starts the buyer's confirmation, once", async () => {
    const id = await newOrder(w, 4000);
    await pending(id, "medris_testref1", 4000);
    expect(await apply("medris_testref1", 400000)).toMatchObject({ applied: true, awaiting_buyer_confirmation: true });
    expect((await rowOf(w, `select status::text as s from public.payments where provider_reference = 'medris_testref1'`))?.s).toBe("paid");
    expect(await order(id)).toMatchObject({ status: "confirmed", awaiting: true });
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
});
