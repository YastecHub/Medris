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
    // an invitation only: no access until the person accepts, and they are told
    expect((await rpc(memberT, "get_team_shop_orders", { p_vendor_id: shop.id })).status).toBeGreaterThanOrEqual(400);
    expect(((await rpc(memberT, "get_my_team_invites")).json.data as { vendor_id: string }[]).map((i) => i.vendor_id)).toEqual([shop.id]);
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and type = 'team_invite'`, [member.id]))).toHaveLength(1);
    expect((await rpc(strangerT, "respond_team_invite", { p_vendor_id: shop.id, p_accept: true })).status).toBe(400);
    expect((await rpc(memberT, "respond_team_invite", { p_vendor_id: shop.id, p_accept: true })).status).toBe(200);
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and type = 'team_invite_reply'`, [owner.id]))).toHaveLength(1);
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

  it("a team member answers the shop's chat as the shop; the customer is told the shop wrote, and the team hears about customer messages", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id, { name: "Bola Bakes" });
    const member = await seedUser(db, { name: "Tolu Staff" });
    const buyer = await seedUser(db, { name: "Ada" });
    const stranger = await seedUser(db);
    await db.query(`insert into public.vendor_members (vendor_id, user_id, role) values ($1, $2, 'staff')`, [shop.id, member.id]);
    await seedOrder(db, buyer.id, shop.id, { status: "confirmed" });
    const conv = (await db.query<{ id: string }>(`insert into public.conversations (buyer_id, vendor_id) values ($1, $2) returning id`, [buyer.id, shop.id]))[0]!.id;
    await db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Is it ready?')`, [conv, buyer.id]);
    const memberT = await accessToken(member.id);
    const strangerT = await accessToken(stranger.id);

    const chats = (await rpc(memberT, "get_team_shop_chats", { p_vendor_id: shop.id })).json.data as { id: string; buyer_name: string; unread: number }[];
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: conv, buyer_name: "Ada", unread: 1 });
    expect((await rpc(strangerT, "get_team_shop_chats", { p_vendor_id: shop.id })).status).toBeGreaterThanOrEqual(400);

    const thread = (await rpc(memberT, "get_team_chat_messages", { p_conversation_id: conv })).json.data as { body: string; from_customer: boolean }[];
    expect(thread.map((m) => m.body)).toEqual(["Is it ready?"]);
    expect((await rpc(strangerT, "get_team_chat_messages", { p_conversation_id: conv })).status).toBeGreaterThanOrEqual(400);

    expect((await rpc(memberT, "team_send_message", { p_conversation_id: conv, p_body: "Yes, in 10 minutes." })).status).toBe(200);
    expect((await rpc(strangerT, "team_send_message", { p_conversation_id: conv, p_body: "hi" })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(memberT, "team_send_message", { p_conversation_id: conv, p_body: "   " })).status).toBe(400);

    const told = await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 and type = 'new_message'`, [buyer.id]);
    expect(told.map((n) => n.title)).toEqual(["New message from Bola Bakes"]);
    const heard = await db.query<{ user_id: string }>(`select user_id from public.notifications where type = 'new_message' and title like 'New message from Ada%'`);
    expect(heard.map((n) => n.user_id).sort()).toEqual([owner.id, member.id].sort());
  });

  it("a declined invitation removes it, and a pending invitation gives no access or alerts", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id);
    const invited = await seedUser(db);
    const buyer = await seedUser(db);
    const ownerT = await accessToken(owner.id);
    const invitedT = await accessToken(invited.id);
    expect((await rpc(ownerT, "add_shop_team_member", { p_identifier: invited.email, p_role: "manager" })).status).toBe(200);
    const orderId = await seedOrder(db, buyer.id, shop.id, { status: "pending" });
    expect((await rpc(invitedT, "transition_order_status", { p_order_id: orderId, p_new_status: "confirmed" })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(invitedT, "get_my_shop_teams")).json.data).toEqual([]);
    await db.query(`insert into public.notifications (user_id, type, title, body, vendor_id, notification_category) values ($1, 'new_order', 'Pending test', 'b', $2, 'order')`, [owner.id, shop.id]);
    expect(await db.query(`select 1 from public.notifications where user_id = $1 and title = 'Pending test'`, [invited.id])).toHaveLength(0);
    expect((await rpc(invitedT, "respond_team_invite", { p_vendor_id: shop.id, p_accept: false })).status).toBe(200);
    expect((await rpc(ownerT, "list_shop_team")).json.data).toEqual([]);
    expect((await rpc(invitedT, "respond_team_invite", { p_vendor_id: shop.id, p_accept: true })).status).toBe(400);
  });
});
