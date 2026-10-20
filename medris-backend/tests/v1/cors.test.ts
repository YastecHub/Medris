import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { buildTestApp, call, testConfig } from "../support/fixtures.js";

/** The app (Vercel) calls the backend (Heroku) from the browser: its own sites must pass CORS without extra settings. */
describe("CORS for the app's own sites", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db?.close());

  it("production allows levromart.vercel.app and levromart.com, plus CORS_ALLOWED_ORIGINS", () => {
    const config = testConfig({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://preview.example.dev" });
    expect(config.cors.allowedOrigins).toEqual(
      expect.arrayContaining(["https://levromart.vercel.app", "https://levromart.com", "https://www.levromart.com", "https://preview.example.dev"]),
    );
    expect(testConfig().cors.allowedOrigins).toEqual([]);
  });

  it("answers the browser's preflight from the app, not from other sites", async () => {
    const app = buildTestApp(db, { env: { NODE_ENV: "production" } });
    const preflight = (origin: string) =>
      call(app, "OPTIONS", "/api/v1/rpc/get_vendor_stats", {
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
      });
    const fromApp = await preflight("https://levromart.vercel.app");
    expect(fromApp.headers.get("access-control-allow-origin")).toBe("https://levromart.vercel.app");
    const fromElsewhere = await preflight("https://evil.example");
    expect(fromElsewhere.headers.get("access-control-allow-origin")).toBeNull();
  });
});
