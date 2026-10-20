/**
 * sb.channel() through the backend's live socket (/api/v1/live) instead of Supabase Realtime.
 *
 * installLive(sb) wraps sb.channel / sb.removeChannel once. The legacy code keeps its calls unchanged:
 * `.on("postgres_changes" | "broadcast" | "presence", ...)`, `.subscribe(cb)`, `.send()`, `.track()`,
 * `.untrack()`, `.presenceState()`, `.unsubscribe()`, `sb.removeChannel(ch)`, with Realtime's payload shapes.
 *
 * A channel decides when it subscribes: the backend is used only when GET /api/v1/live says row changes are
 * delivered (`changes: true`, i.e. migration 0004 is applied) and the socket connects; otherwise the channel is
 * created on Supabase Realtime exactly as before. Rooms: `conv-<id>` is the conversation's typing/presence room,
 * `voicecall-<id>` the call's signalling room (only the two people may join).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "@/config/env";
import { getAccessToken } from "@/lib/legacy-runtime";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
type Callback = (payload: unknown) => void;
interface Binding {
  type: "postgres_changes" | "broadcast" | "presence";
  filter: Record<string, unknown>;
  callback: Callback;
}
type RealChannel = ReturnType<SupabaseClient["channel"]>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOMS: [RegExp, string][] = [
  [new RegExp(`^conv-(${UUID})`, "i"), "conversation"],
  [new RegExp(`^voicecall-(${UUID})`, "i"), "call"],
];

/* ------------------------------------------------------------ the socket */

class LiveSocket {
  private ws: WebSocket | null = null;
  private opened = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly channels = new Map<string, BackendChannel>();

  constructor(private readonly url: string) {}

  /** Resolves true once connected (and signed in); false when the socket cannot be opened at all. */
  private connecting: Promise<boolean> | null = null;
  ensure(): Promise<boolean> {
    if (this.ws && this.opened) return Promise.resolve(true);
    this.connecting ??= this.open();
    return this.connecting;
  }

  private open(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = async () => {
        this.opened = true;
        this.failures = 0;
        await this.authenticate();
        for (const ch of this.channels.values()) ch.resubscribe();
        settled = true;
        resolve(true);
      };
      ws.onmessage = (e) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        const id = (m.id ?? m.ref) as string | undefined;
        const ch = id ? this.channels.get(id) : undefined;
        if (ch) ch.receive(m);
      };
      ws.onclose = () => {
        const wasOpen = this.opened;
        this.opened = false;
        this.ws = null;
        this.connecting = null;
        if (!settled) {
          settled = true;
          resolve(false);
        }
        if (!wasOpen) return;
        for (const ch of this.channels.values()) ch.status("CHANNEL_ERROR");
        this.reconnectLater();
      };
    });
  }

  private reconnectLater(): void {
    if (this.timer || !this.channels.size) return;
    const delay = Math.min(1000 * 2 ** this.failures++, 30_000);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.ensure().then((ok) => {
        if (!ok) this.reconnectLater();
      });
    }, delay);
  }

  async authenticate(): Promise<void> {
    const token = await getAccessToken().catch(() => null);
    this.send({ type: "auth", token });
  }

  send(message: unknown): boolean {
    if (!this.ws || !this.opened) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }
}

/* ------------------------------------------------------------ a channel */

let counter = 0;

/** Does a change match a binding's `filter` ("column=eq.value" / "column=in.(a,b)")? */
function filterMatches(filter: unknown, row: Record<string, unknown>): boolean {
  if (typeof filter !== "string" || !filter) return true;
  const m = filter.match(/^([a-z0-9_]+)=(eq|in)\.(.*)$/i);
  if (!m) return true;
  const value = row[m[1]!];
  if (value === undefined) return true; // the column was not sent (e.g. a DELETE's key-only old row): the server already filtered
  const wanted = m[2] === "eq" ? [m[3]] : m[3]!.replace(/^\(|\)$/g, "").split(",");
  return wanted.includes(String(value));
}

class BackendChannel {
  readonly id = `ch${++counter}`;
  private readonly bindings: Binding[] = [];
  private statusCallback: ((status: Status, err?: Error) => void) | null = null;
  private presence: Record<string, unknown[]> = {};
  private subscribed = false;
  private real: RealChannel | null = null;
  private trackedState: Record<string, unknown> | null = null;

  constructor(
    readonly topic: string,
    private readonly options: Record<string, unknown> | undefined,
    private readonly live: LiveSocket,
    private readonly ready: () => Promise<boolean>,
    private readonly viaSupabase: () => RealChannel,
  ) {}

  on(type: Binding["type"], filter: Record<string, unknown>, callback: Callback): this {
    this.bindings.push({ type, filter: filter ?? {}, callback });
    if (this.real) (this.real as unknown as { on: (...a: unknown[]) => unknown }).on(type, filter, callback);
    return this;
  }

  subscribe(callback?: (status: Status, err?: Error) => void): this {
    this.statusCallback = callback ?? null;
    void (async () => {
      if ((await this.ready()) && (await this.live.ensure())) {
        this.subscribed = true;
        this.live.channels.set(this.id, this);
        this.resubscribe();
        return;
      }
      // Not available: the same channel on Supabase Realtime, as before.
      const real = this.viaSupabase() as unknown as { on: (...a: unknown[]) => unknown; subscribe: (cb?: unknown) => unknown };
      for (const b of this.bindings) real.on(b.type, b.filter, b.callback);
      this.real = real as unknown as RealChannel;
      real.subscribe(callback);
    })();
    return this;
  }

  /** (Re)sends the subscription; after a reconnect the app refetches when it sees SUBSCRIBED again, as with Realtime. */
  resubscribe(): void {
    if (!this.subscribed) return;
    const changes = this.bindings
      .filter((b) => b.type === "postgres_changes")
      .map((b) => ({ event: String(b.filter.event ?? "*"), table: String(b.filter.table), ...(b.filter.filter ? { filter: String(b.filter.filter) } : {}) }));
    const room = this.room();
    const config = (this.options?.config ?? {}) as { presence?: unknown; broadcast?: { self?: boolean } };
    const presence = Boolean(config.presence) || this.bindings.some((b) => b.type === "presence");
    this.live.send({ type: "subscribe", id: this.id, ...(changes.length ? { changes } : {}), ...(room ? { room, presence } : {}), ...(config.broadcast?.self ? { self: true } : {}) });
    if (room && this.trackedState) this.live.send({ type: "track", id: this.id, state: this.trackedState });
  }

  private room(): string | null {
    for (const [pattern, kind] of ROOMS) {
      const m = this.topic.match(pattern);
      if (m) return `${kind}:${m[1]!.toLowerCase()}`;
    }
    return null;
  }

  status(s: Status, err?: Error): void {
    try {
      this.statusCallback?.(s, err);
    } catch {
      /* the app's callback */
    }
  }

  receive(m: Record<string, unknown>): void {
    switch (m.type) {
      case "subscribed":
        return this.status("SUBSCRIBED");
      case "error":
        return this.status("CHANNEL_ERROR", new Error(String(m.message ?? "error")));
      case "closed":
        return this.status("CLOSED");
      case "change": {
        const row = (m.eventType === "DELETE" ? m.old : m.new) as Record<string, unknown>;
        const payload = { schema: m.schema, table: m.table, commit_timestamp: m.commit_timestamp, eventType: m.eventType, new: m.new, old: m.old, errors: null };
        for (const b of this.bindings) {
          if (b.type !== "postgres_changes" || b.filter.table !== m.table) continue;
          const event = String(b.filter.event ?? "*");
          if (event !== "*" && event !== m.eventType) continue;
          if (!filterMatches(b.filter.filter, row ?? {})) continue;
          b.callback(payload);
        }
        return;
      }
      case "broadcast":
        for (const b of this.bindings) if (b.type === "broadcast" && b.filter.event === m.event) b.callback({ type: "broadcast", event: m.event, payload: m.payload });
        return;
      case "presence": {
        if (m.event === "sync") this.presence = (m.state ?? {}) as Record<string, unknown[]>;
        const info = m.event === "sync" ? {} : { key: m.key, newPresences: m.event === "join" ? [m.state] : [], leftPresences: m.event === "leave" ? [m.state] : [], currentPresences: [] };
        for (const b of this.bindings) if (b.type === "presence" && b.filter.event === m.event) b.callback({ event: m.event, ...info });
        return;
      }
    }
  }

  async send(message: { type?: string; event?: string; payload?: unknown }): Promise<string> {
    if (this.real) return (this.real as unknown as { send: (m: unknown) => Promise<string> }).send(message);
    return this.live.send({ type: "broadcast", id: this.id, event: message.event, payload: message.payload ?? {} }) ? "ok" : "error";
  }

  async track(state: Record<string, unknown>): Promise<string> {
    if (this.real) return (this.real as unknown as { track: (s: unknown) => Promise<string> }).track(state);
    this.trackedState = state;
    return this.live.send({ type: "track", id: this.id, state }) ? "ok" : "error";
  }

  async untrack(): Promise<string> {
    if (this.real) return (this.real as unknown as { untrack: () => Promise<string> }).untrack();
    this.trackedState = null;
    return this.live.send({ type: "untrack", id: this.id }) ? "ok" : "error";
  }

  presenceState(): Record<string, unknown[]> {
    if (this.real) return (this.real as unknown as { presenceState: () => Record<string, unknown[]> }).presenceState();
    return this.presence;
  }

  async unsubscribe(): Promise<string> {
    if (this.real) return (this.real as unknown as { unsubscribe: () => Promise<string> }).unsubscribe();
    if (this.subscribed) {
      this.live.send({ type: "unsubscribe", id: this.id });
      this.live.channels.delete(this.id);
      this.subscribed = false;
      this.status("CLOSED");
    }
    return "ok";
  }

  /** The Supabase channel this one became, if it fell back (for sb.removeChannel). */
  get supabaseChannel(): RealChannel | null {
    return this.real;
  }
}

/* --------------------------------------------------------------- install */

/** Whether the backend delivers row changes (GET /api/v1/live -> changes: true); asked once per page. */
function readiness(): () => Promise<boolean> {
  let answer: Promise<boolean> | null = null;
  return () =>
    (answer ??= fetch(`${appConfig.backendUrl}/api/v1/live`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { changes?: boolean } | null) => info?.changes === true)
      .catch(() => false));
}

export function installLive(client: SupabaseClient, enabled: () => boolean): void {
  const holder = client as unknown as Record<string, unknown>;
  if (holder.__levroLive) return;
  holder.__levroLive = true;
  if (typeof WebSocket === "undefined") return;
  const base = appConfig.backendUrl || (typeof location !== "undefined" ? location.origin : "");
  const live = new LiveSocket(`${base.replace(/^http/, "ws")}/api/v1/live`);
  const ready = readiness();
  const originalChannel = client.channel.bind(client);
  const originalRemove = client.removeChannel.bind(client);

  client.channel = ((topic: string, options?: Record<string, unknown>) => {
    if (!enabled()) return originalChannel(topic, options as never);
    return new BackendChannel(topic, options, live, ready, () => originalChannel(topic, options as never)) as unknown as RealChannel;
  }) as SupabaseClient["channel"];

  client.removeChannel = ((channel: RealChannel) => {
    const ours = channel as unknown;
    if (ours instanceof BackendChannel) {
      const real = ours.supabaseChannel;
      return real ? originalRemove(real) : ours.unsubscribe();
    }
    return originalRemove(channel);
  }) as SupabaseClient["removeChannel"];

  // A refreshed or new sign-in reaches the socket (the server re-checks room membership).
  client.auth.onAuthStateChange((event) => {
    if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "SIGNED_OUT") void live.authenticate();
  });
}
