import { describe, expect, it } from "vitest";
import { api, json, rowOf, useWorld } from "./harness.js";

// Migration 0016: a shop can answer a suggestion (once), the sender is told, an anonymous sender stays anonymous.
describe("replying to suggestions", () => {
  const w = useWorld();
  const add = async (anonymous: boolean) =>
    (await rowOf<{ id: string }>(w, `insert into public.suggestions (sender_id, target_type, target_vendor_id, message, is_anonymous) values ($1, 'vendor', $2, 'Please open on Sundays', $3) returning id`, [w.buyer.id, w.vendor.shop, anonymous]))!.id;

  it("the shop is told when a suggestion arrives", async () => {
    await add(true);
    const n = await rowOf<{ body: string; target_view: string }>(w, `select body, target_view from public.notifications where user_id = $1 and type = 'suggestion_received' order by created_at desc limit 1`, [w.vendor.id]);
    expect(n).toMatchObject({ target_view: "vendorSuggestionsInbox" });
    expect(n!.body).toContain("Sundays");
  });

  it("only the shop it was sent to can reply, once; the (anonymous) sender gets the reply", async () => {
    const id = await add(true);
    expect((await json(await api.post(w, `/suggestions/${id}/reply`, w.buyer2.token, { message: "hi" }))).status).toBe(403);
    expect((await json(await api.post(w, `/suggestions/${id}/reply`, w.vendor.token, { message: "   " }))).status).toBe(400);
    expect((await json(await api.post(w, `/suggestions/${id}/reply`, w.vendor.token, { message: "Good idea, we will open on Sundays." }))).status).toBe(200);
    expect((await json(await api.post(w, `/suggestions/${id}/reply`, w.vendor.token, { message: "again" }))).status).toBe(400);
    const row = await rowOf(w, `select status, reply_message from public.suggestions where id = $1`, [id]);
    expect(row).toMatchObject({ status: "read", reply_message: "Good idea, we will open on Sundays." });
    const told = await rowOf<{ body: string }>(w, `select body from public.notifications where user_id = $1 and type = 'suggestion_reply' order by created_at desc limit 1`, [w.buyer.id]);
    expect(told!.body).toContain("Good idea");
    // the shop's list still hides who wrote it
    const list = await json(await api.get(w, `/suggestions/my-shop`, w.vendor.token));
    const mine = (list.data as { id: string; sender_name: string | null; reply_message: string | null }[]).find((x) => x.id === id);
    expect(mine).toMatchObject({ sender_name: null, reply_message: "Good idea, we will open on Sundays." });
  });

  it("an admin can reply to a suggestion sent to Levromart; a shop cannot", async () => {
    const sid = (await rowOf<{ id: string }>(w, `insert into public.suggestions (sender_id, target_type, message) values ($1, 'platform', 'Dark mode please') returning id`, [w.buyer.id]))!.id;
    expect((await json(await api.post(w, `/suggestions/${sid}/reply`, w.vendor.token, { message: "no" }))).status).toBe(403);
    expect((await json(await api.post(w, `/suggestions/${sid}/reply`, w.admin.token, { message: "On the way." }))).status).toBe(200);
  });
});
