import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedOrder, seedUser, seedVendor } from "../support/fixtures.js";

/** The shop's team over the app's sb.rpc() calls: add by e-mail/phone, list, work on orders, remove. */
describe("shop team (rpc)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof buildTestApp>;
  beforeAll(async () => {
    db = await createTestDatabase();
    app = buildTestApp(db);
  });
  afterAll(async () => db?.close());

  const rpc = async (token: string, name: string, body: Record<string, unknown> = {}) => {
    const res = await call(app, "POST", `/api/v1/rpc/${name}`, { token, body });
    return { status: res.status, json: (await res.json()) as { data?: unknown; error?: unknown } };
  };

  it("the owner adds a member by e-mail, who then sees and works on the shop's orders; a stranger cannot", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id);
    const member = await seedUser(db, { name: "Tolu" });
    const stranger = await seedUser(db);
    const buyer = await seedUser(db, { name: "Bola" });
    const orderId = await seedOrder(db, buyer.id, shop.id, { status: "pending" });
    const ownerT = await accessToken(owner.id);
    const memberT = await accessToken(member.id);
    const strangerT = await accessToken(stranger.id);

    expect((await rpc(strangerT, "add_shop_team_member", { p_identifier: member.email, p_role: "staff" })).status).toBeGreaterThanOrEqual(400);
    const added = await rpc(ownerT, "add_shop_team_member", { p_identifier: member.email, p_role: "staff" });
    expect(added.status).toBe(200);
    expect(((await rpc(ownerT, "list_shop_team")).json.data as { role: string }[]).map((m) => m.role)).toEqual(["staff"]);
    expect((await rpc(memberT, "get_my_shop_teams")).json.data).toMatchObject([{ vendor_id: shop.id, role: "staff" }]);

    const orders = await rpc(memberT, "get_team_shop_orders", { p_vendor_id: shop.id });
    expect(orders.status).toBe(200);
    const list = orders.json.data as { buyer_name: string | null }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.buyer_name).toBeNull(); // hidden while pending
    expect((await rpc(strangerT, "get_team_shop_orders", { p_vendor_id: shop.id })).status).toBeGreaterThanOrEqual(400);

    const accept = await rpc(memberT, "transition_order_status", { p_order_id: orderId, p_new_status: "confirmed" });
    expect(accept.status).toBe(200);
    const [row] = await db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [orderId]);
    expect(row?.status).toBe("confirmed");
    expect((await rpc(strangerT, "transition_order_status", { p_order_id: orderId, p_new_status: "handed_over" })).status).toBeGreaterThanOrEqual(400);

    expect((await rpc(ownerT, "remove_shop_team_member", { p_user_id: member.id })).json.data).toEqual({ removed: 1 });
    expect((await rpc(memberT, "get_team_shop_orders", { p_vendor_id: shop.id })).status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an unknown account, yourself and a bad role", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    await seedVendor(db, owner.id);
    const t = await accessToken(owner.id);
    expect((await rpc(t, "add_shop_team_member", { p_identifier: "nobody@nowhere.dev", p_role: "staff" })).status).toBe(400);
    expect((await rpc(t, "add_shop_team_member", { p_identifier: owner.email, p_role: "staff" })).status).toBe(400);
    expect((await rpc(t, "add_shop_team_member", { p_identifier: owner.email, p_role: "boss" })).status).toBe(400);
  });
});
