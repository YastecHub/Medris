import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardProduct } from "@/components/ProductCard";
import { legacy, productDetailState } from "@/views/legacy-globals";

/**
 * What the product page reads, for React.
 *
 * Asks Supabase exactly what the legacy renderProductDetail() chain asks (src/legacy/assets/js/01-app/56-product-detail.js:99 and :110,
 * wrapped by the "You may also like" section in …/js/12-lv-onboarding-auth-js.js:243), in the same order, through the existing
 * global client `sb`: a light lookup that decides whether it is a commission service, then (otherwise) the product with its vendor
 * and category, its varieties and its engagement settings in parallel, then the related-equipment shelf. A commission service is
 * drawn by the existing code (renderCommissionServiceDetail): this module only asks it for its HTML.
 */
declare const sb: SupabaseClient;

export interface PdVendor {
  id: string;
  business_name?: string | null;
  previous_business_name?: string | null;
  name_changed_at?: string | null;
  logo_url?: string | null;
  lat?: number | null;
  lng?: number | null;
  avg_rating?: number | null;
  review_count?: number | null;
  verification_status?: string | null;
  is_active?: boolean | null;
  [key: string]: unknown;
}

export interface PdVariant {
  id: string;
  name?: string | null;
  description?: string | null;
  photo_url?: string | null;
  sale_price?: number | null;
  discount_price?: number | null;
  rental_rate?: number | null;
  quantity_available?: number | null;
  sort_order?: number | null;
  [key: string]: unknown;
}

export interface PdProduct {
  id: string;
  name: string;
  description?: string | null;
  photos: string[];
  is_service?: boolean | null;
  billing_model?: string | null;
  listing_type?: string | null;
  status?: string | null;
  condition?: string | null;
  sale_price?: number | null;
  discount_price?: number | null;
  rental_rate?: number | null;
  rental_rate_unit?: string | null;
  service_price_unit?: string | null;
  deposit_amount?: number | null;
  quantity_available?: number | null;
  quantity_total?: number | null;
  track_quantity?: boolean | null;
  payment_timing?: string | null;
  payment_deposit_percent?: number | null;
  delivery_fee?: number | null;
  delivery_fee_mode?: string | null;
  delivery_fee_per_km?: number | null;
  view_count?: number | null;
  category?: { name?: string | null } | null;
  vendor: PdVendor;
  variants: PdVariant[];
  [key: string]: unknown;
}

export type ProductDetailResult =
  | { kind: "error" }
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "service-unavailable" }
  | { kind: "commission"; html: string }
  | { kind: "ready"; product: PdProduct; allowComments: boolean; related: CardProduct[] };

const COMMISSION_CHECK_COLUMNS =
  "id,name,description,photos,is_service,billing_model,status,category:categories(name),vendor:vendors(id,business_name,previous_business_name,name_changed_at,logo_url,city,address,phone,whatsapp_number,whatsapp_visible,avg_rating,review_count,verification_status,is_active)";
const PRODUCT_COLUMNS =
  "*, vendor:vendors!inner(id, business_name, previous_business_name, name_changed_at, city, address, phone, whatsapp_number, whatsapp_visible, avg_rating, review_count, verification_status, cac_number, created_at, is_active, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng, business_hours, allow_after_hours_messages), category:categories(name)";
const RELATED_COLUMNS =
  "id, name, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, delivery_fee, delivery_fee_mode, delivery_fee_per_km, category:categories!inner(name), vendor:vendors!inner(id, business_name, verification_status, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng)";

type Fn = (...args: unknown[]) => unknown;
const legacyCall = (name: string, ...args: unknown[]) => {
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`Legacy helper ${name} is not available`);
  return (fn as Fn)(...args);
};

export async function loadProductDetail(productId: string): Promise<ProductDetailResult> {
  const isOwnVendorId = legacy("isOwnVendorId");

  // The old wrapper asks this first, for every product, to spot commission services.
  const { data: light, error: lightError } = await sb.from("products").select(COMMISSION_CHECK_COLUMNS).eq("id", productId).maybeSingle();
  const l = light as unknown as { is_service?: boolean; billing_model?: string; status?: string; vendor?: PdVendor } | null;
  if (!lightError && l?.is_service && l.billing_model === "commission") {
    const own = isOwnVendorId(l.vendor?.id);
    if (!own && (l.status !== "active" || l.vendor?.verification_status !== "verified" || !l.vendor?.is_active)) return { kind: "service-unavailable" };
    const hint = await legacyCall("getServicePriceHint", productId);
    const offers = await legacyCall("loadServiceOffers", productId);
    productDetailState.setCurrent(light);
    return { kind: "commission", html: String(await legacyCall("renderCommissionServiceDetail", light, hint, offers)) };
  }

  const productQuery = sb.from("products").select(PRODUCT_COLUMNS).eq("id", productId).maybeSingle();
  const variantsQuery = sb.from("product_variants").select("*").eq("product_id", productId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  const engagementQuery = sb.from("product_engagement_settings").select("allow_comments,like_visibility,comment_audience,vendor_id").eq("product_id", productId).maybeSingle();
  const [{ data, error }, { data: variants, error: variantsError }, { data: engagement }] = await Promise.all([productQuery, variantsQuery, engagementQuery]);
  if (error) {
    console.error("[Levromart] Product detail load failed:", error);
    return { kind: "error" };
  }
  if (!data) return { kind: "not-found" };
  const product = data as unknown as PdProduct;
  const own = isOwnVendorId(product.vendor?.id);
  if (!own && (product.status !== "active" || product.vendor?.verification_status !== "verified" || !product.vendor?.is_active)) return { kind: "unavailable" };
  if (variantsError) console.warn("[Levromart] Product varieties could not be loaded:", variantsError);
  product.variants = (variants as unknown as PdVariant[] | null) ?? [];
  productDetailState.setCurrent(product);

  // Counts the view (fire and forget, as the old page does).
  void Promise.resolve(sb.rpc("increment_product_view", { p_product_id: productId })).then(
    () => undefined,
    () => undefined,
  );

  // Every variety's own photo is part of the swipeable gallery, so swiping the big picture moves through the varieties.
  const sorted = product.variants.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const photos = Array.isArray(product.photos) ? product.photos.filter(Boolean) : [];
  sorted.forEach((v) => {
    if (v.photo_url && !photos.some((u) => String(u) === String(v.photo_url))) photos.push(v.photo_url);
  });
  product.photos = photos;

  let related: CardProduct[] = [];
  const names = productDetailState.relatedNames(product.category?.name ?? undefined);
  if (names.length) {
    const { data: rows } = await sb
      .from("products")
      .select(RELATED_COLUMNS)
      .neq("id", product.id)
      .eq("status", "active")
      .eq("vendor.verification_status", "verified")
      .eq("vendor.is_active", true)
      .in("category.name", names)
      .limit(6);
    related = (rows as unknown as CardProduct[] | null) ?? [];
  }
  return { kind: "ready", product, allowComments: (engagement as { allow_comments?: boolean } | null)?.allow_comments !== false, related };
}

/** The owner's numbers on the product page (saved / revenue / sales) come from the vendor stats RPC, as in the old page. */
export async function loadVendorStatsRow(vendorId: string): Promise<{ favorites_count?: number; revenue?: number; sales_count?: number }> {
  const { data } = await sb.rpc("get_vendor_stats", { p_vendor_id: vendorId });
  return ((data as unknown[] | null)?.[0] as { favorites_count?: number; revenue?: number; sales_count?: number } | undefined) ?? {};
}
