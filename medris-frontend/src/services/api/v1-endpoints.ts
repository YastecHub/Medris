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

  payments: {
    /** Is Paystack checkout switched on? (backend switch PAYSTACK_CHECKOUT_ENABLED) */
    config: () => v1Request<{ paystackCheckout: boolean }>("GET", "payments/config"),
    /** Starts a Paystack payment for the order; the server decides the amount (order amount + Paystack's fee). */
    initializePaystack: (orderId: string) => v1Request<PaystackInitializeResult>("POST", `orders/${encodeURIComponent(orderId)}/paystack/initialize`),
    /** Where the payment stands; settles it first when it is still open. */
    paystackStatus: (reference: string) => v1Request<{ status: string; orderStatus: string | null }>("GET", `payments/paystack/${encodeURIComponent(reference)}`),
    /** Paystack's bank list (cached on the server). */
    banks: () => v1Request<Array<{ code: string; name: string }>>("GET", "payments/banks"),
    /** Looks up the name on a bank account so the vendor can confirm it is theirs. */
    resolveAccount: (bankCode: string, accountNumber: string) =>
      v1Request<{ accountName: string; bankName: string; accountLast4: string }>("POST", "payments/bank-account/resolve", { body: { bankCode, accountNumber } }),
    /** Saves the vendor's own payout account after they confirmed the resolved name. */
    savePayoutAccount: (bankCode: string, accountNumber: string, confirmedAccountName: string) =>
      v1Request<{ accountName: string; bankName: string; accountLast4: string; verified: boolean }>("PUT", "shops/mine/payout-account", { body: { bankCode, accountNumber, confirmedAccountName } }),
    myPayoutAccount: () => v1Request<{ verified: boolean; accountName: string | null; bankName: string | null; accountLast4: string | null }>("GET", "shops/mine/payout-account"),
  },

  notifications: {
    list: (readSince?: string, limit?: number) => v1Request<NotificationRowV1[]>("GET", "notifications", { query: { readSince, limit } }),
    unreadCount: (filter: { type?: string; after?: string } = {}) => v1Request<{ count: number }>("GET", "notifications/unread-count", { query: filter }),
    recentUnread: (limit = 5) => v1Request<NotificationRowV1[]>("GET", "notifications/recent-unread", { query: { limit } }),
    mark: (body: MarkNotificationsRequest) => v1Request<{ updated: number }>("POST", "notifications/read", { body }),
  },
};

export interface PaystackInitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  /** What the buyer pays now (order amount plus Paystack's fee). */
  amountNaira: number;
  feeNaira: number;
  orderAmountNaira: number;
}

export type V1Api = typeof v1;
