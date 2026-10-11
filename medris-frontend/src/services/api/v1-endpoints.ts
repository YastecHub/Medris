import type { AddToCartRequest, CartItem, CatalogueRow, FavoritesResponse, FollowsResponse, MarkNotificationsRequest, MeResponse, NotificationRowV1, SessionInfo } from "@medris/contracts";
import { v1Request } from "./v1-client";

/** Typed /api/v1 endpoints (see medris-backend/src/routes/v1.ts). */
export const v1 = {
  session: () => v1Request<SessionInfo>("GET", "auth/session"),
  me: () => v1Request<MeResponse>("GET", "me"),

  catalogue: {
    sectors: (order: "sort_order" | "name" = "sort_order") => v1Request<CatalogueRow[]>("GET", "catalogue/sectors", { query: { order }, auth: false }),
    categories: (sectorId?: string) => v1Request<CatalogueRow[]>("GET", "catalogue/categories", { query: { sectorId }, auth: false }),
  },

  cart: {
    list: () => v1Request<CartItem[]>("GET", "cart"),
    count: () => v1Request<{ count: number }>("GET", "cart/count"),
    add: (body: AddToCartRequest) => v1Request<{ result: unknown }>("POST", "cart/items", { body }),
    setQuantity: (itemId: string, quantity: number) => v1Request<{ id: string; quantity: number }>("PATCH", `cart/items/${encodeURIComponent(itemId)}`, { body: { quantity } }),
    remove: (itemId: string) => v1Request<{ removed: number }>("DELETE", `cart/items/${encodeURIComponent(itemId)}`),
    removeMany: (ids: string[]) => v1Request<{ removed: number }>("POST", "cart/items/delete", { body: { ids } }),
    clear: () => v1Request<{ removed: number }>("DELETE", "cart"),
  },

  favorites: {
    get: () => v1Request<FavoritesResponse>("GET", "favorites"),
    saveProduct: (id: string) => v1Request<{ saved: boolean }>("PUT", `favorites/products/${encodeURIComponent(id)}`),
    unsaveProduct: (id: string) => v1Request<{ saved: boolean }>("DELETE", `favorites/products/${encodeURIComponent(id)}`),
    savePackage: (id: string) => v1Request<{ saved: boolean }>("PUT", `favorites/packages/${encodeURIComponent(id)}`),
    unsavePackage: (id: string) => v1Request<{ saved: boolean }>("DELETE", `favorites/packages/${encodeURIComponent(id)}`),
  },

  follows: {
    get: () => v1Request<FollowsResponse>("GET", "follows"),
    state: (vendorId: string) => v1Request<{ following: boolean }>("GET", `follows/${encodeURIComponent(vendorId)}`),
    set: (vendorId: string, following: boolean) => v1Request<{ following: boolean; result: unknown }>("PUT", `follows/${encodeURIComponent(vendorId)}`, { body: { following } }),
    unfollow: (vendorId: string) => v1Request<{ removed: number }>("DELETE", `follows/${encodeURIComponent(vendorId)}`),
  },

  notifications: {
    list: (readSince?: string, limit?: number) => v1Request<NotificationRowV1[]>("GET", "notifications", { query: { readSince, limit } }),
    unreadCount: (filter: { type?: string; after?: string } = {}) => v1Request<{ count: number }>("GET", "notifications/unread-count", { query: filter }),
    recentUnread: (limit = 5) => v1Request<NotificationRowV1[]>("GET", "notifications/recent-unread", { query: { limit } }),
    mark: (body: MarkNotificationsRequest) => v1Request<{ updated: number }>("POST", "notifications/read", { body }),
  },
};

export type V1Api = typeof v1;
