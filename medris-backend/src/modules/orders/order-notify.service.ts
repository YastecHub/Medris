import { getDataContext } from "../../database/index.js";
import { OrdersRepository } from "../../database/repositories/orders.repository.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { identityFromAccessToken } from "../auth/caller.js";

/**
 * POST /api/order-notify { orderId, eventType, accessToken }
 *
 * Order e-mails were never implemented: the original api/order-notify.js
 * imported a `sendOrderEmails` helper that did not exist, so every call ended
 * in a 500 after authorisation. Nothing in the app calls this route. It is
 * kept (same checks, same outcome) until order e-mails are built.
 */
export async function orderNotify(body: { orderId?: string; eventType?: string; accessToken?: string }): Promise<ServiceResult> {
  const { orderId, eventType, accessToken } = body;
  if (!orderId || !eventType || !accessToken) return { status: 400, body: { error: "orderId, eventType and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  const order = await getDataContext().asService((tx) => new OrdersRepository(tx).parties(orderId));
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.buyer_id !== me.userId && order.vendor_user_id !== me.userId) return { status: 403, body: { error: "Not authorized for this order" } };
  return { status: 500, body: { error: "Order e-mails are not implemented." } };
}
