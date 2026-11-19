import { Router, type Request, type Response } from "express";
import { methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { currentLevi } from "./current-levi.js";
import { handleLeviRequest, type LeviRequest } from "./levi.service.js";

/**
 * POST /api/chat - contract: levi.routes.ts. Runs Levi's current brain (api/chat.js, see current-levi.ts) when this
 * deployment has it, otherwise the TypeScript port. Unexpected errors never reveal their message.
 */
async function chat(req: Request, res: Response): Promise<void> {
  const latest = currentLevi();
  if (latest) {
    try {
      await latest(req, res);
    } catch (err) {
      console.error("[Levromart] Levi handler error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Levi could not complete that request." });
    }
    return;
  }
  if (req.method !== "POST") return methodNotAllowed(res);
  return respond(res, async () => handleLeviRequest(await readJsonBody<LeviRequest>(req)), {
    fallback: "Levi could not complete that request.",
    hideMessage: true,
    log: "[Levromart] Levi handler error:",
  });
}

export const leviController = Router()
  .all("/chat", (req, res) => void chat(req, res))
  // the voice screen also tries this older address
  .all("/chat.js", (req, res) => void chat(req, res));
