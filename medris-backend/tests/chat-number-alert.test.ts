import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedUser, seedVendor, setRole } from "./support/fixtures.js";

/** Migration 0067: admins are alerted when a chat message holds a phone or account number, however it is written. */
describe("admins are told about numbers in chat (migration 0067)", () => {
  let db: TestDatabase; let admin: string, buyer: string, conv: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    admin = (await seedUser(db)).id; await setRole(db, admin, "admin");
    const owner = (await seedUser(db, { role: "vendor" })).id; buyer = (await seedUser(db)).id;
    const shop = (await seedVendor(db, owner)).id;
    conv = (await db.query<{ id: string }>(`insert into public.conversations (buyer_id, vendor_id) values ($1, $2) returning id`, [buyer, shop]))[0]!.id;
  });
  afterAll(async () => db.close());
  const count = async () => Number((await db.query<{ n: string }>(`select count(*)::text as n from public.notifications where user_id = $1 and type = 'sensitive_number'`, [admin]))[0]!.n);
  const send = async (body: string) => { await db.query(`delete from public.notifications where user_id = $1 and type = 'sensitive_number'`, [admin]); await db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)`, [conv, buyer, body]); return count(); };

  it.each(["call me 08031234567", "0803 123 4567", "0803-123-4567", "+234 803 123 4567", "acct 0123456789 gtb", "my number is 8 0 3 1 2 3 4 5 6 7", "803.123.4567"])("alerts for: %s", async (t) => {
    expect(await send(t)).toBe(1);
  });
  it.each(["I will pay 50,000 tomorrow", "order 12345", "see you at 4pm on 12/11/2026", "hello"])("stays quiet for: %s", async (t) => {
    expect(await send(t)).toBe(0);
  });
});
