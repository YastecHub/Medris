import { Router } from "express";
import { methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { handleLeviRequest, type LeviRequest } from "./levi.service.js";

/** POST /api/chat - contract: levi.routes.ts. Unexpected errors never reveal their message. */
export const leviController = Router().all("/chat", (req, res) =>
  req.method !== "POST"
    ? methodNotAllowed(res)
    : respond(res, async () => handleLeviRequest(await readJsonBody<LeviRequest>(req)), {
        fallback: "Levi could not complete that request.",
        hideMessage: true,
        log: "[Levromart] Levi handler error:",
      }),
);
