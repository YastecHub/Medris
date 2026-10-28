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
    // the same person counts up to 3 times a week
    await comment(w.buyer.id, "⭐⭐⭐");
    await comment(w.buyer.id, "🔥🔥🔥");
    await comment(w.buyer.id, "Fourth one does not count");
    expect(await pointsFor(w.vendor.id)).toBe(20);
  });

  it("at most 10 comments a day count", async () => {
    const before = await pointsFor(w.vendor.id);
    for (let i = 0; i < 12; i++) {
      const u = (await seedUser(w.db, {})).id;
      await comment(u, `A thoughtful comment number ${i} on this product`);
    }
    const after = await pointsFor(w.vendor.id);
    expect(after).toBeLessThanOrEqual(50);
    expect(after).toBeGreaterThan(before);
  });
});
