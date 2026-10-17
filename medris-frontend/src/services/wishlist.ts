import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardPackage, } from "@/components/PackageCard";
import type { CardProduct } from "@/components/ProductCard";

/**
 * The buyer's saved products and packages, for React screens.
 *
 * Asks Supabase exactly what the legacy renderWishlist() asks (src/legacy/assets/js/01-app/44-wishlist.js:2):
 * same two tables, same select strings, same filter and order, through the existing global client `sb`. As in the
 * legacy screen, a failed request is treated as "nothing saved" (the legacy code ignores the error), and only active
 * listings of verified, active vendors are shown.
 */
declare const sb: SupabaseClient;

const PRODUCT_COLUMNS =
  "product:products(id, name, listing_type, sale_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, status, vendor:vendors(id, business_name, verification_status, is_active, logo_url))";
const PACKAGE_COLUMNS =
  "package:vendor_packages(id, vendor_id, name, description, price, photos, created_at, status, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,photos))";

type WithVendor = { status?: string | null; vendor?: { verification_status?: string | null; is_active?: boolean | null } | null };
const listable = (x: WithVendor | null | undefined): boolean => !!x && x.status === "active" && x.vendor?.verification_status === "verified" && !!x.vendor?.is_active;

export interface Wishlist {
  products: CardProduct[];
  packages: CardPackage[];
}

export async function loadWishlist(userId: string): Promise<Wishlist> {
  const [{ data: favs }, { data: packageFavs }] = await Promise.all([
    sb.from("favorites").select(PRODUCT_COLUMNS).eq("buyer_id", userId).order("created_at", { ascending: false }),
    sb.from("package_favorites").select(PACKAGE_COLUMNS).eq("buyer_id", userId).order("created_at", { ascending: false }),
  ]);
  const products = ((favs ?? []) as unknown as Array<{ product: (CardProduct & WithVendor) | null }>).map((f) => f.product).filter((p): p is CardProduct & WithVendor => listable(p));
  const packages = ((packageFavs ?? []) as unknown as Array<{ package: (CardPackage & WithVendor) | null }>).map((f) => f.package).filter((p): p is CardPackage & WithVendor => listable(p));
  return { products, packages };
}
