import type { ComponentType } from "react";

/** What every migrated screen receives: the same params object navigate(view, params) was given. */
export interface ViewProps {
  params: Record<string, unknown>;
}

export type ViewModule = { default: ComponentType<ViewProps> };

/**
 * The React screens, loaded on demand (so the legacy path pays nothing for them).
 * Add an entry here AND the name to MIGRATED_VIEWS in ./migrated.ts when a screen is converted.
 */
export const VIEW_LOADERS: Readonly<Record<string, () => Promise<ViewModule>>> = {
  terms: () => import("./terms/TermsPage"),
  privacy: () => import("./privacy/PrivacyPage"),
  refundPolicy: () => import("./refund-policy/RefundPolicyPage"),
  contactUs: () => import("./contact-us/ContactUsPage"),
  customerFollowing: () => import("./customer-following/CustomerFollowingPage"),
  wishlist: () => import("./wishlist/WishlistPage"),
  notifications: () => import("./notifications/NotificationsPage"),
  sharedAiChat: () => import("./shared-ai-chat/SharedAiChatPage"),
  vendors: () => import("./vendors/VendorsPage"),
  storefront: () => import("./storefront/StorefrontPage"),
  productDetail: () => import("./product-detail/ProductDetailPage"),
  search: () => import("./search/SearchPage"),
};
