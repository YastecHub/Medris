import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LiveService } from "../../src/modules/live/live.service.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { buildTestApp, call } from "../support/fixtures.js";

/** The app moves its subscriptions off Supabase Realtime only when GET /api/v1/live says changes are delivered. */
describe("live updates readiness", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db?.close());

  it("is ready only while LISTEN is connected and migration 0004's trigger function exists", async () => {
    const live = new LiveService(() => db.data);
    expect(live.changesReady).toBe(false);
    await live.changeSourceState("connected");
    expect(live.changesReady).toBe(true);
    await live.changeSourceState("disconnected");
    expect(live.changesReady).toBe(false);

    await db.query("alter function public.backend_live_notify() rename to backend_live_notify_gone");
    try {
      const without = new LiveService(() => db.data);
      await without.changeSourceState("connected");
      expect(without.changesReady).toBe(false);
    } finally {
      await db.query("alter function public.backend_live_notify_gone() rename to backend_live_notify");
    }
  });

  it("GET /api/v1/live reports it", async () => {
    const app = buildTestApp(db);
    expect(await (await call(app, "GET", "/api/v1/live")).json()).toMatchObject({ changes: false, websocket: "/api/v1/live" });
  });
});
