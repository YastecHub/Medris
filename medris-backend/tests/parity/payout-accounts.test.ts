import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutAccountsService, sameAccountName } from "../../src/modules/payout-accounts/payout-accounts.service.js";
import { identityOf, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

const KEY = "sk_test_payout_secret";
const ACCOUNT = "0123456789";

describe("vendor payout accounts (issue #97)", () => {
  let db: TestDatabase;
  let service: PayoutAccountsService;
  let admin: string;
  let buyer: string;
  let ownerA: string;
  let ownerB: string;
  let shopA: string;
  let shopB: string;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  const calls: string[] = [];
  let resolveAnswer: () => Response | Promise<Response> = () => new Response("{}", { status: 404 });

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = KEY;
    db = await createTestDatabase();
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    buyer = (await seedUser(db)).id;
    ownerA = (await seedUser(db, { role: "vendor" })).id;
    ownerB = (await seedUser(db, { role: "vendor" })).id;
    shopA = (await seedVendor(db, ownerA, { name: "Shop A" })).id;
    shopB = (await seedVendor(db, ownerB, { name: "Shop B" })).id;
  }, 60_000);
  beforeEach(() => {
    service = new PayoutAccountsService(() => db.data);
    calls.length = 0;
    resolveAnswer = () => ok({ account_name: "ADA OBI", account_number: ACCOUNT });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        calls.push(u);
        if (u.includes("/bank?")) return ok([{ name: "Zenith Bank", code: "057" }, { name: "Access Bank", code: "044" }]);
        if (u.includes("/bank/resolve")) return resolveAnswer();
        if (u.endsWith("/transferrecipient")) return ok({ recipient_code: "RCP_test123" });
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = savedKey;
    await db.close();
  });

  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });
  const me = (id: string) => identityOf(id);
  const row = async (id: string) =>
    (await db.query<Record<string, string | null>>(`select bank_code, bank_name, account_name, account_number, transfer_recipient_code, payout_account_last4, payout_verified_at::text from public.vendors where id = $1`, [id]))[0]!;

  it("the bank list is sorted and kept: a second call does not ask Paystack again", async () => {
    const first = await service.listBanks();
    const second = await service.listBanks();
    expect(first.map((b) => b.name)).toEqual(["Access Bank", "Zenith Bank"]);
    expect(second).toEqual(first);
    expect(calls.filter((c) => c.includes("/bank?"))).toHaveLength(1);
  });

  it("resolve: the name on the account; an unknown account; a bank that is not in the list; Paystack not answering", async () => {
    expect(await service.resolve({ bankCode: "057", accountNumber: ACCOUNT })).toEqual({ accountName: "ADA OBI", bankName: "Zenith Bank", accountLast4: "6789" });
    resolveAnswer = () => new Response(JSON.stringify({ status: false, message: "Could not resolve account name" }), { status: 422 });
    await expect(service.resolve({ bankCode: "057", accountNumber: ACCOUNT })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("could not find that account") });
    await expect(service.resolve({ bankCode: "999", accountNumber: ACCOUNT })).rejects.toMatchObject({ status: 400 });
    resolveAnswer = () => {
      throw new TypeError("network down");
    };
    await expect(service.resolve({ bankCode: "057", accountNumber: ACCOUNT })).rejects.toMatchObject({ status: 503 });
  });

  it("compares account names whatever the order or case", () => {
    expect(sameAccountName("ADA OBI", "Obi Ada")).toBe(true);
    expect(sameAccountName("ADA OBI", "Chidi Obi")).toBe(false);
    expect(sameAccountName("", "")).toBe(false);
  });

  it("only a shop owner can save; a different name is refused and nothing is stored", async () => {
    await expect(service.saveMine(me(buyer), { bankCode: "057", accountNumber: ACCOUNT, confirmedAccountName: "ADA OBI" })).rejects.toMatchObject({ status: 404 });
    await expect(service.saveMine(me(ownerA), { bankCode: "057", accountNumber: ACCOUNT, confirmedAccountName: "Someone Else" })).rejects.toMatchObject({ status: 400 });
    expect((await row(shopA)).payout_verified_at).toBeNull();
    expect(calls.some((c) => c.endsWith("/transferrecipient"))).toBe(false);
  });

  it("saving stores the recipient and last four digits, marks it verified and never returns the full number", async () => {
    await db.query(`update public.vendors set bank_code = '057', bank_name = 'Zenith Bank', account_number = '${ACCOUNT}', account_name = 'ADA OBI' where id = $1`, [shopA]); // the same account as the one being verified: not a change
    const out = await service.saveMine(me(ownerA), { bankCode: "057", accountNumber: ACCOUNT, confirmedAccountName: "Obi Ada" });
    expect(out).toEqual({ bankName: "Zenith Bank", accountName: "ADA OBI", accountLast4: "6789", verified: true });
    const r = await row(shopA);
    expect(r).toMatchObject({ bank_code: "057", bank_name: "Zenith Bank", account_name: "ADA OBI", transfer_recipient_code: "RCP_test123", payout_account_last4: "6789" });
    expect(r.payout_verified_at).not.toBeNull();
    const shown = await service.mine(me(ownerA));
    expect(shown).toMatchObject({ bankName: "Zenith Bank", accountLast4: "6789", verified: true });
    expect(JSON.stringify([out, shown])).not.toContain(ACCOUNT);
    // a first-time save does not raise a "changed" alert
    expect(await db.query(`select 1 from public.notifications where user_id = $1 and type = 'payout_account_changed'`, [ownerA])).toHaveLength(0);
  });

  it("changing the account tells the vendor and the admins, and it is verified again", async () => {
    await service.saveMine(me(ownerA), { bankCode: "044", accountNumber: "9876543210", confirmedAccountName: "ADA OBI" });
    const r = await row(shopA);
    expect(r).toMatchObject({ bank_code: "044", payout_account_last4: "3210" });
    const toVendor = await db.query<{ body: string }>(`select body from public.notifications where user_id = $1 and type = 'payout_account_changed'`, [ownerA]);
    expect(toVendor).toHaveLength(1);
    expect(toVendor[0]!.body).not.toContain("9876543210");
    expect(await db.query(`select 1 from public.notifications where user_id = $1 and type = 'admin_alert' and title = 'Vendor payout account changed'`, [admin])).toHaveLength(1);
  });

  it("a shop with an old, unchecked account shows as not verified; admins can list such shops, others cannot", async () => {
    await db.query(`update public.vendors set bank_code = '058', bank_name = 'GTBank', account_number = '1112223334', account_name = 'Old Name' where id = $1`, [shopB]);
    expect(await service.mine(me(ownerB))).toMatchObject({ accountLast4: "3334", verified: false });
    const list = await service.unverifiedShops(me(admin), { limit: 50, offset: 0 });
    expect(list.shops.map((s) => s.vendor_id)).toContain(shopB);
    expect(list.shops.map((s) => s.vendor_id)).not.toContain(shopA); // verified above
    expect(list.shops.find((s) => s.vendor_id === shopB)!.has_bank_details).toBe(true);
    await expect(service.unverifiedShops(me(buyer), { limit: 50, offset: 0 })).rejects.toMatchObject({ status: 403 });
  });
});
