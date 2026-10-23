#!/usr/bin/env node
/**
 * A real Paystack TEST-MODE smoke test, for STAGING only. It refuses to run against anything that is not clearly test mode on
 * staging, and it never prints a key. Run it from GitHub Actions (.github/workflows/paystack-smoke.yml), with these secrets:
 *   PAYSTACK_TEST_SECRET_KEY   the Paystack TEST secret key (must start with sk_test_)
 *   STAGING_BACKEND_URL        the staging backend, e.g. https://levromart-staging.herokuapp.com
 *   SMOKE_BUYER_TOKEN / SMOKE_ADMIN_TOKEN   access tokens of the dedicated test buyer and test admin
 *   SMOKE_ORDER_ID             a confirmed, unpaid sale order of the test buyer (the test creates a fresh payment on it)
 *
 * Steps: guard -> initialize -> pay with a Paystack test card on the hosted page -> wait for the webhook -> Paystack verify
 * matches -> refund -> daily check shows no mismatch for these references. Any failure names the step and exits 1.
 */
import { parseArgs } from "./payments-health.mjs";

/** Throws unless it is safe to run. Exported so a test can prove the guard works. */
export function guard({ secretKey, backendUrl, allowedHosts = [] }) {
  if (!secretKey || !/^sk_test_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new Error("REFUSED: the Paystack key is missing or is not a TEST key (it must start with sk_test_). Nothing was sent.");
  }
  let url;
  try {
    url = new URL(backendUrl);
  } catch {
    throw new Error("REFUSED: STAGING_BACKEND_URL is missing or is not a URL.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "levromart-5212f03a7e44.herokuapp.com" || host === "levromart.app" || host === "www.levromart.app") {
    throw new Error("REFUSED: that is the production backend. This smoke test only runs against staging.");
  }
  const looksStaging = /staging|stage|test|localhost|127\.0\.0\.1/.test(host) || allowedHosts.includes(host);
  if (!looksStaging) throw new Error(`REFUSED: ${host} does not look like a staging host (its name must contain "staging", or add it to the allow-list on purpose).`);
  return { host };
}

const mask = (s) => String(s).replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_***").replace(/\b\d{6}(\d{4})\b/g, "******$1");

async function step(name, fn, report) {
  const started = Date.now();
  try {
    const detail = await fn();
    report.push({ name, ok: true, ms: Date.now() - started, detail: mask(detail ?? "") });
  } catch (err) {
    report.push({ name, ok: false, ms: Date.now() - started, detail: mask(err instanceof Error ? err.message : String(err)) });
    throw new Error(`Step failed: ${name}: ${report.at(-1).detail}`);
  }
}

export async function runSmoke(env = process.env) {
  const secretKey = env.PAYSTACK_TEST_SECRET_KEY;
  const backendUrl = String(env.STAGING_BACKEND_URL || "").replace(/\/$/, "");
  guard({ secretKey, backendUrl, allowedHosts: String(env.SMOKE_ALLOWED_HOSTS || "").split(",").filter(Boolean) });
  for (const need of ["SMOKE_BUYER_TOKEN", "SMOKE_ADMIN_TOKEN", "SMOKE_ORDER_ID"]) if (!env[need]) throw new Error(`REFUSED: ${need} is not set.`);

  const api = async (path, { token, method = "GET", body } = {}) => {
    const res = await fetch(`${backendUrl}/api/v1${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const paystack = async (path) => {
    const res = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(30000) });
    return res.json();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = [];
  const ctx = {};

  await step("the backend uses a Paystack TEST key", async () => {
    const r = await api("/payments/health");
    if (r.json?.data?.keyMode !== "test") throw new Error(`the staging backend reports key mode "${r.json?.data?.keyMode}", expected "test"`);
  }, report);

  await step("initialize a payment on the test order", async () => {
    const r = await api(`/orders/${env.SMOKE_ORDER_ID}/paystack/initialize`, { token: env.SMOKE_BUYER_TOKEN, method: "POST" });
    if (r.status !== 200) throw new Error(`initialize answered ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    ctx.reference = r.json.data.reference;
    ctx.url = r.json.data.authorizationUrl;
    return `reference ${ctx.reference}`;
  }, report);

  await step("pay with a Paystack test card on the hosted page", async () => {
    // Playwright is a dev dependency of medris-frontend. The page and its field names are Paystack's: this step is the one most
    // likely to need maintenance if Paystack changes its checkout.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(ctx.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByRole("button", { name: /card/i }).first().click({ timeout: 30000 }).catch(() => undefined);
      await page.getByPlaceholder(/0000 0000 0000 0000/).fill("4084084084084081", { timeout: 30000 }); // Paystack's documented test card
      await page.getByPlaceholder(/MM ?\/ ?YY/i).fill("12/30");
      await page.getByPlaceholder(/123/).first().fill("408");
      await page.getByRole("button", { name: /pay/i }).last().click();
      await page.waitForURL((u) => !u.hostname.endsWith("paystack.com") && !u.hostname.endsWith("paystack.co"), { timeout: 90000 }).catch(() => undefined);
    } finally {
      await browser.close();
    }
  }, report);

  await step("the order is paid (webhook or confirm call) and Paystack agrees", async () => {
    let status = "";
    for (let i = 0; i < 20; i++) {
      const r = await api(`/payments/paystack/${ctx.reference}`, { token: env.SMOKE_BUYER_TOKEN });
      status = r.json?.data?.status;
      if (status === "success") break;
      await sleep(3000);
    }
    if (status !== "success") throw new Error(`the payment never reached "success" (last status: ${status})`);
    const v = await paystack(`/transaction/verify/${ctx.reference}`);
    if (v?.data?.status !== "success") throw new Error(`Paystack's own verify says "${v?.data?.status}"`);
    ctx.amount = v.data.amount;
    return `${ctx.amount} kobo`;
  }, report);

  await step("refund it (admin)", async () => {
    const r = await api(`/admin/orders/${env.SMOKE_ORDER_ID}/refund`, { token: env.SMOKE_ADMIN_TOKEN, method: "POST", body: { reason: "Smoke test refund" } });
    if (r.status !== 200) throw new Error(`refund answered ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  }, report);

  await step("the money screens show no problem", async () => {
    const r = await api("/admin/payments/summary", { token: env.SMOKE_ADMIN_TOKEN });
    if (r.status !== 200) throw new Error(`summary answered ${r.status}`);
    const stuck = r.json?.data?.health?.needsAttention;
    if (stuck) throw new Error(`${stuck} item(s) need attention on the staging Payments screen`);
  }, report);

  return report;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  parseArgs(process.argv.slice(2));
  const report = [];
  try {
    const done = await runSmoke();
    done.forEach((r) => console.log(`PASS  ${r.name} (${r.ms} ms) ${r.detail}`));
    console.log("\nSmoke test passed.");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err).replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_***"));
    void report;
    process.exit(1);
  }
}
