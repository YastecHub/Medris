import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow } from "../json.js";
import { isUuid } from "../../lib/format.js";

/** Public data for link previews and share-card images (run as service_role; only public fields are read). */
export class SharingRepository {
  constructor(private readonly db: Executor) {}

  /** A verified, active storefront. */
  async storefront(vendorId: string): Promise<{ id: string; business_name: string | null; bio: string | null; logo_url: string | null } | null> {
    if (!isUuid(vendorId)) return null;
    return jsonRow(this.db, sql`
      select id, business_name, bio, logo_url from public.vendors
      where id = ${vendorId} and verification_status = 'verified' and is_active = true`);
  }

  async product(productId: string): Promise<{
    id: string;
    name: string | null;
    description: string | null;
    photos: string[] | null;
    sale_price: number | null;
    discount_price: number | null;
    rental_rate: number | null;
    vendor: { business_name: string | null; logo_url: string | null } | null;
  } | null> {
    if (!isUuid(productId)) return null;
    return jsonRow(this.db, sql`
      select p.id, p.name, p.description, p.photos, p.sale_price, p.discount_price, p.rental_rate,
        (select json_build_object('business_name', v.business_name, 'logo_url', v.logo_url) from public.vendors v where v.id = p.vendor_id) as vendor
      from public.products p where p.id = ${productId}`);
  }

  async package(packageId: string): Promise<{
    id: string;
    name: string | null;
    description: string | null;
    price: number | null;
    photos: string[] | null;
    vendor: { business_name: string | null; logo_url: string | null } | null;
  } | null> {
    if (!isUuid(packageId)) return null;
    return jsonRow(this.db, sql`
      select k.id, k.name, k.description, k.price, k.photos,
        (select json_build_object('business_name', v.business_name, 'logo_url', v.logo_url) from public.vendors v where v.id = k.vendor_id) as vendor
      from public.vendor_packages k where k.id = ${packageId}`);
  }
}
