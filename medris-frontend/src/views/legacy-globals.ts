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
};
