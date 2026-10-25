import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface CancelOrder {
  id: string;
  buyer_id: string;
  vendor_id: string;
  vendor_user_id: string | null;
  business_name: string | null;
  status: string;
  paid: boolean;
}
export interface CancellationRow {
  id: string;
  order_id: string;
  requested_by: string;
  reason: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
  business_name: string | null;
  buyer_id: string | null;
  vendor_user_id: string | null;
  order_status: string | null;
  total_amount: string | null;
}

/** Cancel requests for paid orders (migration 0018), and the order row they act on. Service role only. */
export class CancellationsRepository {
  constructor(private readonly db: Executor) {}

  /** The order, locked, with whether a Levromart (or any) payment on it has been confirmed. */
  order(orderId: string): Promise<CancelOrder | null> {
    return jsonRow<CancelOrder>(
      this.db,
      sql`select o.id, o.buyer_id, o.vendor_id, v.user_id as vendor_user_id, v.business_name, o.status::text as status,
                 exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'paid' and p.payment_type::text in ('sale_price', 'rental_fee', 'delivery_deposit_20')) as paid
          from public.orders o join public.vendors v on v.id = o.vendor_id where o.id = ${orderId} for update of o`,
    );
  }

  async setCancelled(orderId: string): Promise<void> {
    await this.db.execute(sql`update public.orders set status = 'cancelled'::public.order_status where id = ${orderId}`);
  }

  /** What the database queued to give back when the order was cancelled. */
  async queuedRefundKobo(orderId: string): Promise<number> {
    const row = await jsonRow<{ k: string }>(this.db, sql`select coalesce(sum(amount_kobo), 0)::text as k from public.paystack_refunds where order_id = ${orderId} and status <> 'failed'`);
    return Number(row?.k ?? 0);
  }

  open(orderId: string): Promise<{ id: string } | null> {
    return jsonRow(this.db, sql`select id from public.cancellation_requests where order_id = ${orderId} and status = 'requested'`);
  }

  async insert(orderId: string, userId: string, reason: string): Promise<string> {
    const [row] = await jsonReturning<{ id: string }>(this.db, sql`insert into public.cancellation_requests (order_id, requested_by, reason) values (${orderId}, ${userId}, ${reason}) returning id`);
    return row!.id;
  }

  byId(id: string): Promise<CancellationRow | null> {
    return jsonRow<CancellationRow>(this.db, this.select(sql`where c.id = ${id} for update of c`));
  }

  list(status: string | null, limit: number): Promise<CancellationRow[]> {
    return jsonRows<CancellationRow>(this.db, this.select(sql`where (${status}::text is null or c.status = ${status}) order by (c.status = 'requested') desc, c.created_at desc limit ${limit}`));
  }

  async decide(id: string, status: "approved" | "rejected", adminId: string, reason: string | null): Promise<void> {
    await this.db.execute(sql`update public.cancellation_requests set status = ${status}, decided_by = ${adminId}::uuid, decided_at = now(), reject_reason = ${reason} where id = ${id}`);
  }

  async logAdminAction(adminId: string, action: string, orderId: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      select ${adminId}, u.name, ${action}, 'order', ${orderId}, '' from public.users u where u.id = ${adminId}`);
  }

  private select(tail: ReturnType<typeof sql>) {
    return sql`select c.id, c.order_id, c.requested_by, c.reason, c.status, c.reject_reason, c.created_at, c.decided_at,
                      v.business_name, o.buyer_id, v.user_id as vendor_user_id, o.status::text as order_status, o.total_amount::text as total_amount
               from public.cancellation_requests c join public.orders o on o.id = c.order_id join public.vendors v on v.id = o.vendor_id ${tail}`;
  }
}
