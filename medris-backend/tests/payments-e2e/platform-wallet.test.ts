/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, json, newOrder, payOrder, rowOf, sendWebhook, useWorld, handOver } from "./harness.js";

const GOOD = "right-password-123";

// Migration 0035: Levromart's own wallet - the commission as it is collected, withdrawn with the super admin's password.
describe("Levromart's commission wallet", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));
  let auth: http.Server;
  const saved: Record<string, string | undefined> = {};

  // a pretend Supabase Auth: only GOOD signs the admin in
  beforeAll(async () => {
    auth = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        if (body.password === GOOD) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "x", user: { id: (globalThis as any).__adminId } }));
        } else {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_grant" }));
        }
      });
    });
    await new Promise<void>((r) => auth.listen(0, "127.0.0.1", () => r()));
    for (const [k, v] of Object.entries({ SUPABASE_URL: `http://127.0.0.1:${(auth.address() as AddressInfo).port}`, SUPABASE_ANON_KEY: "anon-test" })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise((r) => auth.close(r));
  });

  const superAdmin = async () => {
    (globalThis as any).__adminId = w.admin.id;
    await w.db.query(`update public.users set is_super_admin = true, email = coalesce(email, 'admin@test.levromart') where id = $1`, [w.admin.id]);
  };

  it("collects the 3% as orders paid through Levromart complete, and shows it to admins only", async () => {
    await superAdmin();
    await w.db.query(`delete from public.platform_wallet_entries`);
    const order = await newOrder(w, 10000, "confirmed");
    await payOrder(w, order);
    await handOver(w, order);
    const done = await json(await api.post(w, `/orders/${order}/received`, w.buyer.token));
    expect(done.status).toBe(200);
    const s = await call("get_levromart_wallet", w.admin.token);
    expect(s.status).toBe(200);
    expect(s.data.balance_kobo).toBe("30000"); // 3% of ₦10,000
    expect(s.data.commission.today_kobo).toBe("30000");
    expect(s.data.entries[0].kind).toBe("commission");
    expect(s.data.can_manage).toBe(true);
    expect((await call("get_levromart_wallet", w.buyer.token)).status).toBe(403);
  });

  it("needs the super admin's right password; the bank account waits 24 hours; then the commission is sent once", async () => {
    await superAdmin();
    for (const t of ["platform_wallet_entries", "platform_withdrawals", "platform_payout_account"]) await w.db.query(`delete from public.${t}`);
    await w.db.query(`insert into public.platform_wallet_entries (kind, amount_kobo, note) values ('commission', 500000, 'seed')`);

    const noPw = await call("set_levromart_payout_account", w.admin.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Ada Obi" });
    expect(noPw.status).toBe(400);
    const wrong = await call("set_levromart_payout_account", w.admin.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Ada Obi", p_password: "nope" });
    expect(wrong.status).toBe(403);
    const set = await call("set_levromart_payout_account", w.admin.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Ada Obi", p_password: GOOD });
    expect(set.status).toBe(200);
    expect(set.data.wait_hours).toBe(24);

    // a fresh bank account: nothing goes out for 24 hours
    const tooSoon = await call("withdraw_levromart_commission", w.admin.token, { p_amount_kobo: 100000, p_password: GOOD });
    expect(tooSoon.status).toBe(400);
    await w.db.query(`update public.platform_payout_account set changed_at = now() - interval '25 hours'`);

    expect((await call("withdraw_levromart_commission", w.admin.token, { p_amount_kobo: 100000, p_password: "nope" })).status).toBe(403);
    expect((await call("withdraw_levromart_commission", w.admin.token, { p_amount_kobo: 900000, p_password: GOOD })).status).toBe(400); // more than there is

    const sent = await call("withdraw_levromart_commission", w.admin.token, { p_amount_kobo: 200000, p_password: GOOD });
    expect(sent.status).toBe(200);
    const wd = await rowOf<any>(w, `select transfer_reference, status from public.platform_withdrawals order by created_at desc limit 1`);
    expect(wd.transfer_reference).toMatch(/^lvm_pw_/);
    expect((await call("get_levromart_wallet", w.admin.token)).data.balance_kobo).toBe("300000");

    // the bank transfer fails: the money comes back, once
    await sendWebhook(w, "transfer.failed", { reference: wd.transfer_reference, reason: "Account closed" });
    await sendWebhook(w, "transfer.failed", { reference: wd.transfer_reference, reason: "Account closed" }, { id: 777001 });
    expect((await call("get_levromart_wallet", w.admin.token)).data.balance_kobo).toBe("500000");
  });

  it("a paid monthly listing fee is Levromart's money too, counted once and apart from the commission (migration 0036)", async () => {
    await superAdmin();
    await w.db.query(`delete from public.platform_wallet_entries`);
    const ref = `levro_listing_test_${Date.now()}`;
    await w.db.query(`insert into public.paystack_transactions (reference, purpose, vendor_id, payer_user_id, amount_kobo) values ($1, 'listing_fee', $2, $3, 99900)`, [ref, w.vendor.shop, w.vendor.id]);
    expect((await rowOf<any>(w, `select count(*)::int as n from public.platform_wallet_entries`)).n).toBe(0); // not paid yet
    await w.db.query(`update public.paystack_transactions set status = 'success', paid_at = now() where reference = $1`, [ref]);
    await w.db.query(`update public.paystack_transactions set status = 'success' where reference = $1`, [ref]); // a repeated webhook
    const s = await call("get_levromart_wallet", w.admin.token);
    expect(s.status).toBe(200);
    expect(s.data.listing_fees.all_kobo).toBe("98401"); // ₦999 less Paystack's 1.5% (₦14.99, rounded up)
    expect(s.data.commission.all_kobo).toBe("0");
    expect(s.data.balance_kobo).toBe("98401");
    expect(s.data.entries[0].kind).toBe("listing_fee");
  });

  it("an admin who is not the super admin can look but cannot move the money", async () => {
    await w.db.query(`update public.users set is_super_admin = false where id = $1`, [w.admin.id]);
    const s = await call("get_levromart_wallet", w.admin.token);
    expect(s.status).toBe(200);
    expect(s.data.can_manage).toBe(false);
    expect((await call("withdraw_levromart_commission", w.admin.token, { p_amount_kobo: 100000, p_password: GOOD })).status).toBe(403);
    await superAdmin();
  });

  it("a shop deleting its account does not take Levromart's collected commission back", async () => {
    await w.db.query(`delete from public.platform_wallet_entries`);
    const c = await rowOf<any>(w, `select id from public.commission_charges where status = 'paid' and payment_id is not null limit 1`);
    expect(c).toBeTruthy();
    await w.db.query(`insert into public.platform_wallet_entries (kind, amount_kobo, note) values ('commission', 30000, 'seed')`);
    await w.db.query(`select set_config('levromart.account_deletion', 'on', false)`);
    await w.db.query(`delete from public.commission_charges where id = $1`, [c.id]);
    await w.db.query(`select set_config('levromart.account_deletion', '', false)`);
    expect((await rowOf<any>(w, `select coalesce(sum(amount_kobo),0)::text as k from public.platform_wallet_entries`)).k).toBe("30000");
  });
});
