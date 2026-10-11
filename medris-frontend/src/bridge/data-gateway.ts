/**
 * levroData: the legacy app's data gateway.
 *
 * Built as a classic script (assets/js/00-data-gateway.js) that loads before
 * the legacy runtime, so every legacy call site can use it at any time.
 * Each method does what one Supabase query in the legacy code did and returns
 * the same `{ data, error, count }` shape, so call sites only change one line.
 *
 * Per feature (services/backend-features.ts):
 *   on  -> the request goes to medris-backend (/api/v1), which validates it,
 *          authorises it and runs it against PostgreSQL under the user's
 *          identity (all RLS policies still apply);
 *   off -> the exact Supabase query the call site used before (the default,
 *          so a build without VITE_BACKEND_FEATURES behaves as today).
 *
 * Reads and idempotent writes fall back to the Supabase query when the
 * backend is unreachable (network error, 502/503/504) so a backend outage
 * during the roll-out never blocks users; non-idempotent writes (add to cart,
 * save to wishlist) never retry through a second path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { v1 } from "@/services/api/v1-endpoints";
import { V1Error } from "@/services/api/v1-client";
import { BACKEND_FEATURES, enabledFeatures, parseFeatureList, writeFeatureOverride, type BackendFeature } from "@/services/backend-features";

declare const sb: SupabaseClient;

export interface GatewayError {
  message: string;
  code: string;
  details?: unknown;
  status?: number;
}

export interface GatewayResult<T> {
  data: T | null;
  error: GatewayError | null;
  count?: number | null;
}

type Legacy<T> = () => PromiseLike<GatewayResult<T>>;

let features = enabledFeatures(import.meta.env.VITE_BACKEND_FEATURES);
const warned = new Set<string>();

function toGatewayError(err: unknown): GatewayError {
  if (err instanceof V1Error) return { message: err.message, code: err.code, details: err.details, status: err.status };
  return { message: "Something went wrong. Please try again.", code: "client_error" };
}

async function route<T>(feature: BackendFeature, backend: () => Promise<GatewayResult<T>>, legacy: Legacy<T>, canFallBack: boolean): Promise<GatewayResult<T>> {
  if (!features.has(feature)) return legacy();
  try {
    return await backend();
  } catch (err) {
    if (canFallBack && err instanceof V1Error && err.isUnavailable) {
      if (!warned.has(feature)) {
        warned.add(feature);
        console.warn(`[levroData] backend unavailable for "${feature}" (${err.status}); using Supabase directly for now.`);
      }
      return legacy();
    }
    return { data: null, error: toGatewayError(err), count: null };
  }
}

const ok = <T>(data: T, count?: number): GatewayResult<T> => ({ data, error: null, ...(count === undefined ? {} : { count }) });

/**
 * Shares one request between calls made at the same moment: sign-in loads
 * product and package favourites in parallel, and both come from one
 * /api/v1/favorites response.
 */
const inFlight = new Map<string, { at: number; promise: Promise<unknown> }>();
function shared<T>(key: string, load: () => Promise<T>, windowMs = 1500): Promise<T> {
  const now = Date.now();
  const hit = inFlight.get(key);
  if (hit && now - hit.at < windowMs) return hit.promise as Promise<T>;
  const promise = load();
  inFlight.set(key, { at: now, promise });
  promise.catch(() => inFlight.delete(key));
  return promise;
}
const forget = (key: string) => inFlight.delete(key);
const read = <T>(feature: BackendFeature, backend: () => Promise<GatewayResult<T>>, legacy: Legacy<T>) => route(feature, backend, legacy, true);
const idempotentWrite = read;
const write = <T>(feature: BackendFeature, backend: () => Promise<GatewayResult<T>>, legacy: Legacy<T>) => route(feature, backend, legacy, false);

const CART_SELECT =
  "id, variant_id, quantity, created_at, variant:product_variants(*), product:products(id, name, sale_price, discount_price, photos, quantity_available, status, delivery_fee, delivery_fee_mode, delivery_fee_per_km, vendor:vendors(id, business_name, previous_business_name, name_changed_at, is_active, verification_status, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng))";

/* ------------------------------------------------------------------ cart */

const cart = {
  list: (buyerId: string) =>
    read(
      "cart",
      async () => ok(await v1.cart.list()),
      () => sb.from("cart_items").select(CART_SELECT).eq("buyer_id", buyerId).order("created_at", { ascending: true }) as PromiseLike<GatewayResult<unknown[]>>,
    ),
  count: (buyerId: string) =>
    read(
      "cart",
      async () => {
        const { count } = await v1.cart.count();
        return ok(null, count);
      },
      () => sb.from("cart_items").select("id", { count: "exact", head: true }).eq("buyer_id", buyerId) as PromiseLike<GatewayResult<null>>,
    ),
  add: (productId: string, quantity: number, variantId: string | null = null) =>
    write(
      "cart",
      async () => ok((await v1.cart.add({ productId, quantity, variantId })).result),
      () => sb.rpc("add_to_cart", { p_product_id: productId, p_quantity: quantity, p_variant_id: variantId }) as PromiseLike<GatewayResult<unknown>>,
    ),
  setQuantity: (itemId: string, quantity: number) =>
    idempotentWrite(
      "cart",
      async () => ok(await v1.cart.setQuantity(itemId, quantity)),
      () => sb.from("cart_items").update({ quantity }).eq("id", itemId) as PromiseLike<GatewayResult<unknown>>,
    ),
  remove: (itemId: string) =>
    idempotentWrite(
      "cart",
      async () => ok(await v1.cart.remove(itemId)),
      () => sb.from("cart_items").delete().eq("id", itemId) as PromiseLike<GatewayResult<unknown>>,
    ),
  removeMany: (itemIds: string[]) =>
    idempotentWrite(
      "cart",
      async () => (itemIds.length ? ok(await v1.cart.removeMany(itemIds)) : ok({ removed: 0 })),
      () => sb.from("cart_items").delete().in("id", itemIds) as PromiseLike<GatewayResult<unknown>>,
    ),
  clear: (buyerId: string) =>
    idempotentWrite(
      "cart",
      async () => ok(await v1.cart.clear()),
      () => sb.from("cart_items").delete().eq("buyer_id", buyerId) as PromiseLike<GatewayResult<unknown>>,
    ),
};

/* --------------------------------------------------------- notifications */

const notifications = {
  /** The panel: every unread one plus read ones since `readSince`, newest first, at most 150. */
  panel: (userId: string, readSince: string) =>
    read(
      "notifications",
      async () => ok(await v1.notifications.list(readSince, 150)),
      () =>
        sb
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .or(`read.eq.false,created_at.gte.${readSince}`)
          .order("created_at", { ascending: false })
          .limit(150) as PromiseLike<GatewayResult<unknown[]>>,
    ),
  unreadCount: (userId: string) =>
    read(
      "notifications",
      async () => ok(null, (await v1.notifications.unreadCount()).count),
      () =>
        sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("archived", false).eq("read", false).is("deleted_at", null) as PromiseLike<
          GatewayResult<null>
        >,
    ),
  /** Unread "new offer" notifications newer than `after` (the request-offers badge). */
  offerCount: (userId: string, after: string) =>
    read(
      "notifications",
      async () => ok(null, (await v1.notifications.unreadCount({ type: "new_offer", after })).count),
      () =>
        sb
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "new_offer")
          .eq("read", false)
          .eq("archived", false)
          .is("deleted_at", null)
          .gt("created_at", after) as PromiseLike<GatewayResult<null>>,
    ),
  recentUnread: (userId: string, limit = 5) =>
    read(
      "notifications",
      async () => ok(await v1.notifications.recentUnread(limit)),
      () =>
        sb.from("notifications").select("id,type,created_at,target_params").eq("user_id", userId).eq("read", false).order("created_at", { ascending: false }).limit(limit) as PromiseLike<
          GatewayResult<unknown[]>
        >,
    ),
  setRead: (ids: string[], read: boolean) =>
    idempotentWrite(
      "notifications",
      async () => ok(await v1.notifications.mark({ ids, read })),
      () => sb.from("notifications").update({ read }).in("id", ids) as PromiseLike<GatewayResult<unknown>>,
    ),
  markRead: (id: string) =>
    idempotentWrite(
      "notifications",
      async () => ok(await v1.notifications.mark({ ids: [id], read: true })),
      () => sb.from("notifications").update({ read: true }).eq("id", id) as PromiseLike<GatewayResult<unknown>>,
    ),
  markReadForUser: (userId: string, ids: string[]) =>
    idempotentWrite(
      "notifications",
      async () => ok(await v1.notifications.mark({ ids, read: true })),
      () => sb.from("notifications").update({ read: true }).eq("user_id", userId).in("id", ids) as PromiseLike<GatewayResult<unknown>>,
    ),
  markAllRead: (userId: string) =>
    idempotentWrite(
      "notifications",
      async () => ok(await v1.notifications.mark({ all: true })),
      () => sb.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false).is("deleted_at", null) as PromiseLike<GatewayResult<unknown>>,
    ),
};

/* ------------------------------------------------------------ favorites */

const favorites = {
  productIds: (userId: string) =>
    read(
      "favorites",
      async () => ok((await shared("favorites", v1.favorites.get)).productIds.map((product_id) => ({ product_id }))),
      () => sb.from("favorites").select("product_id").eq("buyer_id", userId) as PromiseLike<GatewayResult<{ product_id: string }[]>>,
    ),
  packageIds: (userId: string) =>
    read(
      "favorites",
      async () => ok((await shared("favorites", v1.favorites.get)).packageIds.map((package_id) => ({ package_id }))),
      () => sb.from("package_favorites").select("package_id").eq("buyer_id", userId) as PromiseLike<GatewayResult<{ package_id: string }[]>>,
    ),
  addProduct: (userId: string, productId: string) =>
    write(
      "favorites",
      async () => (forget("favorites"), ok(await v1.favorites.saveProduct(productId))),
      () => sb.from("favorites").insert({ buyer_id: userId, product_id: productId }) as PromiseLike<GatewayResult<unknown>>,
    ),
  removeProduct: (userId: string, productId: string) =>
    idempotentWrite(
      "favorites",
      async () => (forget("favorites"), ok(await v1.favorites.unsaveProduct(productId))),
      () => sb.from("favorites").delete().eq("buyer_id", userId).eq("product_id", productId) as PromiseLike<GatewayResult<unknown>>,
    ),
  addPackage: (userId: string, packageId: string) =>
    write(
      "favorites",
      async () => (forget("favorites"), ok(await v1.favorites.savePackage(packageId))),
      () => sb.from("package_favorites").insert({ buyer_id: userId, package_id: packageId }) as PromiseLike<GatewayResult<unknown>>,
    ),
  removePackage: (userId: string, packageId: string) =>
    idempotentWrite(
      "favorites",
      async () => (forget("favorites"), ok(await v1.favorites.unsavePackage(packageId))),
      () => sb.from("package_favorites").delete().eq("buyer_id", userId).eq("package_id", packageId) as PromiseLike<GatewayResult<unknown>>,
    ),
};

/* --------------------------------------------------------------- follows */

const follows = {
  /** toggle_vendor_follow(p_vendor_id, p_following): sets the follow state explicitly. */
  set: (vendorId: string, following: boolean) =>
    idempotentWrite(
      "follows",
      async () => (forget("follows"), ok((await v1.follows.set(vendorId, following)).result)),
      () => sb.rpc("toggle_vendor_follow", { p_vendor_id: vendorId, p_following: following }) as PromiseLike<GatewayResult<unknown>>,
    ),
  unfollow: (userId: string, vendorId: string) =>
    idempotentWrite(
      "follows",
      async () => (forget("follows"), ok(await v1.follows.unfollow(vendorId))),
      () => sb.from("vendor_follows").delete().eq("vendor_id", vendorId).eq("follower_id", userId) as PromiseLike<GatewayResult<unknown>>,
    ),
  /** `data` is truthy when following (the call sites only test truthiness). */
  isFollowing: (userId: string, vendorId: string) =>
    read(
      "follows",
      async () => ok((await v1.follows.state(vendorId)).following ? { vendor_id: vendorId } : null),
      () => sb.from("vendor_follows").select("id").eq("vendor_id", vendorId).eq("follower_id", userId).maybeSingle() as PromiseLike<GatewayResult<unknown>>,
    ),
  vendorIds: (userId: string) =>
    read(
      "follows",
      async () => ok((await shared("follows", v1.follows.get)).vendorIds.map((vendor_id) => ({ vendor_id }))),
      () => sb.from("vendor_follows").select("vendor_id").eq("follower_id", userId).limit(2000) as PromiseLike<GatewayResult<{ vendor_id: string }[]>>,
    ),
  count: (userId: string) =>
    read(
      "follows",
      async () => ok(null, (await shared("follows", v1.follows.get)).count),
      () => sb.from("vendor_follows").select("id", { count: "exact", head: true }).eq("follower_id", userId) as PromiseLike<GatewayResult<null>>,
    ),
};

/* ------------------------------------------------------------- catalogue */

const catalogue = {
  sectors: (order: "sort_order" | "name" = "sort_order") =>
    read(
      "catalogue",
      async () => ok(await v1.catalogue.sectors(order)),
      () => sb.from("sectors").select("*").order(order) as PromiseLike<GatewayResult<unknown[]>>,
    ),
  categories: () =>
    read(
      "catalogue",
      async () => ok(await v1.catalogue.categories()),
      () => sb.from("categories").select("*").order("name") as PromiseLike<GatewayResult<unknown[]>>,
    ),
};

const levroData = Object.freeze({
  cart,
  notifications,
  favorites,
  follows,
  catalogue,
  /** Features currently routed through the backend. */
  get features(): BackendFeature[] {
    return BACKEND_FEATURES.filter((f) => features.has(f));
  },
  /**
   * Per-browser switch for trying the backend path: levroData.useBackend("all"),
   * levroData.useBackend("cart,notifications"), levroData.useBackend(null) to
   * return to the build default. Takes effect immediately and after reloads.
   */
  useBackend(list: string | null): BackendFeature[] {
    writeFeatureOverride(list);
    features = list === null ? enabledFeatures(import.meta.env.VITE_BACKEND_FEATURES) : parseFeatureList(list);
    return BACKEND_FEATURES.filter((f) => features.has(f));
  },
});

export type LevroData = typeof levroData;

declare global {
  interface Window {
    levroData?: LevroData;
  }
}

window.levroData = levroData;
