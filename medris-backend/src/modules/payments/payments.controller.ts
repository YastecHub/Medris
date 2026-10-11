import { Router } from "express";
import { methodNotAllowed, readJsonBody, requestOrigin } from "../../lib/http.js";
import { readBodyText } from "../../shared/http/body.js";
import { respond } from "../../shared/legacy.js";
import { handlePaystackWebhook, initiatePayment, verifyPayment } from "./payments.service.js";

/** Order card payments through Paystack - contract: payments.routes.ts. */
export const paymentsController = Router()
  .all("/initiate-payment", (req, res) =>
    req.method !== "POST" ? methodNotAllowed(res) : respond(res, async () => initiatePayment(await readJsonBody(req), requestOrigin(req))),
  )
  .all("/verify-payment", (req, res) => respond(res, () => verifyPayment(typeof req.query.reference === "string" ? req.query.reference : undefined)))
  .all("/paystack-webhook", (req, res) =>
    req.method !== "POST"
      ? void res.status(405).end()
      : respond(res, async () => handlePaystackWebhook(await readBodyText(req), req.get("x-paystack-signature")), { log: "[paystack-webhook]" }),
  );
