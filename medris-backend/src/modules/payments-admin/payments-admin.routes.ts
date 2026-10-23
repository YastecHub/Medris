import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** The admin Payments area (issue #101). Admins only. */

const tags = ["Admin payments"];
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) });
const dates = { from: z.string().datetime().optional(), to: z.string().datetime().optional() };
const rows = (name: string) => dataResponse(z.array(z.record(z.string(), z.unknown())).openapi(name), "Newest first.");

export const summary = defineRoute({
  method: "get",
  path: "/admin/payments/summary",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Money in and out (today, 7 days, 30 days) and what needs attention",
  responses: { 200: dataResponse(z.record(z.string(), z.unknown()).openapi("PaymentsSummary"), "Totals in naira and a health block."), ...errorResponses(401, 403), ...commonErrors },
});

export const transactions = defineRoute({
  method: "get",
  path: "/admin/payments/transactions",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Paystack payments (orders, listing fees, commission)",
  request: {
    query: page.extend({
      status: z.enum(["initialized", "success", "failed", "abandoned", "refunded", "partially_refunded"]).optional(),
      purpose: z.enum(["order_payment", "order_balance", "listing_fee", "commission"]).optional(),
      vendorId: z.string().uuid().optional(),
      orderId: z.string().uuid().optional(),
      ...dates,
    }),
  },
  responses: { 200: rows("PaymentsTransactions"), ...errorResponses(400, 401, 403), ...commonErrors },
});

export const refunds = defineRoute({
  method: "get",
  path: "/admin/payments/refunds",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Refunds",
  request: {
    query: page.extend({
      status: z.enum(["pending", "processing", "processed", "failed"]).optional(),
      vendorId: z.string().uuid().optional(),
      orderId: z.string().uuid().optional(),
      ...dates,
    }),
  },
  responses: { 200: rows("PaymentsRefunds"), ...errorResponses(400, 401, 403), ...commonErrors },
});

export const reconciliation = defineRoute({
  method: "get",
  path: "/admin/payments/reconciliation",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Daily Paystack checks, newest first",
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(60).default(14) }) },
  responses: { 200: rows("PaymentsReconciliation"), ...errorResponses(400, 401, 403), ...commonErrors },
});
