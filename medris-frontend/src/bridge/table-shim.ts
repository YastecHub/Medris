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

export function installTables(client: SupabaseClient, enabled: () => boolean): void {
  const rest = (client as unknown as { rest?: { url: string; fetch: Fetch; __levroTables?: boolean } }).rest;
  if (!rest || rest.__levroTables || !appConfig.backendUrl) return;
  rest.__levroTables = true;
  const supabaseBase = rest.url.replace(/\/$/, "") + "/";
  const backendBase = `${appConfig.backendUrl}/rest/v1/`;
  const original = rest.fetch;
  let ready: boolean | null = null;
  let checking: Promise<void> | null = null;
  let pausedUntil = 0;

  const check = () =>
    (checking ??= fetch(`${appConfig.backendUrl}/api/v1/data-api`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { ready?: boolean } | null) => {
        ready = info?.ready === true;
      })
      .catch(() => {
        ready = false;
      }));
  // Ask early; until the answer arrives, queries go to Supabase as before.
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
