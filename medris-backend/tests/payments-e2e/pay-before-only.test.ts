import { describe, expect, it } from "vitest";
import { api, json, rowOf, useWorld } from "./harness.js";
import { buildTestApp, call } from "../support/fixtures.js";

// Pay-after-delivery is switched off: even a product still set to it is bought in full, up front.
describe("every new order is paid in full first", () => {
  const w = useWorld();
  it("a delivered order for a product that used to be pay-after is pay-before", async () => {
    await w.db.query(`update public.products set payment_timing = 'pay_after', payment_deposit_percent = 20 where id = $1`, [w.product]);
    const res = await json(
      await call(buildTestApp(w.db, { env: { PAY_AFTER_DELIVERY_ENABLED: "false" } }), "POST", "/api/v1/rpc/create_sale_order", {
        token: w.buyer.token,
        body: { p_vendor_id: w.vendor.shop, p_product_id: w.product, p_quantity: 1, p_delivery_method: "delivery", p_delivery_address: "Room 1", p_delivery_phone: "08012345678" },
      }),
    );
    expect(res.status).toBe(200);
    const o = await rowOf<{ t: string; d: string; total: string }>(w, `select payment_timing::text as t, deposit_amount::text as d, total_amount::text as total from public.orders order by created_at desc limit 1`);
    expect(o?.t).toBe("pay_before");
    expect(Number(o?.d)).toBe(Number(o?.total));
    void api;
  });
});
