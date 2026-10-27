import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VendorPayoutsService } from "../../src/modules/vendor-payouts/vendor-payouts.service.js";
import { seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("vendor payouts (issue #98)", () => {
  let db: TestDatabase;
  let service: VendorPayoutsService;
  let buyer: string;
  let owner: string;
  let shop: string;
  let product: string;
  let admin: string;
  let stranger: string;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  type Answer = () => Response | Promise<Response>;
  let transferAnswer: Answer;
  let verifyAnswer: Answer;
  const transfers: Array<Record<string, unknown>> = [];

  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });
  const rejected = (message: string, status = 400) => new Response(JSON.stringify({ status: false, message }), { status });

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_payouts";
    db = await createTestDatabase();
    service = new VendorPayoutsService(() => db.data);
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    stranger = (await seedUser(db)).id;
    buyer = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop);
  }, 60_000);
  beforeEach(async () => {
    transfers.length = 0;
    await db.query(`delete from public.vendor_payouts`);
    transferAnswer = () => ok({ transfer_code: "TRF_1", reference: "x", status: "pending" });
    verifyAnswer = () => rejected("Transfer not found", 404);
    await db.query(`update public.vendors set transfer_recipient_code = 'RCP_test', payout_verified_at = now() where id = $1`, [shop]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (/\/transfer\/verify\//.test(u)) return verifyAnswer();
        if (/\/transfer$/.test(u) && init?.method === "POST") {
          transfers.push(JSON.parse(String(init.body)));
          return transferAnswer();
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = savedKey;
    await db.close();
  });

  /** A confirmed order paid by card through Paystack (net `naira`), with a commission charge, then completed. */
  async function completedOrder(naira = 1500, commission = 75, viaPaystack = true) {
    const orderId = await seedOrder(db, buyer, shop, { status: "confirmed", productIds: [product], total: naira });
    const ref = viaPaystack ? `lvm_ord_${crypto.randomBytes(6).toString("hex")}` : `manual_${crypto.randomBytes(4).toString("hex")}`;
    await db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', $2, $3, 'paid', $4)`, [orderId, naira, viaPaystack ? "card" : "transfer", ref]);
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    await db.query(`update public.vendor_payouts set status = 'pending', hold_reason = null where order_id = $1 and status = 'on_hold' and hold_reason = 'Waiting for the vendor to withdraw'`, [orderId]); // the shop withdrew (migration 0017)
    await db.query(`delete from public.commission_charges where order_id = $1`, [orderId]);
    if (commission > 0) await db.query(`insert into public.commission_charges (vendor_id, order_id, amount, status) values ($1, $2, $3, 'owed')`, [shop, orderId, commission]);
    return orderId;
  }
  const payouts = (orderId: string) => db.query<{ id: string; status: string; amount_kobo: string; commission_kobo: string; transfer_reference: string; attempts: number; hold_reason: string | null; next_attempt_at: string | null }>(`select id, status, amount_kobo::text, commission_kobo::text, transfer_reference, attempts, hold_reason, next_attempt_at from public.vendor_payouts where order_id = $1`, [orderId]);
  const only = async (orderId: string) => (await payouts(orderId))[0]!;

  it("completing a Paystack-paid order queues exactly one payout, even if it is completed twice", async () => {
    const orderId = await completedOrder();
    expect(await payouts(orderId)).toHaveLength(1);
    await db.query(`update public.orders set status = 'disputed' where id = $1`, [orderId]);
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    await db.query(`update public.vendor_payouts set status = 'pending', hold_reason = null where order_id = $1 and status = 'on_hold' and hold_reason = 'Waiting for the vendor to withdraw'`, [orderId]); // the shop withdrew (migration 0017)
    expect(await payouts(orderId)).toHaveLength(1);
  });

  it("an order paid some other way gets no payout", async () => {
    const orderId = await completedOrder(1500, 75, false);
    expect(await payouts(orderId)).toHaveLength(0);
  });

  it("sends paid minus commission, in exact kobo, and settles the commission charge", async () => {
    const orderId = await completedOrder(1500.5, 75.03);
    await service.run();
    const p = await only(orderId);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ amount: 142547, recipient: "RCP_test", reference: p.transfer_reference });
    expect(p.status).toBe("processing"); // Paystack said "pending": the webhook finishes it
    expect(p.amount_kobo).toBe("142547");
    expect(p.commission_kobo).toBe("7503");
    const charge = await db.query<{ status: string }>(`select status from public.commission_charges where order_id = $1`, [orderId]);
    expect(charge[0]!.status).toBe("paid");
  });

  it("FIX review #2: a completed Paystack order's commission is collected from the payout, never asked of the shop", async () => {
    const orderId = await seedOrder(db, buyer, shop, { status: "confirmed", productIds: [product], total: 5000 });
    const [pay] = await db.query<{ id: string }>(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', 5000, 'card', 'paid', $2) returning id`, [orderId, "lvm_ord_" + crypto.randomBytes(6).toString("hex")]);
    await db.query(`update public.orders set total_amount = 5000, status = 'completed' where id = $1`, [orderId]);
    const charges = await db.query<{ status: string; amount: string; payment_id: string | null; due_at: string | null }>(`select status, amount::text, payment_id, due_at from public.commission_charges where order_id = $1`, [orderId]);
    expect(charges).toEqual([{ status: "paid", amount: "150.00", payment_id: pay!.id, due_at: null }]);
    const owed = await db.query<{ n: string }>(`select coalesce(sum(amount), 0)::text as n from public.commission_charges where order_id = $1 and status = 'owed'`, [orderId]);
    expect(owed[0]!.n).toBe("0");
    // completed again (after a dispute): still one charge
    await db.query(`update public.orders set status = 'disputed' where id = $1`, [orderId]);
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    expect(await db.query(`select 1 from public.commission_charges where order_id = $1`, [orderId])).toHaveLength(1);
    // the shop withdraws: the payout takes the 3% once
    await db.query(`update public.vendor_payouts set status = 'pending', hold_reason = null where order_id = $1`, [orderId]);
    await service.run();
    expect(transfers.at(-1)).toMatchObject({ amount: 500000 - 15000 });
  });

  it("FIX review #2: commission the shop already paid itself is not taken again from the payout", async () => {
    const orderId = await completedOrder(2000, 100);
    await db.query(`update public.commission_charges set status = 'paid', paid_at = now() where order_id = $1`, [orderId]); // paid through the commission checkout
    await service.run();
    expect(transfers.at(-1)).toMatchObject({ amount: 200000 });
  });

  it("FIX review #2: a payout retried after a failed transfer still takes the commission, once", async () => {
    const orderId = await completedOrder(2000, 100);
    transferAnswer = () => rejected("Recipient is invalid", 422);
    await service.run();
    expect(transfers.at(-1)).toMatchObject({ amount: 190000 });
    await db.query(`update public.vendor_payouts set updated_at = now() - interval '2 hours' where order_id = $1`, [orderId]);
    transferAnswer = () => ok({ transfer_code: "TRF_2", reference: "x", status: "pending" });
    await service.run(); // queued again
    await service.run(); // sent again
    expect(transfers.at(-1)).toMatchObject({ amount: 190000 });
  });

  it("FIX review #2: an order paid some other way still owes its commission as before", async () => {
    const orderId = await seedOrder(db, buyer, shop, { status: "confirmed", productIds: [product], total: 4000 });
    await db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', 4000, 'transfer', 'paid', 'manual_x')`, [orderId]);
    await db.query(`update public.orders set total_amount = 4000, status = 'completed' where id = $1`, [orderId]);
    const charges = await db.query<{ status: string; amount: string; due: boolean }>(`select status, amount::text, due_at is not null as due from public.commission_charges where order_id = $1`, [orderId]);
    expect(charges).toEqual([{ status: "owed", amount: "120.00", due: true }]);
  });

  it("FIX review #2: migration 0024 moves existing owed commission on held orders to 'collected', and nothing else", async () => {
    const file = readFileSync(new URL("../../src/database/migrations/0024_commission_taken_from_payout.sql", import.meta.url), "utf8");
    const dataFix = file.slice(file.indexOf("update public.commission_charges c"), file.indexOf("-- Storefronts paused"));
    const held = await completedOrder(1000, 30); // owed, payout waiting
    const sent = await completedOrder(1000, 30);
    await db.query(`update public.vendor_payouts set status = 'success' where order_id = $1`, [sent]);
    const paidBySelf = await completedOrder(1000, 30);
    await db.query(`update public.commission_charges set status = 'paid', paid_at = now() where order_id = $1`, [paidBySelf]);
    await db.query(dataFix);
    const row = async (id: string) => (await db.query<{ status: string; linked: boolean; due: boolean }>(`select status, payment_id is not null as linked, due_at is not null as due from public.commission_charges where order_id = $1`, [id]))[0];
    expect(await row(held)).toEqual({ status: "paid", linked: true, due: false });
    expect(await row(sent)).toEqual(expect.objectContaining({ status: "owed", linked: false }));
    expect(await row(paidBySelf)).toEqual(expect.objectContaining({ status: "paid", linked: false }));
  });

  it("a partial refund comes off the payout", async () => {
    const orderId = await completedOrder(2000, 100);
    const ref = (await db.query<{ provider_reference: string }>(`select provider_reference from public.payments where order_id = $1`, [orderId]))[0]!.provider_reference;
    await db.query(`insert into public.paystack_transactions (reference, purpose, order_id, payer_user_id, amount_kobo, status) values ($1, 'order_payment', $2, $3, 200000, 'success')`, [ref, orderId, buyer]);
    await db.query(`insert into public.paystack_refunds (transaction_reference, order_id, amount_kobo, status) values ($1, $2, 30000, 'processed')`, [ref, orderId]);
    await service.run();
    expect(transfers.at(-1)).toMatchObject({ amount: 200000 - 10000 - 30000 });
  });

  it("two workers at once make one transfer", async () => {
    const orderId = await completedOrder();
    await Promise.all([service.run(), service.run(), service.run()]);
    expect(transfers.filter((t) => t.reference === (transfers[0] as { reference: string }).reference)).toHaveLength(1);
    expect(transfers).toHaveLength(1);
    expect((await only(orderId)).attempts).toBe(1);
  });

  it("a timeout is looked up before anything is sent again: success means no second transfer", async () => {
    const orderId = await completedOrder();
    transferAnswer = () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    verifyAnswer = () => ok({ status: "success", reference: "x", transfer_code: "TRF_9" });
    await service.run();
    expect((await only(orderId)).status).toBe("success");
    await service.run();
    expect(transfers).toHaveLength(1);
  });

  it("a timeout where Paystack never saw the request is queued again with the same reference", async () => {
    const orderId = await completedOrder();
    transferAnswer = () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await service.run();
    const p = await only(orderId);
    expect(p.status).toBe("pending");
    expect(p.attempts).toBe(0);
    expect(p.next_attempt_at).not.toBeNull();
  });

  it("a failed transfer is retried under a new reference; after three failures it goes on hold", async () => {
    const orderId = await completedOrder();
    transferAnswer = () => rejected("Recipient is invalid", 422);
    const first = (await only(orderId)).transfer_reference;
    for (let round = 1; round <= 6; round++) {
      await service.run(); // sends and fails, or (once the wait is over) queues it again, or holds it
      // the table stamps updated_at itself, so switch that off just long enough to pretend two hours went by
      await db.query(`alter table public.vendor_payouts disable trigger user`);
      await db.query(`update public.vendor_payouts set updated_at = now() - interval '2 hours' where order_id = $1 and status = 'failed'`, [orderId]);
      await db.query(`alter table public.vendor_payouts enable trigger user`);
    }
    const p = await only(orderId);
    expect(p.status).toBe("on_hold");
    expect(p.hold_reason).toMatch(/failed 3 times/);
    expect(new Set(transfers.map((t) => t.reference)).size).toBe(transfers.length); // never the same reference twice
    expect(transfers[0]!.reference).toBe(first);
  });

  it("an open dispute holds the payout; releasing it after the dispute is closed sends it", async () => {
    const orderId = await completedOrder();
    await db.query(`insert into public.disputes (order_id, raised_by, reason, status) values ($1, 'buyer', 'Not as described', 'open')`, [orderId]);
    await service.run();
    expect(transfers).toHaveLength(0);
    expect((await only(orderId)).status).toBe("on_hold");
    await db.query(`update public.disputes set status = 'resolved' where order_id = $1`, [orderId]);
    const id = (await only(orderId)).id;
    await service.release({ userId: admin } as never, id);
    await service.run();
    expect(transfers).toHaveLength(1);
  });

  it("a vendor without a verified account is held, and told", async () => {
    await db.query(`update public.vendors set payout_verified_at = null where id = $1`, [shop]);
    const orderId = await completedOrder();
    await service.run();
    const p = await only(orderId);
    expect(p.status).toBe("on_hold");
    expect(p.hold_reason).toMatch(/verified payout account/);
    expect(transfers).toHaveLength(0);
    const told = await db.query(`select 1 from public.notifications where user_id = $1 and type = 'payout_on_hold'`, [owner]);
    expect(told.length).toBeGreaterThan(0);
  });

  it("an empty Paystack balance leaves the payout pending, waits, and alerts admins once a day", async () => {
    await db.query(`delete from public.notifications where title = 'Top up the Paystack balance'`);
    const a = await completedOrder();
    const b = await completedOrder();
    transferAnswer = () => rejected("Your balance is not enough to fulfil this request", 400);
    await service.run();
    expect((await only(a)).status).toBe("pending");
    expect((await only(a)).next_attempt_at).not.toBeNull();
    expect((await only(b)).status).toBe("pending");
    await service.run(); // both are waiting: nothing is retried
    const alerts = await db.query(`select 1 from public.notifications where user_id = $1 and title = 'Top up the Paystack balance'`, [admin]);
    expect(alerts).toHaveLength(1);
    expect(transfers.length).toBeLessThanOrEqual(2);
  });

  it("a transfer Paystack reports as successful right away is finished and the vendor is told", async () => {
    transferAnswer = () => ok({ transfer_code: "TRF_5", reference: "x", status: "success" });
    const orderId = await completedOrder(1000, 0);
    await service.run();
    expect((await only(orderId)).status).toBe("success");
    const told = await db.query(`select body from public.notifications where user_id = $1 and type = 'payout_sent' order by created_at desc limit 1`, [owner]);
    expect(told[0]).toBeTruthy();
  });

  it("admin actions: only admins; hold, mark-manual (no Paystack call) and release are logged", async () => {
    const orderId = await completedOrder();
    const id = (await only(orderId)).id;
    await expect(service.hold({ userId: stranger } as never, id, "just because")).rejects.toThrow(/admin/i);
    await service.hold({ userId: admin } as never, id, "Checking the account");
    expect((await only(orderId)).status).toBe("on_hold");
    await service.run();
    expect(transfers).toHaveLength(0);
    await service.markManual({ userId: admin } as never, id, "Paid by bank transfer, ref 123");
    const p = await only(orderId);
    expect(p.status).toBe("paid_manually");
    expect(transfers).toHaveLength(0);
    await expect(service.release({ userId: admin } as never, id)).rejects.toThrow();
    const log = await db.query(`select action from public.admin_actions where target_id = $1`, [id]);
    expect(log.length).toBe(2);
  });

  it("a vendor sees only their own payouts", async () => {
    const orderId = await completedOrder();
    const mine = await service.mine({ userId: owner } as never, { limit: 50, offset: 0 });
    expect(mine.some((p) => p.orderId === orderId)).toBe(true);
    expect(await service.mine({ userId: stranger } as never, { limit: 50, offset: 0 })).toHaveLength(0);
  });
});
