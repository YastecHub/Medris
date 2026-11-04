/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, json, rowOf, TEST_PIN, useWorld } from "./harness.js";

// Migration 0037: the wallet PIN. Six digits, only a hash is kept, five wrong tries lock it, changing it needs the password.
describe("the wallet PIN", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));
  let auth: http.Server;
  const saved: Record<string, string | undefined> = {};
  const GOOD = "right-password-123";

  // a pretend Supabase Auth, as in the platform wallet test: only GOOD signs the person in
  beforeAll(async () => {
    auth = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        if (body.password === GOOD) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "x", user: { id: (globalThis as any).__pinUser } }));
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

  it("money cannot move without a PIN; a PIN is six digits, not guessable, and confirmed twice", async () => {
    await w.db.query(`delete from public.wallet_pins where user_id = $1`, [w.buyer2.id]);
    expect((await call("get_wallet_pin_status", w.buyer2.token)).data).toMatchObject({ has_pin: false, digits: 6 });
    const noPin = await call("wallet_send", w.buyer2.token, { p_to: "someone", p_amount_kobo: 10000 });
    expect(noPin.status).toBe(400);
    expect(JSON.stringify(noPin.body)).toMatch(/PIN/);
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: "12345", p_pin_confirm: "12345" })).status).toBe(400); // five digits
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: "123456", p_pin_confirm: "123456" })).status).toBe(400); // a run
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: "111111", p_pin_confirm: "111111" })).status).toBe(400); // one digit
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: TEST_PIN, p_pin_confirm: "000999" })).status).toBe(400); // not the same twice
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: TEST_PIN, p_pin_confirm: TEST_PIN })).status).toBe(200);
    expect((await call("set_wallet_pin", w.buyer2.token, { p_pin: "739201", p_pin_confirm: "739201" })).status).toBe(400); // already has one
    expect((await rowOf<any>(w, `select pin_hash from public.wallet_pins where user_id = $1`, [w.buyer2.id])).pin_hash).toMatch(/^scrypt\$/); // only a hash is kept
    expect((await call("get_wallet_pin_status", w.buyer2.token)).data.has_pin).toBe(true);
  });

  it("a wrong PIN is refused and counted; five wrong tries lock it for a while; the right one clears the count", async () => {
    await w.db.query(`update public.wallet_pins set failed_attempts = 0, locked_until = null where user_id = $1`, [w.buyer2.id]);
    const wrong = await call("wallet_send", w.buyer2.token, { p_to: "someone", p_amount_kobo: 10000, p_pin: "000001" });
    expect(wrong.status).toBe(403);
    expect(JSON.stringify(wrong.body)).toMatch(/4 tries left/);
    expect((await rowOf<any>(w, `select failed_attempts as n from public.wallet_pins where user_id = $1`, [w.buyer2.id])).n).toBe(1); // counted although the call failed
    for (let i = 0; i < 4; i++) await call("wallet_send", w.buyer2.token, { p_to: "someone", p_amount_kobo: 10000, p_pin: "000001" });
    const locked = await call("wallet_send", w.buyer2.token, { p_to: "someone", p_amount_kobo: 10000, p_pin: TEST_PIN }); // even the right PIN waits
    expect(locked.status).toBe(403);
    expect(JSON.stringify(locked.body)).toMatch(/Too many wrong PINs/);
    expect((await call("get_wallet_pin_status", w.buyer2.token)).data.locked_minutes).toBeGreaterThan(0);
    await w.db.query(`update public.wallet_pins set locked_until = null where user_id = $1`, [w.buyer2.id]);
    const ok = await call("wallet_send", w.buyer2.token, { p_to: "nobody_here_x", p_amount_kobo: 10000, p_pin: TEST_PIN });
    expect(ok.status).toBe(404); // the PIN passed; the @tag does not exist
    expect((await rowOf<any>(w, `select failed_attempts as n from public.wallet_pins where user_id = $1`, [w.buyer2.id])).n).toBe(0);
  });

  it("changing the PIN needs the account password", async () => {
    (globalThis as any).__pinUser = w.buyer2.id;
    await w.db.query(`update public.users set email = coalesce(email, 'pin@test.levromart') where id = $1`, [w.buyer2.id]);
    expect((await call("change_wallet_pin", w.buyer2.token, { p_pin: "739201", p_pin_confirm: "739201" })).status).toBe(400); // no password
    expect((await call("change_wallet_pin", w.buyer2.token, { p_password: "nope", p_pin: "739201", p_pin_confirm: "739201" })).status).toBe(403);
    expect((await call("change_wallet_pin", w.buyer2.token, { p_password: GOOD, p_pin: "739201", p_pin_confirm: "739201" })).status).toBe(200);
    expect((await call("wallet_send", w.buyer2.token, { p_to: "nobody_here_x", p_amount_kobo: 10000, p_pin: TEST_PIN })).status).toBe(403); // the old one is gone
    expect((await call("wallet_send", w.buyer2.token, { p_to: "nobody_here_x", p_amount_kobo: 10000, p_pin: "739201" })).status).toBe(404);
    await w.db.query(`delete from public.wallet_pins where user_id = $1`, [w.buyer2.id]);
  });

  it("the fee quote is Paystack's fee on the amount", async () => {
    const q = (n: number) => call("wallet_fee_quote", w.buyer.token, { p_amount_kobo: n });
    expect((await q(10000)).data).toMatchObject({ fee_kobo: "150", total_kobo: "10150" }); // ₦100 -> ₦101.50
    expect((await q(250000)).data.fee_kobo).toBe("13750"); // ₦2,500: 1.5% + ₦100
    expect((await q(100000000)).data.fee_kobo).toBe("200000"); // capped at ₦2,000
    expect((await q(0)).status).toBe(400);
  });
});
