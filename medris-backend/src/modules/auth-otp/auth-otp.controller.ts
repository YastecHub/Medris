import { Router } from "express";
import { methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { handleAuthOtp } from "./auth-otp.service.js";

/** POST /api/auth-otp - contract: auth-otp.routes.ts. */
export const authOtpController = Router().all("/auth-otp", (req, res) =>
  req.method !== "POST" ? methodNotAllowed(res) : respond(res, async () => handleAuthOtp(await readJsonBody(req))),
);
