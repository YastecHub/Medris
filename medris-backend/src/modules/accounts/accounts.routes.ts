import { Hono, type Context } from "hono";
import { errorMessage, json, readJsonBody } from "../../lib/http.js";
import { accountExists, deleteAccount, ensureProfile, registerAccount } from "./accounts.service.js";
import { renderSharePreview, type PreviewQuery } from "./share-preview.service.js";
import { getIceServers } from "./turn.service.js";
import { renderNotificationIcon, renderShareCard, type ImageResult } from "../share-images/share-images.service.js";

/**
 * /api/delete-account (plus its aliases /api/register and /api/account-exists)
 *   GET  ?turn=1                          -> ICE servers for calls
 *   GET  ?nicon=1&u=&n=&k=                -> notification picture (PNG)
 *   GET  ?ogstore= | ?ogprod= | ?ogpkg=   -> share card image (PNG)
 *   GET  ?storefront= | ?product= | ?package= -> link-preview HTML
 *   POST { action }          -> "account-exists" | "check-email" | "register" | "ensure-profile" | delete
 *
 * Deletion now happens only for a request with no action (what the app's
 * "Delete account" screen sends) or an explicit action "delete". Any other
 * unknown action is rejected instead of deleting the account.
 */

const DELETE_ACTIONS = new Set(["", "delete", "delete-account"]);

async function turnHandler(c: Context): Promise<Response> {
  c.header("Cache-Control", "private, max-age=600");
  return json(c, 200, await getIceServers());
}

function imageResponse(c: Context, result: ImageResult): Response {
  if (result.kind === "redirect") {
    if (result.cacheControl) c.header("Cache-Control", result.cacheControl);
    return c.redirect(result.location, 302);
  }
  return c.body(new Uint8Array(result.png), 200, { "Content-Type": "image/png", "Cache-Control": result.cacheControl });
}

export async function notificationIconHandler(c: Context): Promise<Response> {
  return imageResponse(c, await renderNotificationIcon({ u: c.req.query("u"), n: c.req.query("n"), k: c.req.query("k") }));
}

async function shareCardHandler(c: Context): Promise<Response> {
  return imageResponse(c, await renderShareCard({ ogstore: c.req.query("ogstore"), ogprod: c.req.query("ogprod"), ogpkg: c.req.query("ogpkg") }));
}

/** Link-preview HTML. `override` supplies the id for the short /s/, /p/, /k/ links. */
export async function sharePreviewHandler(c: Context, override: PreviewQuery = {}): Promise<Response> {
  try {
    const query: PreviewQuery = {
      storefront: c.req.query("storefront"),
      product: c.req.query("product"),
      package: c.req.query("package"),
      ...override,
    };
    const html = await renderSharePreview(query, c.req.header("host") ?? "", c.req.path);
    return c.html(html, 200);
  } catch {
    return c.body(null, 500);
  }
}

async function accountActions(c: Context): Promise<Response> {
  try {
    const body = await readJsonBody(c);
    const action = String(body.action || "").toLowerCase();
    let result;
    if (action === "account-exists" || action === "check-email") result = await accountExists(body);
    else if (action === "register") result = await registerAccount(body);
    else if (action === "ensure-profile") result = await ensureProfile(body);
    else if (DELETE_ACTIONS.has(action)) result = await deleteAccount(body);
    else result = { status: 400, body: { error: "Unknown account action." } };
    return json(c, result.status, result.body);
  } catch (error) {
    console.error("Levromart account API error:", error);
    return json(c, 500, { error: errorMessage(error) || "Could not complete the account request." });
  }
}

async function accountsEntry(c: Context): Promise<Response> {
  if (c.req.method === "GET" && c.req.query("turn") === "1") return turnHandler(c);
  if (c.req.method === "GET" && c.req.query("nicon") === "1") return notificationIconHandler(c);
  if (c.req.method === "GET" && ["ogstore", "ogprod", "ogpkg"].some((k) => c.req.query(k) !== undefined)) return shareCardHandler(c);
  if (c.req.method === "GET") return sharePreviewHandler(c);
  if (c.req.method !== "POST") return json(c, 405, { error: "Method not allowed." });
  return accountActions(c);
}

export const accountsRoutes = new Hono()
  .all("/delete-account", accountsEntry)
  .all("/register", accountsEntry)
  .all("/account-exists", accountsEntry)
  // Previously a rewrite to /api/delete-account?turn=1. Only GET is meaningful here.
  .get("/turn", turnHandler)
  .all("/turn", (c) => json(c, 405, { error: "Method not allowed." }))
  // Previously a rewrite to /api/delete-account?nicon=1.
  .get("/notif-icon", notificationIconHandler);
