import { Router, type Request, type Response } from "express";
import { json, readJsonBody } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { renderNotificationIcon, renderShareCard, type ImageResult } from "../share-images/share-images.service.js";
import { handleAccountAction } from "./accounts.service.js";
import { renderSharePreview, type PreviewQuery } from "./share-preview.service.js";
import { getIceServers } from "./turn.service.js";

/**
 * /api/delete-account (plus its aliases /api/register and /api/account-exists)
 *   GET  ?turn=1                              -> ICE servers for calls
 *   GET  ?nicon=1&u=&n=&k=                    -> notification picture (PNG)
 *   GET  ?ogstore= | ?ogprod= | ?ogpkg=       -> share card image (PNG)
 *   GET  ?storefront= | ?product= | ?package= -> link-preview HTML
 *   POST { action, ... }                      -> accounts.service.ts handleAccountAction()
 * Contract: accounts.routes.ts.
 */

const q = (req: Request, name: string): string | undefined => {
  const value = req.query[name];
  return typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
};

async function turnHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "private, max-age=600");
  json(res, 200, await getIceServers());
}

function imageResponse(res: Response, result: ImageResult): void {
  if (result.kind === "redirect") {
    if (result.cacheControl) res.setHeader("Cache-Control", result.cacheControl);
    res.redirect(302, result.location);
    return;
  }
  res.status(200).set({ "Content-Type": "image/png", "Cache-Control": result.cacheControl }).end(Buffer.from(result.png));
}

export async function notificationIconHandler(req: Request, res: Response): Promise<void> {
  imageResponse(res, await renderNotificationIcon({ u: q(req, "u"), n: q(req, "n"), k: q(req, "k") }));
}

async function shareCardHandler(req: Request, res: Response): Promise<void> {
  imageResponse(res, await renderShareCard({ ogstore: q(req, "ogstore"), ogprod: q(req, "ogprod"), ogpkg: q(req, "ogpkg") }));
}

/** Link-preview HTML. `override` supplies the id for the short /s/, /p/, /k/ links. */
export async function sharePreviewHandler(req: Request, res: Response, override: PreviewQuery = {}): Promise<void> {
  try {
    const query: PreviewQuery = { storefront: q(req, "storefront"), product: q(req, "product"), package: q(req, "package"), ...override };
    const html = await renderSharePreview(query, req.get("host") ?? "", req.path);
    res.status(200).type("html").send(html);
  } catch {
    res.status(500).end();
  }
}

async function accountsEntry(req: Request, res: Response): Promise<void> {
  if (req.method === "GET") {
    if (q(req, "turn") === "1") return turnHandler(req, res);
    if (q(req, "nicon") === "1") return notificationIconHandler(req, res);
    if (["ogstore", "ogprod", "ogpkg"].some((k) => req.query[k] !== undefined)) return shareCardHandler(req, res);
    return sharePreviewHandler(req, res);
  }
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  return respond(res, async () => handleAccountAction(await readJsonBody(req)), {
    fallback: "Could not complete the account request.",
    log: "Levromart account API error:",
  });
}

export const accountsController = Router()
  .all("/delete-account", accountsEntry)
  .all("/register", accountsEntry)
  .all("/account-exists", accountsEntry)
  // Previously a rewrite to /api/delete-account?turn=1. Only GET is meaningful here.
  .get("/turn", turnHandler)
  .all("/turn", (_req, res) => json(res, 405, { error: "Method not allowed." }))
  // Previously a rewrite to /api/delete-account?nicon=1.
  .get("/notif-icon", notificationIconHandler);
