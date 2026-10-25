/**
 * sb.from() through the backend's data API.
 *
 * The legacy code runs about 450 table queries with `sb.from(table)...`. supabase-js sends each one to
 * `<supabase>/rest/v1/...`, which is PostgREST. The backend runs the same PostgREST on the same database
 * (`<backend>/rest/v1`, GET /api/v1/data-api says when it is ready), so installTables(sb) only changes where those
 * requests go: same query, same token, same roles and row-level security, same answer. No call site changes.
 *
 * Safety net, never running a write twice: a read (GET/HEAD) goes back to Supabase when the backend cannot answer
 * (unreachable, 502/503/504); a write only when it certainly did not run (it never left the browser, or the data
 * API answered that it has no database connection). After a request that could not be sent, Supabase is used for a
 * minute before the backend is tried again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "@/config/env";

type Fetch = typeof fetch;
const PAUSE_MS = 60_000;
/** The last "ready" answer is remembered this long, so the first queries of the next visit go straight to the backend. */
const REMEMBER_MS = 6 * 60 * 60_000;
const READY_KEY = "medris:data-api-ready";

function rememberedReady(): boolean | null {
  try {
    const at = Number(localStorage.getItem(READY_KEY) ?? 0);
    return at && Date.now() - at < REMEMBER_MS ? true : null;
  } catch {
    return null;
  }
}
function remember(ready: boolean): void {
  try {
    if (ready) localStorage.setItem(READY_KEY, String(Date.now()));
    else localStorage.removeItem(READY_KEY);
  } catch {
    /* storage unavailable: the check simply runs again next time */
  }
}

export function installTables(client: SupabaseClient, enabled: () => boolean): void {
  const rest = (client as unknown as { rest?: { url: string; fetch: Fetch; __levroTables?: boolean } }).rest;
  if (!rest || rest.__levroTables || !appConfig.backendUrl) return;
  rest.__levroTables = true;
  const supabaseBase = rest.url.replace(/\/$/, "") + "/";
  const backendBase = `${appConfig.backendUrl}/rest/v1/`;
  const original = rest.fetch;
  // Known ready on a recent visit: use the backend from the first query (one server, no wait for the check).
  let ready: boolean | null = rememberedReady();
  let checking: Promise<void> | null = null;
  let pausedUntil = 0;

  const check = () =>
    (checking ??= fetch(`${appConfig.backendUrl}/api/v1/data-api`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { ready?: boolean } | null) => {
        ready = info?.ready === true;
        remember(ready);
      })
      .catch(() => {
        ready = false;
        remember(false);
      }));
  // Ask early (also when remembered, to notice a switch-off); until the first answer, queries go to Supabase as before.
  if (enabled()) void check();

  rest.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!enabled() || ready !== true || Date.now() < pausedUntil || !url.startsWith(supabaseBase)) {
      if (enabled() && ready === null) void check();
      return original(input, init);
    }
    const method = String(init?.method ?? "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    let response: Response;
    try {
      response = await original(backendBase + url.slice(supabaseBase.length), init);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") throw err; // the caller cancelled it
      pausedUntil = Date.now() + PAUSE_MS;
      remember(false);
      return original(input, init); // never left the browser: safe for reads and writes
    }
    if (isRead && (response.status === 502 || response.status === 503 || response.status === 504)) return original(input, init);
    // A write answered 503 by PostgREST itself (PGRST0xx: no database connection, or starting) did not run.
    // (Heroku's own 503 - a timeout - is HTML, and the write may have run: it is not repeated.)
    if (response.status === 503) {
      const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
      if (body?.code?.startsWith("PGRST0")) return original(input, init);
    }
    return response;
  }) as Fetch;
}
