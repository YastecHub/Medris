import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentClaimsService } from "../../src/modules/payment-claims/payment-claims.service.js";
import { identityOf, seedOrder, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

/** An order never moves backwards because of a payment: a delivered order stays delivered after the final payment is confirmed. */
describe("payment claims: orders do not go back a step", () => {
  let db: TestDatabase;
  let buyer: string;
  let owner: string;
  let shop: string;
  let product: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    buyer = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop);
  }, 60_000);
  afterAll(() => db.close());

  async function payAfterOrder(status: string) {
    const id = await seedOrder(db, buyer, shop, { status: "pending", productIds: [product], delivery: "delivery", total: 10000 });
    await db.query(`update public.orders set status = $2 where id = $1`, [id, status]);
    await db.query(`update public.orders set payment_timing = 'pay_after', payment_deposit_percent = 25, delivery_fee = 1000 where id = $1`, [id]);
    await db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'delivery_deposit_20', 2250, 'transfer', 'paid', null)`, [id]);
    return id;
  }
  const claim = (id: string) =>
    db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', 7750, 'transfer', 'pending', 'buyer_report')`, [id]);
  const statusOf = async (id: string) => (await db.query<{ status: string }>(`select status::text from public.orders where id = $1`, [id]))[0]!.status;

  it("pay after delivery: the final payment confirmed on an out-for-delivery order keeps it handed over", async () => {
    const id = await payAfterOrder("handed_over");
    await claim(id);
    expect(await statusOf(id)).toBe("payment_unresolved");
    await new PaymentClaimsService(() => db.data).vendorConfirm(identityOf(owner), id);
    expect(await statusOf(id)).toBe("handed_over");
  });
});
