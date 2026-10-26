import { sql } from "drizzle-orm";
import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { jsonRow } from "../../database/json.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

/** Admins suspend a product (hidden from everyone, the shop cannot switch it back on) or let it go live again (migration 0021). */
export class ProductSuspensionService {
  constructor(private readonly db: () => DataContext) {}

  async set(me: Identity | null, productId: string, suspended: boolean, reasonInput: string | null) {
    if (!me) throw forbidden("Admin access required.");
    const reason = (reasonInput ?? "").trim();
    if (suspended && reason.length < 3) throw badRequest("Please write the reason. The shop will see it.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      const p = await jsonRow<{ id: string; name: string | null; status: string; vendor_user_id: string | null }>(
        tx,
        sql`select p.id, p.name, p.status::text as status, v.user_id as vendor_user_id from public.products p left join public.vendors v on v.id = p.vendor_id where p.id = ${productId} for update of p`,
      );
      if (!p) throw notFound("Product not found.");
      if (p.status === "removed") throw conflict("This product was removed.");
      if (suspended) {
        if (p.status === "suspended") throw conflict("This product is already suspended.");
        await tx.execute(sql`update public.products set status = 'suspended'::public.product_status, suspended_reason = ${reason}, suspended_at = now(), suspended_by = ${me.userId}::uuid where id = ${productId}`);
      } else {
        if (p.status !== "suspended") throw conflict("This product is not suspended.");
        await tx.execute(sql`update public.products set status = 'active'::public.product_status, suspended_reason = null, suspended_at = null, suspended_by = null where id = ${productId}`);
      }
      await new NotificationWriter(tx).create({
        userId: p.vendor_user_id,
        type: suspended ? "product_suspended" : "product_restored",
        title: suspended ? "A product was suspended" : "A product is live again",
        body: suspended ? `"${p.name ?? "A product"}" was hidden by Levromart: ${reason}` : `"${p.name ?? "A product"}" is visible again.`,
        targetView: "vendorProducts",
        actorId: me.userId,
      });
      await tx.execute(sql`insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label) select ${me.userId}, u.name, ${suspended ? "Suspended a product" : "Restored a suspended product"}, 'product', ${productId}, ${p.name ?? ""} from public.users u where u.id = ${me.userId}`);
      return { id: productId, status: suspended ? "suspended" : "active" };
    });
  }
}
