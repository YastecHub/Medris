import { appendFileSync } from "node:fs";
import { expect } from "vitest";
import { createServices } from "../../src/container.js";
import type { Identity } from "../../src/database/context.js";
import { silentLogger } from "../../src/lib/logger.js";
import { rpcEntry } from "../../src/modules/rpc/rpc.dispatch.js";
import { testConfig } from "./fixtures.js";
import { bothRefused, comparable, runIsolated, type CompareOptions, type RunOutcome } from "./parity.js";
import type { TestDatabase } from "./test-db.js";

/**
 * Every runOriginal() also runs the same call through POST /api/v1/rpc/{name}'s table (rpc.dispatch.ts) on the
 * same rows, and the two must agree: same result (or both refused), same rows changed.
 *
 * RPC_CROSSCHECK_LOG=<file> writes one JSON line per call instead of failing, to review differences in bulk.
 * Tests whose name contains "FIX" or "FINDING" document a deliberate difference between original and port; for
 * those the dispatcher follows the port, so they are not compared.
 */
const config = testConfig();

/** Results in no particular order (the same rows, sorted differently from run to run). */
const anyOrder: CompareOptions = { result: (r) => (Array.isArray(r) ? r.map((x) => JSON.stringify(canonical(x))).sort() : r) };
/** Values that differ between any two runs by nature (random codes, the clock), as the parity tests mask them. */
const OPTIONS: Record<string, CompareOptions> = {
  admin_adjust_points: { volatile: ["event_key"] },
  submit_vendor_application: { volatile: ["referral_code"] },
  process_vendor_commission_hour_reminders: { volatile: ["metadata"] }, // hours_left inside it is the clock
  set_ai_conversation_shared: { volatile: ["share_token"], result: (r) => (typeof r === "string" ? "<token>" : r) },
  get_favorite_counts: anyOrder,
  get_package_favorite_counts: anyOrder,
  get_product_comment_counts: anyOrder,
  get_package_comment_counts: anyOrder,
};
/** Calls that reach an outside service (Supabase Auth's admin API), which the parity test stubs itself. */
const SKIP = new Set(["complete_manual_password_reset"]);

/** Objects with their keys sorted: a port builds the same JSON object with its keys in another order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}

export async function crossCheckRpc(testDb: TestDatabase, original: Promise<RunOutcome>, caller: Identity | null, name: string, args: Record<string, unknown>): Promise<RunOutcome> {
  const outcome = await original;
  const entry = rpcEntry(name);
  const test = expect.getState().currentTestName ?? "";
  if (!entry || SKIP.has(name) || /\bFIX\b|FINDING/.test(test)) return outcome;
  const dispatched = await runIsolated(testDb, (ctx) => {
    const services = createServices({ config, logger: silentLogger, data: () => ctx, google: null });
    return entry.run(services, caller, JSON.parse(JSON.stringify(args ?? {})));
  });
  const compared = comparable(outcome, dispatched, OPTIONS[name]);
  const a = canonical(compared.original) as Record<string, unknown>;
  const b = canonical(compared.port) as Record<string, unknown>;
  const agree = JSON.stringify(a) === JSON.stringify(b) || bothRefused(outcome, dispatched);
  const log = process.env.RPC_CROSSCHECK_LOG;
  if (log) {
    appendFileSync(log, JSON.stringify(agree ? { name, test, ok: true } : { name, test, ok: false, original: a, dispatched: b }) + "\n");
  } else if (!agree) {
    expect({ rpc: name, ...b }, `POST /api/v1/rpc/${name} must answer like the original`).toEqual({ rpc: name, ...a });
  }
  return outcome;
}
