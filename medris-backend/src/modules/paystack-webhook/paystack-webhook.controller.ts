import { readBodyText } from "../../shared/http/body.js";
import { controller, json } from "../../shared/http/route.js";
import * as routes from "./paystack-webhook.routes.js";

/** /api/v1/payments/paystack/webhook - see paystack-webhook.routes.ts. */
export const paystackWebhookController = controller().route(routes.paystackWebhook, async ({ req, services }) => {
  const result = await services.paystackWebhook.handle(await readBodyText(req), req.get("x-paystack-signature"));
  // error answers (400/401/500) are documented in the route; the handler type only knows the 200 body
  return json(result.body as { received: true; result: string }, result.status);
});
