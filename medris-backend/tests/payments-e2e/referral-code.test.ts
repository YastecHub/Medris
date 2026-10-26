import { describe, expect, it } from "vitest";
import { api, json, rowOf, useWorld } from "./harness.js";

describe("changing the referral code", () => {
  const w = useWorld();
  const set = async (token: string, code: string) => json(await api.post(w, "/rpc/set_my_referral_code", token, { p_code: code }));
  const mine = async () => (await rowOf<{ c: string }>(w, `select referral_code as c from public.vendors where user_id = $1`, [w.vendor.id]))?.c;
  it("a shop picks its own code (capitals ignored), and the new one is what is saved and found", async () => {
    const r = await set(w.vendor.token, "my Shop-1");
    expect(r.status).toBe(200);
    expect((r.body as { data?: { referral_code?: string } }).data?.referral_code ?? (r.body as { referral_code?: string }).referral_code).toBe("MYSHOP1");
    expect(await mine()).toBe("MYSHOP1");
    const check = await json(await api.post(w, "/rpc/validate_referral_code", w.buyer.token, { p_code: "myshop1" }));
    expect(JSON.stringify(check.body)).toContain("true");
    expect(JSON.stringify((await set(w.vendor.token, "ab")).body)).toContain("bad_length");
    expect(JSON.stringify((await set(w.buyer.token, "BUYERCODE")).body)).toContain("not_a_shop");
  });
});
