import { Router } from "express";
import { methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { handleNotify, type NotifyBody } from "./notify-request.service.js";

/** POST /api/notify - contract: notify.routes.ts. */
export const notifyController = Router().all("/notify", (req, res) =>
  req.method !== "POST" ? methodNotAllowed(res) : respond(res, async () => handleNotify(await readJsonBody<NotifyBody>(req), req.get("x-webhook-secret"))),
);
