import { Router, type RequestHandler } from "express";
import { json } from "../../lib/http.js";
import { requireCronSecret } from "../../middleware/cron-auth.js";
import { respond } from "../../shared/legacy.js";
import { runDailyCron } from "./cron.service.js";

/** GET|POST /api/daily-cron (Vercel Cron) - contract: cron.routes.ts. */
const run: RequestHandler = (_req, res) => respond(res, () => runDailyCron(), { log: "[daily-cron]" });

export const cronController = Router()
  .get("/daily-cron", requireCronSecret, run)
  .post("/daily-cron", requireCronSecret, run)
  .all("/daily-cron", (_req, res) => json(res, 405, { error: "Method not allowed" }));
