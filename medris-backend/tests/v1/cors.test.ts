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

  it("always allows levromart.vercel.app and levromart.com, whatever NODE_ENV says, plus CORS_ALLOWED_ORIGINS", () => {
    const app = ["https://levromart.vercel.app", "https://levromart.com", "https://www.levromart.com"];
    for (const NODE_ENV of ["production", "development", "test"]) {
      expect(testConfig({ NODE_ENV }).cors.allowedOrigins).toEqual(expect.arrayContaining(app));
    }
    expect(testConfig({ CORS_ALLOWED_ORIGINS: "https://preview.example.dev" }).cors.allowedOrigins).toEqual(expect.arrayContaining([...app, "https://preview.example.dev"]));
  });

  it("answers the browser's preflight from the app, not from other sites", async () => {
    const app = buildTestApp(db, { env: { NODE_ENV: "development" } });
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
