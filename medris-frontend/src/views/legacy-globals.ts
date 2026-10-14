import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The legacy runtime's helpers and state that migrated screens reuse instead of copying.
 *
 * Business rules stay where they are (price formatting, thumbnail sizing, distance maths, who owns a listing);
 * React calls the very same functions the legacy markup builders call. Top-level `function` declarations of the
 * legacy scripts are properties of `window`; `let`/`const` state is read as a bare global (like `sb` in the data
 * gateway), through the safe accessors below, which never throw if a script has not run.
 */
declare const sb: SupabaseClient;
declare const favoriteIds: Set<string>;
declare const buyerLocation: { lat: number; lng: number } | null;
declare const profile: { role?: string } | null;
declare const session: { user?: { id: string } } | null;
declare const vendor: { id?: string } | null;
declare let currentView: string;
declare let notifViewMode: string;
declare let notifSelectMode: boolean;
declare let notifSelectedIds: Set<string>;
declare let notifCount: number;
declare let notifRenderEpoch: number;
declare let lastNotificationReturnView: string;
declare let lastNotificationReturnParams: Record<string, unknown>;
declare let searchPageFilter: string;
declare let storefrontCatalogTab: string;
declare let storefrontViewMode: string;

type Fn<A extends unknown[], R> = (...args: A) => R;

export interface LegacyHelpers {
  naira: Fn<[unknown], string>;
  lvThumb: Fn<[string, number], string>;
  lvInitials: Fn<[string], string>;
  isOwnVendorId: Fn<[unknown], boolean>;
  haversineKm: Fn<[number, number, number, number], number>;
  distanceDeliveryFee: Fn<[number, number], number>;
  lvDistTier: Fn<[number], number>;
  lvDistTitle: Fn<[number], string>;
  toggleFavorite: Fn<[unknown, string], unknown>;
  handleProductImageTap: Fn<[unknown, string], unknown>;
  quickAddToCart: Fn<[unknown, string, unknown, string], unknown>;
  openPackageImageLightbox: Fn<[string, unknown], unknown>;
  openPackageCommentsFromCard: Fn<[string], unknown>;
  hydrateProductCommentCountsInView: Fn<[], unknown>;
  hydratePackageCommentCountsInView: Fn<[], unknown>;
  hydrateProductVariantIndicatorsInView: Fn<[], unknown>;
  hydrateProductLikeCountsInView: Fn<[], unknown>;
  hydrateProductRatingsInView: Fn<[], unknown>;
  timeAgo: Fn<[string], string>;
  maskSensitiveNumbers: Fn<[string], string>;
  initials: Fn<[string, string?], string>;
  stableAvatarHue: Fn<[string], number>;
  notificationSystemIconHtml: Fn<[unknown], string>;
  queueVisibleNotificationReads: Fn<[], unknown>;
  queueNotificationRead: Fn<[string], unknown>;
  handleNotifItemClick: Fn<[unknown, string], unknown>;
  switchNotifView: Fn<[string], unknown>;
  exitNotifSelectMode: Fn<[boolean?], unknown>;
  toggleSelectAllNotifs: Fn<[], unknown>;
  batchMarkNotifsRead: Fn<[boolean], unknown>;
  closeAllPanels: Fn<[], unknown>;
  byId: Fn<[string], HTMLElement | null>;
  readSearchHistory: Fn<[], string[]>;
  renderNotifPanel: Fn<[unknown?], unknown>;
}

declare global {
  interface Window extends Partial<LegacyHelpers> {
    __productPhotoCache?: Record<string, unknown>;
  }
}

/** A legacy helper; throws a clear error (caught by the view's error boundary, which falls back to the legacy screen) if it is missing. */
export function legacy<K extends keyof LegacyHelpers>(name: K): LegacyHelpers[K] {
  const fn = window[name];
  if (typeof fn !== "function") throw new Error(`Legacy helper ${String(name)} is not available`);
  return fn as LegacyHelpers[K];
}

export const legacyState = {
  isFavorite: (id: string): boolean => {
    try {
      return typeof favoriteIds !== "undefined" && favoriteIds.has(id);
    } catch {
      return false;
    }
  },
  buyerLocation: (): { lat: number; lng: number } | null => {
    try {
      return typeof buyerLocation === "undefined" ? null : buyerLocation;
    } catch {
      return null;
    }
  },
  role: (): string | undefined => {
    try {
      return typeof profile === "undefined" ? undefined : (profile?.role ?? undefined);
    } catch {
      return undefined;
    }
  },
  userId: (): string | null => {
    try {
      return typeof session === "undefined" ? null : (session?.user?.id ?? null);
    } catch {
      return null;
    }
  },
  client: (): SupabaseClient => sb,
  vendorId: (): string => {
    try {
      return typeof vendor === "undefined" ? "" : String(vendor?.id ?? "");
    } catch {
      return "";
    }
  },
};

/**
 * The notification screen's UI state lives in legacy variables (current tab, select mode, selected ids, unread
 * counter, where Back goes). React reads them to draw, and the legacy handlers it calls change them, exactly as before.
 */
export const notifState = {
  viewMode: (): string => (typeof notifViewMode === "undefined" ? "all" : notifViewMode),
  /** The legacy renderer resets an unknown tab to "all" in the shared variable; do the same. */
  setViewMode: (mode: string): void => {
    notifViewMode = mode;
  },
  selectMode: (): boolean => (typeof notifSelectMode === "undefined" ? false : !!notifSelectMode),
  selectedIds: (): Set<string> => (typeof notifSelectedIds === "undefined" ? new Set<string>() : notifSelectedIds),
  currentView: (): string => (typeof currentView === "undefined" ? "" : currentView),
  /** The render counter the legacy code uses to drop stale renders (it bumps it too, e.g. when a batch action starts). */
  nextEpoch: (): number => (notifRenderEpoch = (typeof notifRenderEpoch === "undefined" ? 0 : notifRenderEpoch) + 1),
  epoch: (): number => (typeof notifRenderEpoch === "undefined" ? 0 : notifRenderEpoch),
  count: (): number => (typeof notifCount === "undefined" ? 0 : notifCount),
  setCount: (n: number): void => {
    notifCount = n;
  },
  backTarget: (): { view: string; params: Record<string, unknown> } => ({
    view: (typeof lastNotificationReturnView === "undefined" ? "" : lastNotificationReturnView) || "home",
    params: (typeof lastNotificationReturnParams === "undefined" ? null : lastNotificationReturnParams) || {},
  }),
};

/** The storefront screen's UI state lives in legacy variables (catalogue tab, grid/table mode); a fresh visit starts from the defaults, as in the legacy renderer. */
export const storefrontState = {
  reset: (): void => {
    try {
      storefrontCatalogTab = "products";
      storefrontViewMode = "grid";
    } catch {
      /* the legacy script has not defined them: nothing to reset */
    }
  },
  catalogTab: (): string => (typeof storefrontCatalogTab === "undefined" ? "products" : storefrontCatalogTab),
  viewMode: (): string => (typeof storefrontViewMode === "undefined" ? "grid" : storefrontViewMode),
};

/** The search page's UI state lives in a legacy variable (the active filter tab); a fresh visit starts at "All", as in the legacy renderer. */
export const searchState = {
  reset: (): void => {
    try {
      searchPageFilter = "all";
    } catch {
      /* the legacy script has not defined it: nothing to reset */
    }
  },
  filter: (): string => (typeof searchPageFilter === "undefined" ? "all" : searchPageFilter),
};
