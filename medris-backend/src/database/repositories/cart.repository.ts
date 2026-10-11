import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { CartItem } from "../../contracts/v1.js";
import type { Executor } from "../client.js";
import { rowsOf } from "../client.js";
import { callFunction } from "../rpc.js";
import { cartItems } from "../schema/index.js";

/**
 * cart_items for one buyer. Every statement filters on buyer_id in addition
 * to the table's RLS policy (buyer_id = auth.uid()), so a bug in one layer
 * cannot expose or change another buyer's cart.
 */
export class CartRepository {
  constructor(private readonly db: Executor) {}

  /**
   * The cart page's query: items oldest first, each with its variant, product
   * and the product's vendor (same fields the page selected before).
   * Products or vendors that are no longer visible come back as null, as with
   * the previous embedded select, and the page treats them as unavailable.
   */
  async listForBuyer(buyerId: string): Promise<CartItem[]> {
    const result = await this.db.execute(sql`
      select coalesce(json_agg(x.item order by x.created_at), '[]'::json) as items
      from (
        select ci.created_at,
          json_build_object(
            'id', ci.id,
            'variant_id', ci.variant_id,
            'quantity', ci.quantity,
            'created_at', ci.created_at,
            'variant', (select to_json(pv) from public.product_variants pv where pv.id = ci.variant_id),
            'product', (
              select json_build_object(
                'id', p.id, 'name', p.name, 'sale_price', p.sale_price, 'discount_price', p.discount_price,
                'photos', p.photos, 'quantity_available', p.quantity_available, 'status', p.status,
                'delivery_fee', p.delivery_fee, 'delivery_fee_mode', p.delivery_fee_mode, 'delivery_fee_per_km', p.delivery_fee_per_km,
                'vendor', (
                  select json_build_object(
                    'id', v.id, 'business_name', v.business_name, 'previous_business_name', v.previous_business_name,
                    'name_changed_at', v.name_changed_at, 'is_active', v.is_active, 'verification_status', v.verification_status,
                    'delivery_fee', v.delivery_fee, 'delivery_fee_mode', v.delivery_fee_mode, 'delivery_fee_per_km', v.delivery_fee_per_km,
                    'lat', v.lat, 'lng', v.lng)
                  from public.vendors v where v.id = p.vendor_id)
              )
              from public.products p where p.id = ci.product_id)
          ) as item
        from public.cart_items ci
        where ci.buyer_id = ${buyerId}
      ) x`);
    return rowsOf<{ items: CartItem[] }>(result)[0]?.items ?? [];
  }

  async countForBuyer(buyerId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(cartItems).where(eq(cartItems.buyerId, buyerId));
    return Number(row?.n ?? 0);
  }

  /**
   * The database's add_to_cart(): checks the product, blocks buying from your own shop, merges quantities.
   * `variantId` undefined leaves the argument out (the function's default), as Levi's original call did.
   */
  add(productId: string, quantity: number, variantId?: string | null): Promise<unknown> {
    const args: Record<string, unknown> = { p_product_id: productId, p_quantity: quantity };
    if (variantId !== undefined) args.p_variant_id = variantId;
    return callFunction(this.db, "add_to_cart", args);
  }

  async setQuantity(buyerId: string, itemId: string, quantity: number): Promise<boolean> {
    const rows = await this.db
      .update(cartItems)
      .set({ quantity })
      .where(and(eq(cartItems.id, itemId), eq(cartItems.buyerId, buyerId)))
      .returning({ id: cartItems.id });
    return rows.length > 0;
  }

  async remove(buyerId: string, itemIds: string[]): Promise<number> {
    if (!itemIds.length) return 0;
    const rows = await this.db
      .delete(cartItems)
      .where(and(eq(cartItems.buyerId, buyerId), inArray(cartItems.id, itemIds)))
      .returning({ id: cartItems.id });
    return rows.length;
  }

  async clear(buyerId: string): Promise<number> {
    const rows = await this.db.delete(cartItems).where(eq(cartItems.buyerId, buyerId)).returning({ id: cartItems.id });
    return rows.length;
  }
}
