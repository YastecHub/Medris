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
    /** Pays all owed commission by card (issue #100). Returns the Paystack page to send the vendor to. */
    payCommission: () => v1Request<{ authorizationUrl: string; accessCode: string; reference: string; amountNaira: number }>("POST", "shops/mine/commission/paystack/initialize"),
    /** Pays a listing's ₦999 monthly fee by card (issue #100). */
    payListing: (kind: "product" | "package", listingId: string) =>
      v1Request<{ authorizationUrl: string; accessCode: string; reference: string; amountNaira: number } | { alreadyActive: true; paidUntil: string | null }>("POST", `listings/${kind}/${encodeURIComponent(listingId)}/paystack/initialize`),
    /** Paystack's bank list (cached on the server). */
    banks: () => v1Request<Array<{ code: string; name: string }>>("GET", "payments/banks"),
    /** Looks up the name on a bank account so the vendor can confirm it is theirs. */
    resolveAccount: (bankCode: string, accountNumber: string) =>
      v1Request<{ accountName: string; bankName: string; accountLast4: string }>("POST", "payments/bank-account/resolve", { body: { bankCode, accountNumber } }),
    /** Saves the vendor's own payout account after they confirmed the resolved name. */
    savePayoutAccount: (bankCode: string, accountNumber: string, confirmedAccountName: string) =>
      v1Request<{ accountName: string; bankName: string; accountLast4: string; verified: boolean }>("PUT", "shops/mine/payout-account", { body: { bankCode, accountNumber, confirmedAccountName } }),
    /** The shop's payouts, newest first (issue #98). */
    myPayouts: () =>
      v1Request<Array<{ id: string; orderId: string; amount: number; commission: number; status: string; holdReason: string | null; createdAt: string; updatedAt: string }>>("GET", "shops/mine/payouts", { query: { limit: 30 } }),
    myPayoutAccount: () => v1Request<{ verified: boolean; accountName: string | null; bankName: string | null; accountLast4: string | null }>("GET", "shops/mine/payout-account"),
  },

  /** The admin Payments area (issues #98, #99, #101). Admins only. */
  adminPayments: {
    summary: () => v1Request<Record<string, unknown>>("GET", "admin/payments/summary"),
    transactions: (query: Record<string, string | number | undefined>) => v1Request<Array<Record<string, unknown>>>("GET", "admin/payments/transactions", { query }),
    refunds: (query: Record<string, string | number | undefined>) => v1Request<Array<Record<string, unknown>>>("GET", "admin/payments/refunds", { query }),
    reports: () => v1Request<Array<Record<string, unknown>>>("GET", "admin/payments/reconciliation"),
    payouts: (query: Record<string, string | number | undefined>) => v1Request<Array<Record<string, unknown>>>("GET", "admin/payouts", { query }),
    release: (id: string) => v1Request<{ id: string; status: string }>("POST", `admin/payouts/${encodeURIComponent(id)}/release`),
    hold: (id: string, reason: string) => v1Request<{ id: string; status: string }>("POST", `admin/payouts/${encodeURIComponent(id)}/hold`, { body: { reason } }),
    markManual: (id: string, note: string) => v1Request<{ id: string; status: string }>("POST", `admin/payouts/${encodeURIComponent(id)}/mark-manual`, { body: { note } }),
    refund: (orderId: string, body: { amountNaira?: number; reason: string }) => v1Request<{ orderId: string; amount: number; status: string }>("POST", `admin/orders/${encodeURIComponent(orderId)}/refund`, { body }),
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
