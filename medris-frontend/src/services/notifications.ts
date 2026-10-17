import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads for the notifications page, for React screens.
 *
 * Asks exactly what the legacy renderNotifPanel() asks (src/legacy/assets/js/01-app/20-notifications-real-persisted-realtime.js:143):
 * the panel list through the data gateway (levroData.notifications.panel: every unread one plus the last 30 days of read
 * ones, newest first), and for notifications that point at a product or package, who owns that listing (two reads, remembered
 * for the whole session in window.__notifOwnerCache). It keeps the same shared caches the legacy code keeps
 * (window.__notifRaw for tab switches, the localStorage first-paint cache) so both versions can hand over to each other.
 * Nothing is written to the database here.
 */
declare const sb: SupabaseClient;

export interface NotificationRow {
  id: string;
  title?: string | null;
  body?: string | null;
  type?: string | null;
  notification_type?: string | null;
  notification_category?: string | null;
  read?: boolean | null;
  created_at: string;
  target_view?: string | null;
  target_params?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  vendor_id?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
}

interface RawCache {
  uid: string;
  at: number;
  items: NotificationRow[];
  owners: Map<string, string>;
}

declare global {
  interface Window {
    __notifRaw?: RawCache;
    __notifOwnerCache?: Map<string, string>;
    __notifPanelIds?: string[];
  }
}

export const notificationCacheKey = (userId: string) => `levromart-notifications-cache-v2:${userId}`;

/** The rows the legacy code painted instantly from the last visit (same key, same shape). */
export function readCachedNotifications(userId: string): NotificationRow[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(notificationCacheKey(userId)) || "[]");
    return Array.isArray(parsed) ? (parsed as NotificationRow[]) : [];
  } catch {
    return [];
  }
}

/** The list from the last load, if it is for this user and under five minutes old (used when only the tab changed). */
export function reusableRaw(userId: string): RawCache | null {
  const raw = window.__notifRaw;
  return raw && raw.uid === userId && Date.now() - raw.at < 300000 ? raw : null;
}

export interface LoadedNotifications {
  items: NotificationRow[];
  owners: Map<string, string>;
  error: unknown;
}

const listingId = (kind: "product" | "package", n: NotificationRow): unknown => {
  const p = (n.target_params || {}) as Record<string, unknown>;
  const m = (n.metadata || {}) as Record<string, unknown>;
  return kind === "product" ? p.productId || p.product_id || m.product_id : p.packageId || p.package_id || m.package_id;
};

export async function loadNotifications(userId: string, reuse: RawCache | null): Promise<LoadedNotifications> {
  const readSince = new Date(Date.now() - 30 * 86400000).toISOString();
  let rawItems: NotificationRow[] | null;
  let error: unknown = null;
  if (reuse) {
    rawItems = reuse.items;
  } else {
    const result = await window.levroData!.notifications.panel(userId, readSince);
    rawItems = (result.data as NotificationRow[] | null) ?? null;
    error = result.error;
    if (!error && Array.isArray(rawItems)) {
      try {
        localStorage.setItem(notificationCacheKey(userId), JSON.stringify(rawItems.slice(0, 150)));
      } catch {
        /* storage full or blocked */
      }
    }
  }
  const owners = new Map<string, string>();
  if (reuse?.owners) reuse.owners.forEach((v, k) => owners.set(k, v));
  else {
    await Promise.all(
      (
        [
          ["product", "products"],
          ["package", "vendor_packages"],
        ] as const
      ).map(async ([kind, table]) => {
        // Listing owners never change, so remember them for the whole session.
        const ownerCache = (window.__notifOwnerCache ||= new Map<string, string>());
        const ids = [...new Set((rawItems || []).map((n) => listingId(kind, n)).filter(Boolean) as string[])];
        ids.forEach((id) => {
          const c = ownerCache.get(`${kind}:${id}`);
          if (c) owners.set(`${kind}:${id}`, c);
        });
        const missing = ids.filter((id) => !ownerCache.has(`${kind}:${id}`));
        if (!missing.length) return;
        const { data, error: ownerError } = await sb.from(table).select("id,vendor_id").in("id", missing);
        if (ownerError) console.warn("Notification ownership lookup failed", ownerError);
        ((data as Array<{ id: string; vendor_id: string }> | null) || []).forEach((r) => {
          const v = String(r.vendor_id);
          owners.set(`${kind}:${r.id}`, v);
          ownerCache.set(`${kind}:${r.id}`, v);
        });
      }),
    );
  }
  if (!reuse && Array.isArray(rawItems)) window.__notifRaw = { uid: userId, at: Date.now(), items: rawItems, owners: new Map(owners) };
  return { items: rawItems || [], owners, error };
}
