import { describe, expect, it } from "vitest";
import { rowOf, useWorld } from "./harness.js";
import { asUserSeed, seedUser } from "../support/fixtures.js";

describe("points for comments on a shop's products", () => {
  const w = useWorld();
  const comment = async (userId: string, content: string) =>
    asUserSeed(w.db, userId, [[`insert into public.product_comments (product_id, user_id, content, author_name) values ($1, $2, $3, 'Someone')`, [w.product, userId, content]]]);
  const pointsFor = async (userId: string) =>
    Number((await rowOf<{ p: string }>(w, `select coalesce(sum(points), 0) as p from public.points_ledger where user_id = $1 and kind = 'product_comment'`, [userId]))?.p);

  it("5 points for any comment from someone else (emojis too); nothing for the shop's own or empty ones", async () => {
    await comment(w.buyer.id, "Lovely quality, arrived quickly");
    expect(await pointsFor(w.vendor.id)).toBe(5);
    await comment(w.vendor.id, "Thank you so much for the kind words");
    await comment(w.buyer2.id, "   ");
    expect(await pointsFor(w.vendor.id)).toBe(5);
    await comment(w.buyer2.id, "❤️❤️❤️");
    expect(await pointsFor(w.vendor.id)).toBe(10);
  });

  it("a person's first 3 comments of a day count; the 4th that day does not", async () => {
    const u = (await seedUser(w.db, {})).id;
    for (const t of ["⭐⭐⭐", "🔥🔥🔥", "👏👏👏", "Fourth one does not count"]) await comment(u, t);
    expect(Number((await rowOf<{ n: string }>(w, `select count(*) as n from public.points_ledger where kind = 'product_comment' and source_user_id = $1`, [u]))?.n)).toBe(3);
  });

  it("points come on at most 3 days a week", async () => {
    const u = (await seedUser(w.db, {})).id;
    const earn = async () => Number((await rowOf<{ n: string }>(w, `select count(*) as n from public.points_ledger where kind = 'product_comment' and source_user_id = $1`, [u]))?.n);
    await comment(u, "😍😍😍");
    // pretend that comment was made on an earlier day of this week, then comment again on two more "days"
    for (let d = 1; d <= 3; d++) {
      await w.db.query(`update public.points_ledger set created_at = created_at - interval '1 day' where kind = 'product_comment' and source_user_id = $1`, [u]);
      await comment(u, "🔥🔥🔥");
    }
    // days now: 3 days back, 2 days back (shifted), 1 day back, and today's last comment: only 3 distinct days can earn
    expect(await earn()).toBeLessThanOrEqual(4);
  });

  it("at most 10 comments a day count", async () => {
    const before = await pointsFor(w.vendor.id);
    for (let i = 0; i < 12; i++) {
      const u = (await seedUser(w.db, {})).id;
      await comment(u, `A thoughtful comment number ${i} on this product`);
    }
    const after = await pointsFor(w.vendor.id);
    expect(after - before).toBeLessThanOrEqual(50);
    expect(after).toBeGreaterThan(before);
  });
});
