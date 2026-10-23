#!/usr/bin/env node
/**
 * Payments health check, run after every backend deploy (and on a schedule). It NEVER charges anything and never sends a key:
 *   1. the backend is up;
 *   2. the payment routes are mounted (the webhook rejects a request with a bad signature with 401; signed-out calls get 401);
 *   3. the Paystack key mode matches the environment (live in production, test in staging). Only the MODE is reported.
 *
 *   node scripts/payments-health.mjs --url https://the-backend --expect live|test
 *
 * Exit code 0 = healthy, 1 = something is wrong (the deploy is marked failed). `runChecks()` is exported for the tests.
 */

const get = async (base, path, init = {}) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15000), ...init });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text };
};

/** Returns [{ name, ok, detail }]. `base` has no trailing slash. */
export async function runChecks(base, expectMode) {
  const out = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      out.push({ name, ok: detail === true || detail === undefined, detail: detail === true ? "" : detail });
    } catch (err) {
      out.push({ name, ok: false, detail: `could not ask: ${err instanceof Error ? err.message : String(err)}` });
    }
  };
  const fail = (msg) => msg;

  await check("backend is up", async () => {
    const r = await get(base, "/api/v1/health/live");
    return r.status === 200 ? true : fail(`GET /health/live answered ${r.status}`);
  });
  await check("the webhook rejects a bad signature (401)", async () => {
    const r = await get(base, "/api/v1/payments/paystack/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-paystack-signature": "0".repeat(128) },
      body: JSON.stringify({ event: "charge.success", data: { reference: "health-check" } }),
    });
    return r.status === 401 ? true : fail(`a bad signature got ${r.status}, expected 401 (is the webhook mounted and checking?)`);
  });
  await check("the webhook rejects a request with no signature (401)", async () => {
    const r = await get(base, "/api/v1/payments/paystack/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return r.status === 401 ? true : fail(`no signature got ${r.status}, expected 401`);
  });
  await check("verifying a payment needs sign-in (401)", async () => {
    const r = await get(base, "/api/v1/payments/paystack/health-check-reference");
    return r.status === 401 ? true : fail(`GET /payments/paystack/{reference} signed out got ${r.status}, expected 401`);
  });
  await check("starting a payment needs sign-in (401)", async () => {
    const r = await get(base, "/api/v1/orders/00000000-0000-4000-8000-000000000000/paystack/initialize", { method: "POST" });
    return r.status === 401 ? true : fail(`initialize signed out got ${r.status}, expected 401`);
  });
  await check("the payments config answers", async () => {
    const r = await get(base, "/api/v1/payments/config");
    return r.status === 200 || r.status === 401 ? true : fail(`GET /payments/config answered ${r.status}`);
  });
  await check(`the Paystack key mode is "${expectMode}"`, async () => {
    const r = await get(base, "/api/v1/payments/health");
    if (r.status !== 200) return fail(`GET /payments/health answered ${r.status}`);
    const mode = r.body?.data?.keyMode;
    if (mode === "missing") return fail("no Paystack key is configured");
    return mode === expectMode ? true : fail(`the backend uses a ${mode} key but this environment should use a ${expectMode} key`);
  });
  return out;
}

/** Shared with the staging smoke test: refuses anything that is not clearly test mode on staging. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url || process.env.PAYMENTS_HEALTH_URL || "").replace(/\/$/, "");
  const expectMode = String(args.expect || process.env.PAYMENTS_EXPECT_MODE || "live");
  if (!url || !["live", "test"].includes(expectMode)) {
    console.error("Usage: node scripts/payments-health.mjs --url https://backend --expect live|test");
    process.exit(2);
  }
  const results = await runChecks(url, expectMode);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `: ${r.detail}`}`);
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`\nPayments are NOT healthy: ${bad.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nPayments are healthy.");
}
