import { describe, expect, it } from "vitest";
import { api, json, rowOf, useWorld } from "./harness.js";

describe("suspending products", () => {
  const w = useWorld();
  const call = async (token: string, body: Record<string, unknown>) => json(await api.post(w, "/rpc/admin_set_product_suspended", token, body));
  it("an admin suspends and restores a product; the shop is told why; nobody else can", async () => {
    expect((await call(w.vendor.token, { p_product_id: w.product, p_suspended: true, p_reason: "Not allowed" })).status).toBe(403);
    expect((await call(w.admin.token, { p_product_id: w.product, p_suspended: true, p_reason: " " })).status).toBe(400);
    expect((await call(w.admin.token, { p_product_id: w.product, p_suspended: true, p_reason: "Prohibited item" })).status).toBe(200);
    expect((await rowOf<{ s: string }>(w, `select status::text as s from public.products where id = $1`, [w.product]))?.s).toBe("suspended");
    expect((await call(w.admin.token, { p_product_id: w.product, p_suspended: true, p_reason: "again" })).status).toBe(409);
    const told = await rowOf<{ body: string }>(w, `select body from public.notifications where user_id = $1 and type = 'product_suspended'`, [w.vendor.id]);
    expect(told?.body).toContain("Prohibited item");
    expect((await call(w.admin.token, { p_product_id: w.product, p_suspended: false })).status).toBe(200);
    expect((await rowOf<{ s: string }>(w, `select status::text as s from public.products where id = $1`, [w.product]))?.s).toBe("active");
  });
});
