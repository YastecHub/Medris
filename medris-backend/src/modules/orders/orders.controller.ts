import { Router } from "express";
import { methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { requireBearerCronSecret } from "../../middleware/cron-auth.js";
import { respond } from "../../shared/legacy.js";
import { orderNotify } from "./order-notify.service.js";
import { runPayoutAction } from "./payout-actions.service.js";
import { runOrderReminders } from "./reminders.service.js";

/** Order actions, reminders and (unimplemented) order e-mails - contract: orders.routes.ts. */
export const ordersController = Router()
  .all("/order-payout-action", (req, res) => (req.method !== "POST" ? methodNotAllowed(res) : respond(res, async () => runPayoutAction(await readJsonBody(req)))))
  .all("/order-reminders", requireBearerCronSecret, (_req, res) => respond(res, () => runOrderReminders()))
  .all("/order-notify", (req, res) => (req.method !== "POST" ? methodNotAllowed(res) : respond(res, async () => orderNotify(await readJsonBody(req)))));
