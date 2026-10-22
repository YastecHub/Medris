import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Identity } from "../../src/database/context.js";
import { LiveService, type LiveClientMessage } from "../../src/modules/live/live.service.js";
import { identityOf, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

/** A slow change on one table (many apps re-reading a product) must not hold up chat messages on another table. */
describe("live updates: a busy table does not delay messages", () => {
  let db: TestDatabase;
  let live: LiveService;
  let stop: () => Promise<void>;
  let buyer: string;
  let owner: string;
  let shop: string;
  let product: string;
  let conv: string;
  let release: () => void = () => {};
  let holdNext = false;

  beforeAll(async () => {
    db = await createTestDatabase();
    buyer = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop, { name: "Phone" });
    conv = (await db.query<{ id: string }>(`insert into public.conversations (buyer_id, vendor_id) values ($1, $2) returning id`, [buyer, shop]))[0]!.id;
    const tokens = new Map<string, Identity>([[`t-${buyer}`, identityOf(buyer)]]);
    // the first read after holdNext is set waits until release() is called
    const slow = new Proxy(db.data, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "asCaller") return typeof value === "function" ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          if (holdNext) {
            holdNext = false;
            await new Promise<void>((r) => (release = r));
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    live = new LiveService(() => slow, async (token) => tokens.get(token) ?? null);
    stop = await live.start(db.changes);
  }, 60_000);
  afterAll(async () => {
    release();
    await stop();
    await db.close();
  });

  it("delivers a message while a product change is still being read", async () => {
    const inbox: Record<string, unknown>[] = [];
    const conn = live.connect((m) => inbox.push(m as Record<string, unknown>));
    const send = (m: LiveClientMessage) => conn.handle(JSON.stringify(m));
    await send({ type: "auth", token: `t-${buyer}` });
    await send({ type: "subscribe", id: "p", changes: [{ event: "*", table: "products" }] });
    await send({ type: "subscribe", id: "m", changes: [{ event: "*", table: "messages", filter: `conversation_id=eq.${conv}` }] });

    holdNext = true;
    await db.query(`update public.products set name = 'Phone 2' where id = $1`, [product]);
    await new Promise((r) => setTimeout(r, 300));
    await db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hello')`, [conv, owner]);
    await new Promise((r) => setTimeout(r, 500));

    const changes = inbox.filter((m) => m.type === "change");
    expect(changes.map((m) => m.table)).toContain("messages");
    expect(changes.map((m) => m.table)).not.toContain("products");
    release();
    await live.idle();
    expect(inbox.filter((m) => m.type === "change").map((m) => m.table)).toContain("products");
    conn.close();
  });
});
