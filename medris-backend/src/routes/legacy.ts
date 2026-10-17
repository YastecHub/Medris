import { Router } from "express";
import { accountsController } from "../modules/accounts/accounts.controller.js";
import { accountsDocs } from "../modules/accounts/accounts.routes.js";
import { authOtpController } from "../modules/auth-otp/auth-otp.controller.js";
import { authOtpDocs } from "../modules/auth-otp/auth-otp.routes.js";
import { cronController } from "../modules/cron/cron.controller.js";
import { cronDocs } from "../modules/cron/cron.routes.js";
import { leviController } from "../modules/levi/levi.controller.js";
import { leviDocs } from "../modules/levi/levi.routes.js";
import { notifyController } from "../modules/notify/notify.controller.js";
import { notifyDocs } from "../modules/notify/notify.routes.js";
import { ordersController } from "../modules/orders/orders.controller.js";
import { ordersDocs } from "../modules/orders/orders.routes.js";
import { paymentsController } from "../modules/payments/payments.controller.js";
import { paymentsDocs } from "../modules/payments/payments.routes.js";
import { vendorPaymentsController } from "../modules/vendor-payments/vendor-payments.controller.js";
import { vendorPaymentsDocs } from "../modules/vendor-payments/vendor-payments.routes.js";
import type { RouteDefinition } from "../shared/http/route.js";

/**
 * The original endpoints (/api/notify, /api/chat, /api/delete-account, ...)
 * with their historic paths, request bodies and response shapes. Each module
 * is a slim controller over its services; the definitions in
 * `<module>.routes.ts` describe them in the OpenAPI document without
 * validating anything, so behaviour is exactly as before.
 */
export const legacyDefinitions: RouteDefinition[] = [
  ...accountsDocs,
  ...authOtpDocs,
  ...leviDocs,
  ...cronDocs,
  ...paymentsDocs,
  ...notifyDocs,
  ...ordersDocs,
  ...vendorPaymentsDocs,
];

export function legacyApi(): Router {
  return Router()
    .use(accountsController)
    .use(authOtpController)
    .use(leviController)
    .use(cronController)
    .use(paymentsController)
    .use(notifyController)
    .use(ordersController)
    .use(vendorPaymentsController);
}
