import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the storefront screen reads, for React.
 *
 * Asks Supabase exactly what the legacy renderStorefrontInner() asks (src/legacy/assets/js/01-app/59-storefront-public-vendor-page.js:332):
 * the vendor and the product catalogue in parallel, then (once the vendor is known) the four secondary panels
 * (stats, reviews, packages, follow state) as independent requests. Same select strings, filters and order, through
 * the existing global client `sb`.
 */
declare const sb: SupabaseClient;

export interface StorefrontVendor {
  id: string;
  user_id?: string | null;
  business_name?: string | null;
  previous_business_name?: string | null;
  name_changed_at?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  bio?: string | null;
  address?: string | null;
  city?: string | null;
  cac_number?: string | null;
  opening_hours?: string | null;
  created_at?: string | null;
  is_active?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  delivery_fee?: number | null;
  delivery_fee_mode?: string | null;
  delivery_fee_per_km?: number | null;
  verification_status?: string | null;
  sector?: { name?: string | null; icon?: string | null } | null;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  is_service?: boolean | null;
  sale_price?: number | null;
  rental_rate?: number | null;
  rental_rate_unit?: string | null;
  service_price_unit?: string | null;
  photos?: string[] | null;
  vendor?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const PRODUCT_COLUMNS =
  "id, name, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, payment_timing, payment_deposit_percent, delivery_fee, delivery_fee_mode, delivery_fee_per_km, category:categories(name), vendor:vendors!inner(id,business_name,verification_status,logo_url,delivery_fee,delivery_fee_mode,delivery_fee_per_km,lat,lng)";

export type StorefrontResult =
  | { kind: "not-found" }
  | { kind: "paused" }
  | { kind: "ready"; vendor: StorefrontVendor; products: StorefrontProduct[]; extras: () => Promise<StorefrontExtras> };

export interface StorefrontExtras {
  stats: unknown;
  reviews: unknown;
  packages: unknown;
  followState: unknown;
}

/** Rejects on a network failure, like the legacy function (which turns that into its "Couldn't load this storefront" card). */
export async function loadStorefront(vendorId: string): Promise<StorefrontResult> {
  const vendorPromise = sb.from("vendors").select("*, sector:sectors(name, icon)").eq("id", vendorId).eq("verification_status", "verified").maybeSingle();
  // A query builder sends its request when it is first awaited (and again on every further .then()), so, like the legacy
  // code, it is only started once the vendor is known to exist and be active (see below): a missing or paused shop never asks.
  const productsQuery = sb.from("products").select(PRODUCT_COLUMNS).eq("vendor_id", vendorId).eq("status", "active").order("created_at", { ascending: false });

  const { data, error } = await vendorPromise;
  const v = data as StorefrontVendor | null;
  if (error || !v) return { kind: "not-found" };
  if (!v.is_active) return { kind: "paused" };

  const extrasPromise = Promise.allSettled([
    sb.rpc("get_vendor_stats", { p_vendor_id: v.id }),
    sb.from("reviews").select("id, rating, comment, buyer_name, buyer_avatar_url, created_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(10),
    sb.from("vendor_packages").select("*, items:package_items(quantity, product:products(name))").eq("vendor_id", v.id).eq("status", "active").order("created_at", { ascending: false }),
    sb.rpc("get_vendor_follow_state", { p_vendor_id: v.id }),
  ]);

  const { data: products } = await productsQuery;
  // Cards need the shop's location and logo to work out delivery totals and fallbacks, so each product carries them.
  const all = ((products ?? []) as unknown as StorefrontProduct[]).map((pr) => ({
    ...pr,
    vendor: pr.vendor ?? { id: v.id, business_name: v.business_name, logo_url: v.logo_url, lat: v.lat, lng: v.lng, delivery_fee: v.delivery_fee, delivery_fee_mode: v.delivery_fee_mode, delivery_fee_per_km: v.delivery_fee_per_km, verification_status: v.verification_status },
  }));

  const extras = async (): Promise<StorefrontExtras> => {
    const labels = ["stats", "reviews", "packages", "follow state"];
    const pick = (r: PromiseSettledResult<{ data?: unknown; error?: unknown }>, i: number) => {
      if (r.status !== "fulfilled") {
        console.warn(`[Levromart] Storefront ${labels[i]} failed to load:`, r.reason);
        return null;
      }
      if (r.value?.error) {
        console.warn(`[Levromart] Storefront ${labels[i]} failed to load:`, r.value.error);
        return null;
      }
      return r.value?.data ?? null;
    };
    const results = await extrasPromise;
    const [stats, reviews, packages, followState] = results.map((r, i) => pick(r as PromiseSettledResult<{ data?: unknown; error?: unknown }>, i));
    return { stats, reviews, packages, followState };
  };
  return { kind: "ready", vendor: v, products: all, extras };
}

/** The legacy page counts a profile view for everyone but the owner (a write through the existing RPC, fire and forget). */
export function recordProfileView(vendorId: string): void {
  void Promise.resolve(sb.rpc("increment_vendor_profile_view", { p_vendor_id: vendorId })).then(
    () => undefined,
    () => undefined,
  );
}
