import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { ProductSuspensionRepository } from "../../database/repositories/product-suspension.repository.js";
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
      const repo = new ProductSuspensionRepository(tx);
      const p = await repo.lock(productId);
      if (!p) throw notFound("Product not found.");
      if (p.status === "removed") throw conflict("This product was removed.");
      if (suspended) {
        if (p.status === "suspended") throw conflict("This product is already suspended.");
        await repo.suspend(productId, reason, me.userId);
      } else {
        if (p.status !== "suspended") throw conflict("This product is not suspended.");
        await repo.restore(productId);
      }
      await new NotificationWriter(tx).create({
        userId: p.vendor_user_id,
        type: suspended ? "product_suspended" : "product_restored",
        title: suspended ? "A product was suspended" : "A product is live again",
        body: suspended ? `"${p.name ?? "A product"}" was hidden by Levromart: ${reason}` : `"${p.name ?? "A product"}" is visible again.`,
        targetView: "vendorProducts",
        actorId: me.userId,
      });
      await repo.log(me.userId, productId, p.name ?? "", suspended);
      return { id: productId, status: suspended ? "suspended" : "active" };
    });
  }
}
