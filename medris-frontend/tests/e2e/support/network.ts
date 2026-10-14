import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page, Route } from "@playwright/test";
import { BUYER, RPCS, TABLES } from "../fixtures/data";

const require = createRequire(import.meta.url);
const SUPABASE_UMD = readFileSync(require.resolve("@supabase/supabase-js/dist/umd/supabase.js"), "utf8");
const FONT_WEIGHTS = [400, 500, 600, 700, 800];
const FONT_FILES = new Map(FONT_WEIGHTS.map((w) => [`/fixture-fonts/Inter-${w}.woff2`, readFileSync(new URL(`../fixtures/fonts/Inter-${w}.woff2`, import.meta.url))]));
// What fonts.googleapis.com would answer, pointing at the local files above.
const FONT_CSS = FONT_WEIGHTS.map(
  (w) => `@font-face{font-family:"Inter";font-style:normal;font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/fixture-fonts/Inter-${w}.woff2) format("woff2")}`,
).join("\n");
const FIXTURE_HOST = "e2e-fixture.supabase.co";
// 1x1 transparent PNG, used for every remote image.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export interface NetworkLog {
  /** Writes (POST/PATCH/PUT/DELETE) sent to Supabase REST. Read-only screens must leave this empty. */
  writes: string[];
  /** Tables read that have no fixture (answered with an empty list). */
  unmappedTables: Set<string>;
  /** Requests to hosts outside the allow-list; they are blocked, never forwarded. */
  blocked: string[];
  /** Supabase RPC calls seen (informational: most are reads). */
  rpcs: string[];
  /** Calls to the app's own /api routes (answered with an empty JSON object). */
  api: string[];
}

/** Applies simple `column=eq.value` filters so a lookup by id returns that row. Anything else is ignored. */
function filterRows(rows: unknown[] | undefined, params: URLSearchParams): unknown[] | undefined {
  if (!rows) return rows;
  let out = rows as Record<string, unknown>[];
  for (const [col, expr] of params) {
    const m = /^eq\.(.*)$/.exec(expr);
    if (m && out.some((r) => col in r)) out = out.filter((r) => String(r[col]) === m[1]);
  }
  return out;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A signed-looking token. Nothing checks the signature: all calls are answered locally. */
export function fakeSession(user = BUYER) {
  const exp = Math.floor(new Date("2030-01-01T00:00:00Z").getTime() / 1000);
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp })}.fixture-signature`;
  return {
    access_token,
    refresh_token: "fixture-refresh-token",
    token_type: "bearer",
    expires_in: 3600 * 24 * 365,
    expires_at: exp,
    user: {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      app_metadata: { provider: "email" },
      user_metadata: { full_name: user.full_name },
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

/**
 * Answers every network request of the page locally. `signedIn` writes a fake Supabase session
 * before the app starts; `theme` sets the saved theme.
 */
export async function installFixtures(page: Page, opts: { signedIn: boolean; theme: "light" | "dark" }): Promise<NetworkLog> {
  const log: NetworkLog = { writes: [], rpcs: [], unmappedTables: new Set(), blocked: [], api: [] };
  const session = fakeSession();

  await page.addInitScript(
    ({ signedIn, theme, session: s }) => {
      try {
        // Headless Chromium reports notifications as "denied", which makes the app show its
        // "turn on notifications" dialog over every screen. Report "granted" instead.
        Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
      } catch {
        /* no Notification API */
      }
      try {
        localStorage.setItem("medris-theme", theme);
        // Skip the first-visit welcome screens, which would otherwise cover the screen under test.
        localStorage.setItem("levromart_onboarding_completed", "true");
        // Skip first-visit prompts that would cover the screen under test.
        localStorage.setItem("levromart-tour-seen", "1"); // first-visit app tour
        localStorage.setItem("levromart-permission-nudge-seen-v2", "1"); // "turn on notifications" pop-up
        localStorage.setItem("medris-install-dismissed", String(Date.now()));
        localStorage.setItem("medris-notif-dismissed", String(Date.now()));
        if (signedIn) {
          localStorage.setItem("sb-e2e-fixture-auth-token", JSON.stringify(s));
          // The "accept the terms" gate remembers acceptance per user for the tab.
          sessionStorage.setItem(`levro_legal_ok_${s.user.id}`, "1");
        }
      } catch {
        /* storage unavailable */
      }
    },
    { signedIn: opts.signedIn, theme: opts.theme, session },
  );

  // Realtime: accept the socket and acknowledge joins/heartbeats; never deliver events.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      try {
        const [joinRef, ref, topic, event] = JSON.parse(String(raw));
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: event === "phx_join" ? { postgres_changes: [] } : {} }]));
      } catch {
        /* ignore */
      }
    });
  });

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      if (url.pathname.startsWith("/api/")) {
        log.api.push(`${method} ${url.pathname}`);
        return json(route, {});
      }
      return route.continue();
    }
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();

    if (url.hostname === FIXTURE_HOST) {
      if (url.pathname.startsWith("/auth/v1/")) {
        if (url.pathname.endsWith("/user")) return json(route, session.user);
        if (url.pathname.endsWith("/token")) return json(route, session);
        return json(route, {});
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").pop() ?? "";
        log.rpcs.push(name);
        return json(route, RPCS[name] ?? null);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.slice("/rest/v1/".length);
        if (method !== "GET" && method !== "HEAD") {
          log.writes.push(`${method} ${table}`);
          return route.fulfill({ status: method === "POST" ? 201 : 204, headers: { "access-control-allow-origin": "*" }, body: "" });
        }
        const rows = filterRows(TABLES[table], url.searchParams);
        if (!rows) log.unmappedTables.add(table);
        const list = rows ?? [];
        const headers = { "content-range": `0-${Math.max(list.length - 1, 0)}/${list.length}` };
        if (((await req.allHeaders())["accept"] ?? "").includes("vnd.pgrst.object")) {
          return list.length ? json(route, list[0], 200, headers) : json(route, { code: "PGRST116", message: "no rows" }, 406);
        }
        return method === "HEAD" ? route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", ...headers }, body: "" }) : json(route, list, 200, headers);
      }
      if (url.pathname.startsWith("/storage/") || url.pathname.startsWith("/functions/")) return json(route, {});
      log.blocked.push(`${method} ${req.url()}`);
      return route.abort();
    }

    // The Supabase client script is normally loaded from a CDN: serve the pinned local copy.
    if ((url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net") && /supabase-js/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: SUPABASE_UMD });
    }
    // The Leaflet map library is loaded on demand from a CDN. It is deliberately unavailable in
    // these tests, so the map areas stay empty and map tiles are never requested.
    if (url.hostname === "unpkg.com" && /\/leaflet@/.test(url.pathname)) return route.fulfill({ status: 404, body: "" });
    // Inter is answered from the bundled copies; the icon stylesheet (Font Awesome) is answered
    // empty so screenshots do not depend on the network (icons are simply absent).
    if (req.resourceType() === "stylesheet" && url.hostname === "fonts.googleapis.com") {
      return route.fulfill({ status: 200, contentType: "text/css", headers: { "access-control-allow-origin": "*" }, body: FONT_CSS });
    }
    if (req.resourceType() === "stylesheet" && url.hostname === "cdnjs.cloudflare.com") {
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    }
    if (url.hostname === "fonts.gstatic.com") {
      const file = FONT_FILES.get(url.pathname);
      return file ? route.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: file }) : route.abort();
    }
    if (req.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });

    log.blocked.push(`${method} ${req.url()}`);
    return route.abort();
  });

  return log;
}
