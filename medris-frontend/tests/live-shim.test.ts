import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevroData } from "../src/bridge/data-gateway.ts";

/** sb.channel() through the backend's live socket (src/bridge/live-shim.ts), with Supabase Realtime as before when it is not ready. */

class FakeSocket {
  static last: FakeSocket | null = null;
  static refuse = false;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    setTimeout(() => (FakeSocket.refuse ? this.onclose?.() : this.onopen?.()), 0);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  push(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

let realChannels: { topic: string; ons: unknown[][]; subscribed: boolean }[];
function fakeSupabase() {
  return {
    channel(topic: string) {
      const ch = { topic, ons: [] as unknown[][], subscribed: false, on(...a: unknown[]) { ch.ons.push(a); return ch; }, subscribe() { ch.subscribed = true; return ch; } };
      realChannels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(async () => "ok"),
    rpc: vi.fn(),
    auth: { getSession: async () => ({ data: { session: { access_token: "user-token" } } }), onAuthStateChange: vi.fn() },
  };
}

async function setup(changesReady: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");
  vi.stubEnv("VITE_BACKEND_URL", "https://api.example.dev");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ changes: changesReady }), { status: 200 })));
  const client = fakeSupabase();
  vi.stubGlobal("sb", client);
  await import("../src/bridge/data-gateway.ts");
  (globalThis as unknown as { window: { levroData: LevroData } }).window.levroData.installLive(client as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the legacy code's untyped channel API
  return client as unknown as { channel: (t: string, o?: unknown) => any; removeChannel: (c: unknown) => Promise<unknown> };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  realChannels = [];
  FakeSocket.last = null;
  FakeSocket.refuse = false;
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sb.channel through the backend", () => {
  it("stays on Supabase Realtime while the backend does not deliver row changes (migration 0004 not applied)", async () => {
    const sb = await setup(false);
    const cb = vi.fn();
    sb.channel("notifications-u1").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq.u1" }, cb).subscribe();
    await tick();
    expect(FakeSocket.last).toBeNull();
    expect(realChannels).toHaveLength(1);
    expect(realChannels[0]).toMatchObject({ topic: "notifications-u1", subscribed: true });
    expect(realChannels[0]!.ons[0]![0]).toBe("postgres_changes");
  });

  it("subscribes on the socket after signing in, and delivers changes in Realtime's shape (filters checked)", async () => {
    const sb = await setup(true);
    const mine = vi.fn();
    const status = vi.fn();
    const ch = sb
      .channel("orders-live-u1")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "buyer_id=eq.u1" }, mine)
      .subscribe(status);
    await tick();
    const ws = FakeSocket.last!;
    expect(ws.url).toBe("wss://api.example.dev/api/v1/live");
    expect(ws.sent[0]).toEqual({ type: "auth", token: "user-token" });
    const sub = ws.sent[1] as { id: string };
    expect(sub).toMatchObject({ type: "subscribe", changes: [{ event: "*", table: "orders", filter: "buyer_id=eq.u1" }] });
    ws.push({ type: "subscribed", id: sub.id });
    expect(status).toHaveBeenCalledWith("SUBSCRIBED", undefined);
    ws.push({ type: "change", id: sub.id, table: "orders", schema: "public", eventType: "UPDATE", commit_timestamp: "t", new: { id: "o1", buyer_id: "u1" }, old: { id: "o1" } });
    ws.push({ type: "change", id: sub.id, table: "orders", schema: "public", eventType: "UPDATE", commit_timestamp: "t", new: { id: "o2", buyer_id: "u2" }, old: { id: "o2" } });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine.mock.calls[0]![0]).toMatchObject({ table: "orders", eventType: "UPDATE", new: { id: "o1" }, old: { id: "o1" } });
    await sb.removeChannel(ch);
    expect(ws.sent.at(-1)).toEqual({ type: "unsubscribe", id: sub.id });
  });

  it("a conversation channel joins the conversation's room: typing, presence and new messages", async () => {
    const sb = await setup(true);
    const id = "6f1c2a0e-8a4b-4c1e-9d2f-3b5a7c9e1f20";
    const typing = vi.fn();
    const sync = vi.fn();
    const ch = sb
      .channel(`conv-${id}`, { config: { presence: { key: "u1" } } })
      .on("presence", { event: "sync" }, sync)
      .on("broadcast", { event: "typing" }, typing)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, () => {})
      .subscribe();
    await tick();
    const ws = FakeSocket.last!;
    const sub = ws.sent[1] as { id: string };
    expect(sub).toMatchObject({ room: `conversation:${id}`, presence: true });
    await ch.send({ type: "broadcast", event: "typing", payload: { typing: true } });
    await ch.track({ typing: true });
    expect(ws.sent.slice(2)).toEqual([
      { type: "broadcast", id: sub.id, event: "typing", payload: { typing: true } },
      { type: "track", id: sub.id, state: { typing: true } },
    ]);
    ws.push({ type: "broadcast", id: sub.id, event: "typing", payload: { typing: true }, from: "u2" });
    expect(typing).toHaveBeenCalledWith({ type: "broadcast", event: "typing", payload: { typing: true } });
    ws.push({ type: "presence", id: sub.id, event: "sync", state: { u2: [{ typing: true }] } });
    expect(sync).toHaveBeenCalled();
    expect(ch.presenceState()).toEqual({ u2: [{ typing: true }] });
  });

  it("falls back to Supabase Realtime when the socket cannot be opened", async () => {
    FakeSocket.refuse = true;
    const sb = await setup(true);
    sb.channel("lb-live-1").on("postgres_changes", { event: "*", schema: "public", table: "points_weekly" }, () => {}).subscribe();
    await tick();
    await tick();
    expect(realChannels.map((c) => c.topic)).toEqual(["lb-live-1"]);
  });
});
