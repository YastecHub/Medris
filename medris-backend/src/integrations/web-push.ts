import webpush from "web-push";
import { vapidPublicKey } from "../config/env.js";

/** Web Push (VAPID). The private key never leaves the server. */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export function configureVapid(privateKey: string): void {
  webpush.setVapidDetails("mailto:support@levromart.app", vapidPublicKey(), privateKey);
}

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  options: { urgency: "high"; TTL: number },
): Promise<void> {
  await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth_key } }, payload, options);
}

/** Which push service a subscription belongs to (used to de-duplicate reminders per device type). */
export function pushServiceKind(endpoint: unknown): "android" | "apple" | "firefox" | "other" {
  const e = String(endpoint);
  if (/fcm\.googleapis|android/.test(e)) return "android";
  if (/push\.apple/.test(e)) return "apple";
  if (/mozilla/.test(e)) return "firefox";
  return "other";
}
