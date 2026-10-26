import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow } from "../json.js";

export interface SuspendableProduct { id: string; name: string | null; status: string; vendor_user_id: string | null }

/** Suspending a product and the admin log line for it (migration 0021). */
export class ProductSuspensionRepository {
  constructor(private readonly tx: Executor) {}

  lock(productId: string) {
    return jsonRow<SuspendableProduct>(
      this.tx,
      sql`select p.id, p.name, p.status::text as status, v.user_id as vendor_user_id from public.products p left join public.vendors v on v.id = p.vendor_id where p.id = ${productId} for update of p`,
    );
  }

  async suspend(productId: string, reason: string, adminId: string) {
    await this.tx.execute(sql`update public.products set status = 'suspended'::public.product_status, suspended_reason = ${reason}, suspended_at = now(), suspended_by = ${adminId}::uuid where id = ${productId}`);
  }

  async restore(productId: string) {
    await this.tx.execute(sql`update public.products set status = 'active'::public.product_status, suspended_reason = null, suspended_at = null, suspended_by = null where id = ${productId}`);
  }

  async log(adminId: string, productId: string, name: string, suspended: boolean) {
    await this.tx.execute(sql`insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label) select ${adminId}, u.name, ${suspended ? "Suspended a product" : "Restored a suspended product"}, 'product', ${productId}, ${name} from public.users u where u.id = ${adminId}`);
  }
}
