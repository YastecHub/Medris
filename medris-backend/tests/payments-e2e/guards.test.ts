import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../support/fixtures.js";
import { createTestDatabase } from "../support/test-db.js";
// @ts-expect-error - plain Node scripts at the repository root (no type declarations)
import { runChecks } from "../../../scripts/payments-health.mjs";
// @ts-expect-error - plain Node scripts at the repository root
import { guard } from "../../../scripts/paystack-smoke.mjs";

describe("the staging smoke test refuses anything unsafe (Layer C guard)", () => {
  const ok = { secretKey: "sk_test_abc123", backendUrl: "https://levromart-staging.herokuapp.com" };
  it("accepts a test key on a staging host", () => {
    expect(() => guard(ok)).not.toThrow();
  });
  it("refuses a live key", () => {
    expect(() => guard({ ...ok, secretKey: "sk_live_abc123" })).toThrow(/not a TEST key/);
  });
  it("refuses a missing or odd key", () => {
    expect(() => guard({ ...ok, secretKey: "" })).toThrow(/REFUSED/);
    expect(() => guard({ ...ok, secretKey: "pk_test_abc" })).toThrow(/REFUSED/);
  });
  it("refuses the production backend, even with a test key", () => {
    expect(() => guard({ ...ok, backendUrl: "https://levromart-5212f03a7e44.herokuapp.com" })).toThrow(/production/);
  });
  it("refuses a host that does not look like staging, and a bad URL", () => {
    expect(() => guard({ ...ok, backendUrl: "https://shop.example.com" })).toThrow(/staging/);
    expect(() => guard({ ...ok, backendUrl: "not a url" })).toThrow(/REFUSED/);
  });
  it("accepts an extra host only when it is put on the allow-list on purpose", () => {
    expect(() => guard({ ...ok, backendUrl: "https://shop.example.com", allowedHosts: ["shop.example.com"] })).not.toThrow();
  });
});

describe("the post-deploy payments health check (Layer D) against the real app", () => {
  async function serve(env: Record<string, string>, key: string | undefined) {
    const saved = process.env.PAYSTACK_SECRET_KEY;
    if (key === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = key;
    const db = await createTestDatabase();
    const server = http.createServer(buildTestApp(db, { env }).app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      url,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await db.close();
        if (saved === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = saved;
      },
    };
  }
  const failed = (results: Array<{ ok: boolean; name: string }>) => results.filter((r) => !r.ok).map((r) => r.name);

  it("is healthy when the backend is up and the key mode matches", async () => {
    const s = await serve({ PAYSTACK_CHECKOUT_ENABLED: "true" }, "sk_test_health_check_key");
    try {
      const results = await runChecks(s.url, "test");
      expect(failed(results)).toEqual([]);
    } finally {
      await s.close();
    }
  }, 60_000);

  it("fails when production would be using a test key, and never shows the key", async () => {
    const s = await serve({}, "sk_test_health_check_key");
    try {
      const results = await runChecks(s.url, "live");
      expect(failed(results)).toEqual(['the Paystack key mode is "live"']);
      expect(JSON.stringify(results)).not.toMatch(/sk_(test|live)_/);
    } finally {
      await s.close();
    }
  }, 60_000);

  it("fails when no key is configured", async () => {
    const s = await serve({}, undefined);
    try {
      const results = await runChecks(s.url, "test");
      expect(failed(results)).toContain('the Paystack key mode is "test"');
    } finally {
      await s.close();
    }
  }, 60_000);

  it("fails every check when the backend is down", async () => {
    const results = await runChecks("http://127.0.0.1:9", "live");
    expect(failed(results).length).toBe(results.length);
  });
});
