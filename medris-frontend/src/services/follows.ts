import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed access to the vendors a customer follows, for React screens.
 *
 * It asks Supabase exactly what the legacy renderCustomerFollowing() asks (same table, same columns, same
 * filter, same order), through the same global client `sb` (never a second client). Which rows are shown is
 * decided here the same way the legacy screen decides it: only verified, active vendors.
 */
declare const sb: SupabaseClient;

export interface FollowedVendor {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  bio: string | null;
  city: string | null;
  avg_rating: number | null;
  review_count: number | null;
  verification_status: string | null;
  is_active: boolean | null;
  sector_id: string | null;
}

/** Same select string as the legacy query (src/legacy/assets/js/01-app/44-wishlist.js). */
const FOLLOWED_VENDOR_COLUMNS =
  "vendor:vendors!inner(id,business_name,logo_url,cover_image_url,bio,city,avg_rating,review_count,verification_status,is_active,sector_id)";

/** Rejects when the request fails (the screen then shows its "Could not load" message). */
export async function loadFollowedVendors(userId: string): Promise<FollowedVendor[]> {
  const { data, error } = await sb
    .from("vendor_follows")
    .select(FOLLOWED_VENDOR_COLUMNS)
    .eq("follower_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ vendor: FollowedVendor | null }>;
  return rows.map((r) => r.vendor).filter((v): v is FollowedVendor => !!v && v.verification_status === "verified" && !!v.is_active);
}
