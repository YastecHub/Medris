/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers: response bodies and rows are checked field by field in each test */
import { afterAll, beforeAll, beforeEach } from "vitest";
import { setDataContextProvider } from "../../src/database/index.js";
import { accessToken, buildTestApp, call, seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { startFakePaystack, type FakePaystack } from "../support/fake-paystack.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

/**
 * The shared set-up of the payment end-to-end tests: the real app (HTTP routes, services, database with every migration)
 * talking to a fake Paystack. Each test seeds its own order; nothing is shared between tests except the people.
 */
export interface World {
  db: TestDatabase;
  paystack: FakePaystack;
  app: ReturnType<typeof buildTestApp>;
  appOff: ReturnType<typeof buildTestApp>;
  buyer: { id: string; token: string };
  buyer2: { id: string; token: string };
  vendor: { id: string; shop: string; token: string };
  admin: { id: string; token: string };
  product: string;
}

export const CRON_SECRET = "cron-secret-for-tests";

export function useWorld(): World {
  const w = {} as World;
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    w.paystack = await startFakePaystack();
    for (const [k, v] of Object.entries({ PAYSTACK_SECRET_KEY: w.paystack.secret, PAYSTACK_BASE_URL: w.paystack.url, PAYSTACK_TIMEOUT_MS: "400", CRON_SECRET })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    w.db = await createTestDatabase();
    setDataContextProvider(() => w.db.data); // the shared settlement code reaches the database through the global context
    w.app = buildTestApp(w.db, { env: { PAYSTACK_CHECKOUT_ENABLED: "true" } });
    w.appOff = buildTestApp(w.db, { env: { PAYSTACK_CHECKOUT_ENABLED: "false" } });
    const person = async (role?: "vendor" | "admin") => {
      const id = (await seedUser(w.db, role === "vendor" ? { role: "vendor" } : {})).id;
      if (role === "admin") await setRole(w.db, id, "admin");
      return { id, token: await accessToken(id) };
    };
    w.buyer = await person();
    w.buyer2 = await person();
    w.admin = await person("admin");
    const owner = await person("vendor");
    const shop = (await seedVendor(w.db, owner.id, { name: "Dayo Stores" })).id;
    // a verified payout account (a test recipient), as the vendor would have saved in the app
    await w.db.query(`update public.vendors set transfer_recipient_code = 'RCP_e2e', payout_verified_at = now(), bank_code = '057', account_number = '0123456789' where id = $1`, [shop]);
    w.vendor = { id: owner.id, shop, token: owner.token };
    w.product = await seedProduct(w.db, shop);
  }, 90_000);
  beforeEach(() => {
    w.paystack.reset();
  });
  afterAll(async () => {
    setDataContextProvider(null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await w.paystack.close();
    await w.db?.close();
  });
  return w;
}

/** A confirmed sale order of `naira` for the buyer (pickup, so one payment completes it). */
export async function newOrder(w: World, naira = 5000, status = "confirmed", buyerId = w.buyer.id) {
  return seedOrder(w.db, buyerId, w.vendor.shop, { status, productIds: [w.product], total: naira });
}

export const api = {
  get: (w: World, path: string, token?: string, app = w.app) => call(app, "GET", `/api/v1${path}`, { token }),
  post: (w: World, path: string, token?: string, body?: unknown, app = w.app) => call(app, "POST", `/api/v1${path}`, { token, body }),
};

export async function json<T = Record<string, any>>(res: Response): Promise<{ status: number; body: T; data: any }> {
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body, data: body?.data };
}

/** Starts a payment as the buyer: returns what the app answered. */
export async function startPayment(w: World, orderId: string, token = w.buyer.token) {
  return json(await api.post(w, `/orders/${orderId}/paystack/initialize`, token));
}

let eventSeq = 0;
/** Posts a webhook exactly as Paystack does: the raw body signed with HMAC-SHA512. Returns the raw body too (to send a duplicate). */
export async function sendWebhook(w: World, event: string, data: Record<string, unknown>, opts: { signature?: string | null; id?: number } = {}) {
  const raw = JSON.stringify({ event, data: { id: opts.id ?? 800000 + ++eventSeq, ...data } });
  const sig = opts.signature === undefined ? w.paystack.sign(raw) : opts.signature;
  return { raw, ...(await sendWebhookRaw(w, raw, sig ?? undefined)) };
}

/** The same event posted as the very same bytes (a duplicate delivery). */
export async function sendWebhookRaw(w: World, raw: string, signature?: string) {
  const res = await w.app.fetch(new Request("https://app.test/api/v1/payments/paystack/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "x-paystack-signature": signature } : {}) }, body: raw }));
  return json(res);
}

export async function runJob(w: World, name: string) {
  return json(await call(w.app, "POST", `/api/v1/jobs/${name}`, { headers: { "x-cron-secret": CRON_SECRET } }));
}

export const rowOf = async <T = Record<string, any>>(w: World, sql: string, params: unknown[] = []) => (await w.db.query<T>(sql, params))[0];

/** Pays an order the normal way (initialize, hosted checkout, signed webhook) and returns its reference. */
export async function payOrder(w: World, orderId: string, naira?: number) {
  const started = await startPayment(w, orderId);
  if (started.status !== 200) throw new Error(`initialize failed: ${started.status} ${JSON.stringify(started.body)}`);
  const reference = started.data.reference as string;
  await sendWebhook(w, "charge.success", w.paystack.completeCheckout(reference));
  void naira;
  return reference;
}

/** The buyer confirms receipt; returns the payout's transfer reference once the worker has queued and sent it. */
export async function completeAndPayOut(w: World, orderId: string) {
  const r = await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token));
  if (r.status !== 200) throw new Error(`confirm receipt failed: ${r.status} ${JSON.stringify(r.body)}`);
  await runJob(w, "vendor-payouts");
  return (await rowOf<{ transfer_reference: string }>(w, `select transfer_reference from public.vendor_payouts where order_id = $1`, [orderId]))?.transfer_reference as string;
}

/** The table stamps updated_at itself; switch that off for a moment to pretend time passed (no sleeping in tests). */
export async function ageRows(w: World, table: string, where: string, interval: string) {
  await w.db.query(`alter table public.${table} disable trigger user`);
  await w.db.query(`update public.${table} set updated_at = now() - interval '${interval}', created_at = least(created_at, now() - interval '${interval}') where ${where}`).catch(async () => {
    await w.db.query(`update public.${table} set updated_at = now() - interval '${interval}' where ${where}`);
  });
  await w.db.query(`alter table public.${table} enable trigger user`);
}
