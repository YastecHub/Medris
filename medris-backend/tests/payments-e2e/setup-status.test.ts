import { describe, expect, it } from "vitest";
import { api, json, useWorld } from "./harness.js";

describe("setup status", () => {
  const w = useWorld();
  const call = async (token: string) => json(await api.post(w, "/rpc/get_setup_status", token, {}));
  it("only admins can ask, and a fully migrated database has nothing missing", async () => {
    expect((await call(w.buyer.token)).status).toBe(403);
    const r = await call(w.admin.token);
    expect(r.status).toBe(200);
    expect(r.data.missing).toEqual([]);
  });
});
