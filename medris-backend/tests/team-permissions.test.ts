import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedOrder, seedUser, seedVendor } from "./support/fixtures.js";

/** can_act_for_vendor(): the owner may do everything; a manager orders/chat/listings; staff orders/chat; strangers nothing. */
describe("shop team permissions (migration 0057/0059)", () => {
  let db: TestDatabase;
  let vendorId: string;
  let owner: string, manager: string, staff: string, stranger: string;

  async function canAct(userId: string, permission: string): Promise<boolean> {
    const { client, release } = await db.sqlClient();
    try {
      await client.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)`, [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      const r = await client.query<{ ok: boolean }>(`select public.can_act_for_vendor($1, $2) as ok`, [vendorId, permission]);
      return r.rows[0]!.ok;
    } finally {
      await client.query(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`);
      release();
    }
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    owner = (await seedUser(db)).id;
    manager = (await seedUser(db)).id;
    staff = (await seedUser(db)).id;
    stranger = (await seedUser(db)).id;
    vendorId = (await seedVendor(db, owner)).id;
    await db.query(`insert into public.vendor_members (vendor_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'staff')`, [vendorId, manager, staff]);
  });
  afterAll(async () => db.close());

  it("the owner may do everything", async () => {
    for (const p of ["orders", "chat", "listings"]) expect(await canAct(owner, p)).toBe(true);
  });
  it("a manager may handle orders, chat and listings but not money", async () => {
    for (const p of ["orders", "chat", "listings"]) expect(await canAct(manager, p)).toBe(true);
    for (const p of ["wallet", "billing", "settings"]) expect(await canAct(manager, p)).toBe(false);
  });
  it("staff may handle orders and chat only", async () => {
    expect(await canAct(staff, "orders")).toBe(true);
    expect(await canAct(staff, "chat")).toBe(true);
    expect(await canAct(staff, "listings")).toBe(false);
    expect(await canAct(staff, "wallet")).toBe(false);
  });
  it("someone who is not on the team may do nothing", async () => {
    for (const p of ["orders", "chat", "listings"]) expect(await canAct(stranger, p)).toBe(false);
  });

  it("a shop's order notification is copied to its team, and only once per member", async () => {
    const buyer = (await seedUser(db)).id;
    const orderId = await seedOrder(db, buyer, vendorId);
    await db.query(
      `insert into public.notifications (user_id, type, title, body, target_view, target_params, vendor_id, notification_category)
       values ($1, 'new_order', 'New order received', 'x', 'orderDetail', $2::jsonb, $3, 'order')`,
      [owner, JSON.stringify({ orderId }), vendorId],
    );
    const rows = await db.query<{ user_id: string }>(`select user_id from public.notifications where type = 'new_order' and target_params->>'orderId' = $1`, [orderId]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([owner, manager, staff].sort());
  });
  it("a notification for a stranger is not copied to the team", async () => {
    await db.query(`insert into public.notifications (user_id, type, title, body, vendor_id, notification_category) values ($1, 'new_order', 't', 'b', $2, 'order')`, [stranger, vendorId]);
    const rows = await db.query<{ user_id: string }>(`select user_id from public.notifications where user_id in ($1, $2) and title = 't'`, [manager, staff]);
    expect(rows).toHaveLength(0);
  });
});

/** Migration 0065: a missing or broken team table must never stop an order alert or a chat message. */
describe("team features never block orders or chat (migration 0065)", () => {
  it("still notifies and still takes a message when the team table is gone", async () => {
    const db = await createTestDatabase();
    try {
      const owner = (await seedUser(db)).id;
      const buyer = (await seedUser(db)).id;
      const vendorId = (await seedVendor(db, owner)).id;
      await db.query(`drop table public.vendor_members cascade`);
      await db.query(
        `insert into public.notifications (user_id, type, title, body, vendor_id, notification_category) values ($1, 'new_order', 'New order', 'b', $2, 'order')`,
        [owner, vendorId],
      );
      expect(await db.query(`select 1 from public.notifications where user_id = $1 and type = 'new_order'`, [owner])).toHaveLength(1);
      const conv = (await db.query<{ id: string }>(`insert into public.conversations (buyer_id, vendor_id) values ($1, $2) returning id`, [buyer, vendorId]))[0]!.id;
      await db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hello')`, [conv, buyer]);
      expect(await db.query(`select 1 from public.notifications where user_id = $1 and type = 'new_message'`, [owner])).toHaveLength(1);
      const { rows } = await (await db.sqlClient()).client.query<{ ok: boolean }>(`select public.team_can($1::uuid, $2::uuid, 'orders') as ok`, [buyer, vendorId]);
      expect(rows[0]!.ok).toBe(false);
    } finally {
      await db.close();
    }
  });
});
