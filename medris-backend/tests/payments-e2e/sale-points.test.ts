import { describe, expect, it } from "vitest";
import { newOrder, rowOf, useWorld } from "./harness.js";

describe("points for a completed sale", () => {
  const w = useWorld();
  it("20 under 1,000, 50 from 1,000 to 5,000, 100 above 5,000", async () => {
    const out: number[] = [];
    for (const naira of [500, 1000, 5000, 5001]) {
      const o = await newOrder(w, naira, "completed");
      await rowOf(w, `select public.points_award_order($1::uuid, false) as r`, [o]);
      const got = await rowOf<{ p: number }>(w, `select points as p from public.points_ledger where event_key = $1`, [`order:${o}`]);
      out.push(Number(got?.p));
    }
    expect(out).toEqual([20, 50, 50, 100]);
  });
});
