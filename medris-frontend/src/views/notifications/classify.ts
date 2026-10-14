import type { NotificationRow } from "@/services/notifications";

/**
 * Which tab a notification belongs to: "orders", "myListings", "vendors" or "personal".
 *
 * A one-to-one port of classifyNotification() inside renderNotifPanel()
 * (src/legacy/assets/js/01-app/20-notifications-real-persisted-realtime.js:217), including its loose handling of
 * missing fields. The parity test classifies a fixture set covering every branch in both versions and compares tabs,
 * badge counts and lists.
 */
export type NotificationCategory = "orders" | "myListings" | "vendors" | "personal";

export function classifyNotification(n: NotificationRow, owners: Map<string, string>, currentVendorId: string): NotificationCategory {
  const p = (n.target_params || {}) as Record<string, unknown>;
  const m = (n.metadata || {}) as Record<string, unknown>;
  const type = String(n.type || n.notification_type || n.notification_category || "").toLowerCase();
  const kind = String(m.kind || m.entity_type || n.notification_category || type).toLowerCase();
  const owner = String(
    n.vendor_id || m.vendor_id || p.vendorId || p.vendor_id || owners.get(`product:${p.productId || p.product_id || m.product_id}`) || owners.get(`package:${p.packageId || p.package_id || m.package_id}`) || "",
  );
  if (m.order_id || p.orderId || p.order_id || /^(order|payment|request|offer)(_|$)/.test(type) || ["orderDetail", "buyerOrders", "vendorOrders"].includes(n.target_view ?? "")) return "orders";
  const listing = /product|listing|package|service|variant|variety|comment|like|save|wishlist/.test(kind) || !!p.productId || !!p.packageId;
  if (listing && owner && owner === currentVendorId) return "myListings";
  if (owner && owner !== currentVendorId && (listing || /vendor/.test(kind))) return "vendors";
  return "personal";
}
