import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf } from "../../src/database/client.js";
import { CartRepository } from "../../src/database/repositories/cart.repository.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { seedProduct, seedUser, seedVendor } from "../support/fixtures.js";

/**
 * The property everything else rests on: queries run through DataContext see
 * exactly what Supabase's REST API let the same user see, because auth.uid()
 * and the database role are set the same way.
 */
describe("DataContext (RLS-preserving identity context)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db?.close());

  const identity = (userId: string) => ({ userId, email: null, claims: { sub: userId, role: "authenticated" }, source: "supabase-jwt" as const });

  it("sets auth.uid(), auth.role() and the database role per transaction", async () => {
    const user = await seedUser(db);
    const row = await db.data.asUser(identity(user.id), async (tx) =>
      rowsOf<{ uid: string; role: string; current_user: string }>(await tx.execute(sql`select auth.uid()::text as uid, auth.role() as role, current_user::text as current_user`))[0],
    );
    expect(row).toEqual({ uid: user.id, role: "authenticated", current_user: "authenticated" });

    const anon = await db.data.asAnon(async (tx) => rowsOf<{ uid: string | null; u: string }>(await tx.execute(sql`select auth.uid() as uid, current_user::text as u`))[0]);
    expect(anon).toEqual({ uid: null, u: "anon" });

    const service = await db.data.asService(async (tx) => rowsOf<{ u: string }>(await tx.execute(sql`select current_user::text as u`))[0]);
    expect(service?.u).toBe("service_role");
  });

  it("does not leak the identity to the next transaction on the same connection", async () => {
    const user = await seedUser(db);
    await db.data.asUser(identity(user.id), async () => undefined);
    const after = rowsOf<{ uid: string | null; claims: string | null }>(
      await db.db.execute(sql`select auth.uid() as uid, nullif(current_setting('request.jwt.claims', true), '') as claims`),
    )[0];
    expect(after).toEqual({ uid: null, claims: null });
  });

  it("row level security isolates users even when a query forgets its own filter", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const vendor = await seedVendor(db, owner.id);
    const product = await seedProduct(db, vendor.id);
    const alice = await seedUser(db);
    const bob = await seedUser(db);
    await db.query(`insert into public.cart_items (buyer_id, product_id, quantity) values ($1, $2, 1), ($3, $2, 2)`, [alice.id, product, bob.id]);

    // Bob asks for Alice's cart: the repository filters by the id it is given,
    // but the cart_items_owner policy still only shows Bob's own rows.
    const seenByBob = await db.data.asUser(identity(bob.id), (tx) => new CartRepository(tx).listForBuyer(alice.id));
    expect(seenByBob).toEqual([]);
    const seenByAlice = await db.data.asUser(identity(alice.id), (tx) => new CartRepository(tx).listForBuyer(alice.id));
    expect(seenByAlice).toHaveLength(1);

    // The service role bypasses RLS (used only after the caller is authorised in code).
    const all = await db.data.asService(async (tx) => rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from public.cart_items`))[0]);
    expect(all?.n).toBeGreaterThanOrEqual(2);
  });

  it("rolls back everything in a failed request", async () => {
    const user = await seedUser(db);
    await expect(
      db.data.asService(async (tx) => {
        await tx.execute(sql`update public.users set city = 'Abuja' where id = ${user.id}`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const [row] = await db.query<{ city: string | null }>(`select city from public.users where id = $1`, [user.id]);
    expect(row?.city).toBeNull();
  });

  it("probe() reports the API roles as usable", async () => {
    const probe = await db.data.probe();
    expect(probe.roles).toEqual({ anon: true, authenticated: true, service_role: true });
  });
});
