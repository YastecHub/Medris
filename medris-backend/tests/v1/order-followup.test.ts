import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedOrder, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";

/** "I missed your order - still available?": only for orders that cancelled by themselves, once, from the shop. */
describe("still-available message after an automatic cancellation", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof buildTestApp>;
  beforeAll(async () => {
    db = await createTestDatabase();
    app = buildTestApp(db);
  });
  afterAll(async () => db?.close());

  const send = async (token: string, orderId: string) => {
    const res = await call(app, "POST", "/api/v1/rpc/send_order_still_available", { token, body: { p_order_id: orderId } });
    return { status: res.status, json: (await res.json()) as { error?: { message?: string } } };
  };

  it("tells the customer (up to 3 times, with the shop picture), and refuses other cases", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id, { name: "Bola Bakes" });
    await db.query(`update public.vendors set logo_url = 'https://img.example.com/bola.png' where id = $1`, [shop.id]);
    const product = await seedProduct(db, shop.id);
    const buyer = await seedUser(db, { name: "Ada" });
    const stranger = await seedUser(db);
    const auto = await seedOrder(db, buyer.id, shop.id, { status: "cancelled", productIds: [product] });
    await db.query(`update public.orders set cancellation_reason = 'Cancelled automatically: the vendor did not confirm within 30 minutes', cancelled_at = now() where id = $1`, [auto]);
    const manual = await seedOrder(db, buyer.id, shop.id, { status: "cancelled" });
    await db.query(`update public.orders set cancellation_reason = 'Out of stock', cancelled_at = now() where id = $1`, [manual]);
    const pending = await seedOrder(db, buyer.id, shop.id, { status: "pending" });
    const ownerT = await accessToken(owner.id);

    expect((await send(await accessToken(stranger.id), auto)).status).toBeGreaterThanOrEqual(400);
    expect((await send(ownerT, manual)).status).toBe(400);
    expect((await send(ownerT, pending)).status).toBe(400);

    expect((await send(ownerT, auto)).status).toBe(200);
    const rows = await db.query<{ title: string; target_view: string; actor_name: string | null; actor_avatar_url: string | null; target_params: { productId?: string } }>(
      `select title, target_view, actor_name, actor_avatar_url, target_params from public.notifications where user_id = $1 and type = 'order_followup'`, [buyer.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Bola Bakes missed your order", target_view: "productDetail", actor_name: "Bola Bakes", actor_avatar_url: "https://img.example.com/bola.png" });
    expect(rows[0]!.target_params.productId).toBe(product);

    // any time is fine (even long after the cancellation), but never more than 3 times per order
    await db.query(`update public.orders set cancelled_at = now() - interval '40 days', status_changed_at = now() - interval '40 days' where id = $1`, [auto]);
    expect((await send(ownerT, auto)).status).toBe(200);
    expect((await send(ownerT, auto)).status).toBe(200);
    const fourth = await send(ownerT, auto);
    expect(fourth.status).toBe(400);
    expect(fourth.json.error?.message).toMatch(/3 times/);
    const count = await db.query<{ n: string }>(`select count(*)::text as n from public.notifications where user_id = $1 and type = 'order_followup'`, [buyer.id]);
    expect(count[0]!.n).toBe("3");
  });
});
