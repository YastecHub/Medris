import { describe, expect, it } from "vitest";
import { api, completeAndPayOut, json, newOrder, payOrder, rowOf, runJob, sendWebhook, startPayment, useWorld } from "./harness.js";
import { call } from "../support/fixtures.js";

describe("who may do what, the on/off switch, and Levromart's own fees", () => {
  const w = useWorld();

  describe("permissions", () => {
    it("a buyer cannot pay for, or look at the payment of, someone else's order", async () => {
      const orderId = await newOrder(w);
      expect((await startPayment(w, orderId, w.buyer2.token)).status).toBe(403);
      const reference = (await startPayment(w, orderId)).data.reference as string;
      expect((await json(await api.get(w, `/payments/paystack/${reference}`, w.buyer2.token))).status).toBe(404);
      expect((await json(await api.get(w, `/payments/paystack/${reference}`, w.buyer.token))).status).toBe(200);
    });

    it("signed-out visitors get 401 everywhere money is involved", async () => {
      const orderId = await newOrder(w);
      for (const [method, path] of [
        ["POST", `/api/v1/orders/${orderId}/paystack/initialize`],
        ["GET", "/api/v1/payments/paystack/lvm_ord_x"],
        ["POST", `/api/v1/admin/orders/${orderId}/refund`],
        ["GET", "/api/v1/admin/payments/summary"],
        ["GET", "/api/v1/admin/payouts"],
        ["GET", "/api/v1/shops/mine/payouts"],
        ["POST", "/api/v1/shops/mine/commission/paystack/initialize"],
      ] as const) {
        const res = await call(w.app, method, path, { body: method === "POST" ? { reason: "x" } : undefined });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });

    it("only admins can refund, hold, release, mark paid by hand, or open the money screens", async () => {
      const orderId = await newOrder(w);
      await payOrder(w, orderId);
      await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token));
      const payout = (await rowOf<{ id: string }>(w, `select id from public.vendor_payouts where order_id = $1`, [orderId]))!;
      for (const person of [w.buyer, w.vendor]) {
        expect((await json(await api.post(w, `/admin/orders/${orderId}/refund`, person.token, { reason: "please" }))).status).toBe(403);
        expect((await json(await api.post(w, `/admin/payouts/${payout.id}/release`, person.token))).status).toBe(403);
        expect((await json(await api.post(w, `/admin/payouts/${payout.id}/hold`, person.token, { reason: "mine" }))).status).toBe(403);
        expect((await json(await api.post(w, `/admin/payouts/${payout.id}/mark-manual`, person.token, { note: "I paid myself" }))).status).toBe(403);
        expect((await json(await api.get(w, "/admin/payments/summary", person.token))).status).toBe(403);
        expect((await json(await api.get(w, "/admin/payouts", person.token))).status).toBe(403);
      }
      expect((await rowOf(w, `select status from public.vendor_payouts where id = $1`, [payout.id]))?.status).toBe("pending");
      // an admin can, and it is logged
      expect((await json(await api.post(w, `/admin/payouts/${payout.id}/hold`, w.admin.token, { reason: "checking the account" }))).status).toBe(200);
      expect((await json(await api.post(w, `/admin/payouts/${payout.id}/mark-manual`, w.admin.token, { note: "Paid by transfer, ref 123" }))).status).toBe(200);
      expect((await rowOf(w, `select status from public.vendor_payouts where id = $1`, [payout.id]))?.status).toBe("paid_manually");
      expect((await w.db.query(`select 1 from public.admin_actions where target_id = $1`, [payout.id])).length).toBe(2);
      expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(0); // marking by hand never calls Paystack
    });

    it("a vendor cannot make their own payout happen early: the worker needs the job secret, and only runs after completion", async () => {
      const orderId = await newOrder(w);
      await payOrder(w, orderId);
      const early = await call(w.app, "POST", "/api/v1/jobs/vendor-payouts", { token: w.vendor.token });
      expect(early.status).toBe(401);
      await runJob(w, "vendor-payouts");
      expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(0); // not completed yet: nothing to pay
      expect(await w.db.query(`select 1 from public.vendor_payouts where order_id = $1`, [orderId])).toHaveLength(0);
    });
  });

  describe("the PAYSTACK_CHECKOUT_ENABLED switch", () => {
    it("off: starting a payment is refused, but an order already paid still completes, pays out and refunds", async () => {
      const orderId = await newOrder(w, 3000);
      const reference = await payOrder(w, orderId); // paid while it was on
      const other = await newOrder(w, 2000);
      const refused = await json(await api.post(w, `/orders/${other}/paystack/initialize`, w.buyer.token, undefined, w.appOff));
      expect(refused.status).not.toBe(200);
      expect(w.paystack.callsTo("POST", "/transaction/initialize")).toHaveLength(1);
      expect((await json(await api.get(w, "/payments/config", w.buyer.token, w.appOff))).data).toMatchObject({ paystackCheckout: false });
      // still works with the switch off
      await completeAndPayOut(w, orderId);
      expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
      const paid2 = await newOrder(w, 1000);
      const ref2 = await payOrder(w, paid2);
      const r = await json(await api.post(w, `/admin/orders/${paid2}/refund`, w.admin.token, { reason: "switch is off" }, w.appOff));
      expect(r.status).toBe(200);
      await runJob(w, "paystack-refunds");
      expect(w.paystack.refunds).toHaveLength(1);
      void reference;
      void ref2;
    });
  });

  describe("Levromart's own fees", () => {
    const monthlyProduct = async () => {
      const { seedProduct } = await import("../support/fixtures.js");
      const id = await seedProduct(w.db, w.vendor.shop);
      await w.db.query(`update public.products set billing_model = 'monthly', status = 'paused' where id = $1`, [id]);
      return id;
    };

    it("the ₦999 listing fee activates the listing once; paying again for an active listing is not charged", async () => {
      const id = await monthlyProduct();
      const start = await json(await api.post(w, `/listings/product/${id}/paystack/initialize`, w.vendor.token));
      expect(start.status).toBe(200);
      expect(w.paystack.callsTo("POST", "/transaction/initialize")[0]!.body).toMatchObject({ amount: 99900 });
      const reference = start.data.reference as string;
      const charge = w.paystack.completeCheckout(reference);
      await sendWebhook(w, "charge.success", charge);
      await sendWebhook(w, "charge.success", charge, { id: 1 });
      const row = await rowOf<{ status: string; billing_status: string; until: string }>(w, `select status, billing_status, billing_paid_until::text as until from public.products where id = $1`, [id]);
      expect(row).toMatchObject({ status: "active", billing_status: "active" });
      const again = await json(await api.post(w, `/listings/product/${id}/paystack/initialize`, w.vendor.token));
      expect(again.data).toMatchObject({ alreadyActive: true });
      expect(w.paystack.callsTo("POST", "/transaction/initialize")).toHaveLength(1);
      expect((await rowOf(w, `select billing_paid_until::text as until from public.products where id = $1`, [id]))?.until).toBe(row!.until); // not extended twice
    });

    it("someone else's listing cannot be paid for", async () => {
      const id = await monthlyProduct();
      expect((await json(await api.post(w, `/listings/product/${id}/paystack/initialize`, w.buyer.token))).status).toBe(403);
    });

    it("commission paid by card settles every owed charge", async () => {
      await w.db.query(`delete from public.commission_charges where vendor_id = $1`, [w.vendor.shop]);
      for (const amount of [120.5, 80, 49.5]) {
        const orderId = await newOrder(w, 10000, "completed");
        await w.db.query(`delete from public.commission_charges where order_id = $1`, [orderId]);
        await w.db.query(`insert into public.commission_charges (vendor_id, order_id, amount, status) values ($1, $2, $3, 'owed')`, [w.vendor.shop, orderId, amount]);
      }
      const start = await json(await api.post(w, "/shops/mine/commission/paystack/initialize", w.vendor.token));
      expect(start.status).toBe(200);
      expect(start.data.amountNaira).toBe(250);
      await sendWebhook(w, "charge.success", w.paystack.completeCheckout(start.data.reference));
      const charges = await w.db.query<{ status: string }>(`select status from public.commission_charges where vendor_id = $1`, [w.vendor.shop]);
      expect(charges.every((c) => c.status === "paid")).toBe(true);
      expect((await json(await api.post(w, "/shops/mine/commission/paystack/initialize", w.vendor.token))).status).toBe(400); // nothing owed any more
    });
  });
});
