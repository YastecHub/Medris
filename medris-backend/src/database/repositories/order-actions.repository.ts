import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { rowsOf } from "../client.js";
import { uuidArray } from "../arrays.js";
import { jsonRow, jsonRows } from "../json.js";

/** The order fields the order functions check. */
export interface OrderRow {
  id: string;
  buyer_id: string;
  vendor_id: string;
  status: string;
  order_type: string;
  delivery_method: string | null;
  payment_timing: string | null;
  package_id: string | null;
  awaiting_confirmation_since: string | null;
  quantity_proposal: { items?: { id: string; suggested: number | string }[] } | null;
  vendor_user_id: string | null;
  vendor_name: string | null;
}

/** Order lines with what the edit and quantity functions need. */
export interface LineRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  name: string;
  quantity_available: number | null;
}

/**
 * What happens to an order after checkout: status changes, confirmation, notes, edits by the buyer,
 * quantity suggestions by the vendor, and the buyer's contact for the vendor.
 */
export class OrderActionsRepository {
  constructor(private readonly db: Executor) {}

  /** The order (locked unless `lock` is false), with its shop's owner and name. */
  async order(orderId: string, lock = true): Promise<OrderRow | null> {
    const [row] = rowsOf<{ row: OrderRow }>(
      await this.db.execute(sql`
        select json_build_object(
          'id', o.id, 'buyer_id', o.buyer_id, 'vendor_id', o.vendor_id, 'status', o.status::text, 'order_type', o.order_type::text,
          'delivery_method', o.delivery_method::text, 'payment_timing', o.payment_timing::text, 'package_id', o.package_id,
          'awaiting_confirmation_since', o.awaiting_confirmation_since, 'quantity_proposal', o.quantity_proposal,
          'vendor_user_id', (select v.user_id from public.vendors v where v.id = o.vendor_id),
          'vendor_name', (select v.business_name from public.vendors v where v.id = o.vendor_id)) as row
        from public.orders o where o.id = ${orderId} ${lock ? sql`for update of o` : sql``}`),
    );
    return row?.row ?? null;
  }

  /** Whether this person is on the shop's team with the given permission ("orders", "chat" or "listings") - see migration 0060. */
  async teamCan(userId: string, vendorId: string, permission: "orders" | "chat" | "listings"): Promise<boolean> {
    const [row] = rowsOf<{ ok: boolean }>(await this.db.execute(sql`select public.team_can(${userId}::uuid, ${vendorId}::uuid, ${permission}) as ok`));
    return row?.ok === true;
  }

  // ---- the shop's team (migrations 0057-0060) ----

  /** The shop the person owns (live), if any. */
  async vendorName(vendorId: string): Promise<string | null> {
    const [row] = rowsOf<{ n: string | null }>(await this.db.execute(sql`select business_name as n from public.vendors where id = ${vendorId}::uuid`));
    return row?.n ?? null;
  }

  async ownShopId(userId: string): Promise<string | null> {
    const [row] = rowsOf<{ id: string }>(await this.db.execute(sql`select id from public.vendors where user_id = ${userId}::uuid and deleted_at is null limit 1`));
    return row?.id ?? null;
  }

  async teamOf(vendorId: string): Promise<{ user_id: string; name: string | null; email: string | null; avatar_url: string | null; role: string; status: string; created_at: string }[]> {
    return jsonRows(this.db, sql`select m.user_id, u.name, u.email, u.avatar_url, m.role, m.status, m.created_at
      from public.vendor_members m join public.users u on u.id = m.user_id where m.vendor_id = ${vendorId}::uuid order by m.created_at`);
  }

  /** A Levromart account by e-mail or by phone / WhatsApp number (digits only, last 10). */
  async findAccount(identifier: string): Promise<{ id: string; name: string | null } | null> {
    const email = identifier.trim().toLowerCase();
    const digits = identifier.replace(/\D/g, "");
    const tail = digits.length >= 10 ? digits.slice(-10) : null;
    return jsonRow(this.db, sql`select id, name from public.users
      where (${email.includes("@") ? email : null}::text is not null and lower(email) = ${email.includes("@") ? email : null}::text)
         or (${tail}::text is not null and (right(regexp_replace(coalesce(whatsapp_number, ''), '\\D', '', 'g'), 10) = ${tail}::text
                                          or right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${tail}::text))
      order by created_at limit 1`);
  }

  async shopName(vendorId: string): Promise<string | null> {
    const [row] = rowsOf<{ n: string | null }>(await this.db.execute(sql`select business_name as n from public.vendors where id = ${vendorId}::uuid`));
    return row?.n ?? null;
  }

  async userName(userId: string): Promise<string | null> {
    const [row] = rowsOf<{ n: string | null }>(await this.db.execute(sql`select coalesce(name, email) as n from public.users where id = ${userId}::uuid`));
    return row?.n ?? null;
  }

  async teamCount(vendorId: string): Promise<number> {
    const [row] = rowsOf<{ n: number }>(await this.db.execute(sql`select count(*)::int as n from public.vendor_members where vendor_id = ${vendorId}::uuid`));
    return row?.n ?? 0;
  }

  async addMember(vendorId: string, userId: string, role: string, invitedBy: string): Promise<string> {
    // a new person starts as an invitation; someone who already accepted keeps their access and only gets the new role
    const rows = rowsOf<{ status: string }>(await this.db.execute(sql`insert into public.vendor_members (vendor_id, user_id, role, invited_by, status) values (${vendorId}::uuid, ${userId}::uuid, ${role}, ${invitedBy}::uuid, 'pending')
      on conflict (vendor_id, user_id) do update set role = excluded.role returning status`));
    return rows[0]?.status ?? "pending";
  }

  /** Changes the role of someone already on the team (manager <-> staff). Returns their status and old role, or null when they are not on the team. */
  async setMemberRole(vendorId: string, userId: string, role: string): Promise<{ status: string; old_role: string } | null> {
    const rows = rowsOf<{ status: string; old_role: string }>(await this.db.execute(sql`
      with old as (select role from public.vendor_members where vendor_id = ${vendorId}::uuid and user_id = ${userId}::uuid)
      update public.vendor_members set role = ${role} where vendor_id = ${vendorId}::uuid and user_id = ${userId}::uuid
      returning status, (select role from old) as old_role`));
    return rows[0] ?? null;
  }

  async removeMember(vendorId: string, userId: string): Promise<number> {
    const rows = rowsOf<{ user_id: string }>(await this.db.execute(sql`delete from public.vendor_members where vendor_id = ${vendorId}::uuid and user_id = ${userId}::uuid returning user_id`));
    return rows.length;
  }

  async myTeams(userId: string): Promise<{ vendor_id: string; business_name: string; logo_url: string | null; role: string }[]> {
    return jsonRows(this.db, sql`select m.vendor_id, v.business_name, v.logo_url, m.role from public.vendor_members m
      join public.vendors v on v.id = m.vendor_id and v.deleted_at is null where m.user_id = ${userId}::uuid and m.status = 'active' order by m.created_at`);
  }

  async myInvites(userId: string): Promise<{ vendor_id: string; business_name: string; logo_url: string | null; role: string; created_at: string }[]> {
    return jsonRows(this.db, sql`select m.vendor_id, v.business_name, v.logo_url, m.role, m.created_at from public.vendor_members m
      join public.vendors v on v.id = m.vendor_id and v.deleted_at is null where m.user_id = ${userId}::uuid and m.status = 'pending' order by m.created_at desc`);
  }

  /** The person answers an invitation: accept makes them active, decline removes it. Returns the shop owner and name for the reply alert. */
  async answerInvite(vendorId: string, userId: string, accept: boolean): Promise<{ owner_id: string; business_name: string; role: string } | null> {
    const row = await jsonRow<{ owner_id: string; business_name: string; role: string }>(this.db, sql`select v.user_id as owner_id, v.business_name, m.role from public.vendor_members m join public.vendors v on v.id = m.vendor_id
      where m.vendor_id = ${vendorId}::uuid and m.user_id = ${userId}::uuid and m.status = 'pending'`);
    if (!row) return null;
    if (accept) await this.db.execute(sql`update public.vendor_members set status = 'active' where vendor_id = ${vendorId}::uuid and user_id = ${userId}::uuid`);
    else await this.db.execute(sql`delete from public.vendor_members where vendor_id = ${vendorId}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
    return row;
  }

  /** The shop's conversations for the team workspace, newest first, with the customer's name and the unread count. */
  async teamChats(vendorId: string): Promise<unknown[]> {
    return jsonRows(this.db, sql`select c.id, (select u.name from public.users u where u.id = c.buyer_id) as buyer_name,
        (select u.avatar_url from public.users u where u.id = c.buyer_id) as buyer_avatar,
        (select m.body from public.messages m where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) as last_body,
        (select max(m.created_at) from public.messages m where m.conversation_id = c.id) as last_at,
        (select count(*)::int from public.messages m where m.conversation_id = c.id and m.sender_id = c.buyer_id and m.read_at is null and m.deleted_at is null) as unread
      from public.conversations c where c.vendor_id = ${vendorId}::uuid
      order by (select max(m.created_at) from public.messages m where m.conversation_id = c.id) desc nulls last limit 50`);
  }

  async conversationVendor(conversationId: string): Promise<{ vendor_id: string; buyer_id: string } | null> {
    return jsonRow(this.db, sql`select vendor_id, buyer_id from public.conversations where id = ${conversationId}::uuid`);
  }

  /** The last 100 messages of a conversation, oldest first; the customer's unread messages are marked read. */
  async teamMessages(conversationId: string, buyerId: string): Promise<unknown[]> {
    await this.db.execute(sql`update public.messages set read_at = now() where conversation_id = ${conversationId}::uuid and sender_id = ${buyerId}::uuid and read_at is null`);
    return jsonRows(this.db, sql`select id, sender_id, body, created_at, (sender_id = ${buyerId}::uuid) as from_customer from (
        select id, sender_id, body, created_at from public.messages where conversation_id = ${conversationId}::uuid and deleted_at is null order by created_at desc limit 100) x
      order by created_at`);
  }

  async insertTeamMessage(conversationId: string, senderId: string, body: string): Promise<string> {
    const [row] = rowsOf<{ id: string }>(await this.db.execute(sql`insert into public.messages (conversation_id, sender_id, body) values (${conversationId}::uuid, ${senderId}::uuid, ${body}) returning id`));
    return row!.id;
  }

  /** The shop's orders for the team workspace. The customer's name stays hidden while an order is still pending. */
  async teamOrders(vendorId: string, activeOnly: boolean): Promise<unknown[]> {
    return jsonRows(this.db, sql`select o.id, o.status::text as status, o.order_type::text as order_type, o.delivery_method::text as delivery_method,
        o.total_amount, o.created_at,
        case when o.status::text = 'pending' then null else (select u.name from public.users u where u.id = o.buyer_id) end as buyer_name,
        (select string_agg(p.name || ' x' || oi.quantity, ', ') from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = o.id) as items
      from public.orders o where o.vendor_id = ${vendorId}::uuid ${activeOnly ? sql`and o.status::text in ('pending', 'confirmed', 'handed_over')` : sql``}
      order by o.created_at desc limit 60`);
  }

  /** What the "still available" message needs: why the order was cancelled, how many times it was already sent, and its first product. */
  async followUpInfo(orderId: string): Promise<{ cancelled_automatically: boolean; times_sent: number; product_id: string | null }> {
    const row = await jsonRow<{ cancelled_automatically: boolean; times_sent: number | string; product_id: string | null }>(this.db, sql`
      select coalesce(o.cancellation_reason, '') like 'Cancelled automatically%' as cancelled_automatically,
             (select count(*) from public.notifications n where n.type = 'order_followup' and n.target_params->>'orderId' = o.id::text)::int as times_sent,
             (select oi.product_id::text from public.order_items oi where oi.order_id = o.id order by oi.created_at limit 1) as product_id
        from public.orders o where o.id = ${orderId}::uuid`);
    return row ? { ...row, times_sent: Number(row.times_sent) } : { cancelled_automatically: false, times_sent: 0, product_id: null };
  }

  /** The picture a shop shows everywhere: its logo, or its owner's profile photo when it has none (migration 0030). */
  async shopPicture(vendorId: string): Promise<string | null> {
    const row = await jsonRow<{ url: string | null }>(this.db, sql`
      select coalesce(nullif(trim(v.logo_url), ''), nullif(trim(u.avatar_url), '')) as url
        from public.vendors v left join public.users u on u.id = v.user_id where v.id = ${vendorId}::uuid`);
    return row?.url ?? null;
  }

  /** Fails like PostgreSQL does for a value that is not an order_status. */
  async castStatus(status: string): Promise<void> {
    await this.db.execute(sql`select ${status}::public.order_status`);
  }

  /** A paid payment of one of these types. */
  async hasPaid(orderId: string, types: string[]): Promise<boolean> {
    const row = await jsonRow(
      this.db,
      sql`select 1 as x from public.payments where order_id = ${orderId} and payment_type::text = any(${`{${types.join(",")}}`}::text[]) and status = 'paid' limit 1`,
    );
    return row !== null;
  }

  async anyPaid(orderId: string): Promise<boolean> {
    return (await jsonRow(this.db, sql`select 1 as x from public.payments where order_id = ${orderId} and status = 'paid' limit 1`)) !== null;
  }

  /** The new status; handed over and returned orders start the buyer's confirmation clock. */
  async setStatus(orderId: string, status: string): Promise<void> {
    await this.db.execute(sql`update public.orders set status = ${status}::public.order_status where id = ${orderId}`);
    if (status === "handed_over" || status === "returned") {
      await this.db.execute(sql`update public.orders set awaiting_confirmation_since = now() where id = ${orderId}`);
    }
  }

  async complete(orderId: string): Promise<void> {
    await this.db.execute(sql`
      update public.orders set status = 'completed'::public.order_status, completed_at = coalesce(completed_at, now()), awaiting_confirmation_since = null
      where id = ${orderId}`);
  }

  async decline(orderId: string, reason: string | null): Promise<void> {
    await this.db.execute(sql`update public.orders set status = 'cancelled', cancellation_reason = ${reason}, cancelled_at = now() where id = ${orderId}`);
  }

  /* ---------------------------------------------------------------------- notes */

  async notesBy(orderId: string, senderId: string): Promise<number> {
    return (await jsonRow<{ n: number }>(this.db, sql`select count(*)::int as n from public.order_notes where order_id = ${orderId} and sender_id = ${senderId}`))!.n;
  }

  async addNote(orderId: string, senderId: string, body: string): Promise<string> {
    const [row] = rowsOf<{ id: string }>(await this.db.execute(sql`insert into public.order_notes (order_id, sender_id, body) values (${orderId}, ${senderId}, ${body}) returning id`));
    return row!.id;
  }

  /* ---------------------------------------------------------------- buyer's edit */

  /** The lines of an order with their products (products locked). */
  async linesForEdit(orderId: string): Promise<LineRow[]> {
    return rowsOf<{ row: LineRow }>(
      await this.db.execute(sql`
        select json_build_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'unit_price', oi.unit_price,
                                 'name', p.name, 'quantity_available', p.quantity_available) as row
        from public.order_items oi join public.products p on p.id = oi.product_id
        where oi.order_id = ${orderId}
        for update of p`),
    ).map((r) => r.row);
  }

  /**
   * The requested quantity for a line, as edit_pending_order() read it from the submitted list (the
   * first entry with this order_item_id; 0 when there is none). Conversions happen in PostgreSQL, so a
   * malformed id or quantity fails with the same message.
   */
  async requestedQuantity(items: unknown, lineId: string): Promise<number> {
    const row = await jsonRow<{ qty: number }>(
      this.db,
      sql`select case when r is null then 0 else coalesce((r->>'quantity')::integer, 0) end as qty
          from (select (select x from jsonb_array_elements(${JSON.stringify(items)}::jsonb) x where (x->>'order_item_id')::uuid = ${lineId}::uuid limit 1) as r) t`,
    );
    return row!.qty;
  }

  async takeStock(productId: string, delta: number): Promise<void> {
    if (delta > 0) await this.db.execute(sql`update public.products set quantity_available = quantity_available - ${delta}::int where id = ${productId}`);
    else if (delta < 0) await this.db.execute(sql`update public.products set quantity_available = least(quantity_total, quantity_available + ${Math.abs(delta)}::int) where id = ${productId}`);
  }

  async setLineQuantity(lineId: string, quantity: number): Promise<void> {
    if (quantity === 0) await this.db.execute(sql`delete from public.order_items where id = ${lineId}`);
    else await this.db.execute(sql`update public.order_items set quantity = ${quantity}::int where id = ${lineId}`);
  }

  /** A submitted line with a quantity that is not (or no longer) part of the order. */
  async hasForeignLine(orderId: string, items: unknown): Promise<boolean> {
    const row = await jsonRow<{ x: boolean }>(
      this.db,
      sql`select exists (
            select 1 from jsonb_array_elements(${JSON.stringify(items)}::jsonb) x
            where not exists (select 1 from public.order_items oi where oi.id = (x->>'order_item_id')::uuid and oi.order_id = ${orderId})
              and coalesce((x->>'quantity')::integer,0) > 0) as x`,
    );
    return row!.x;
  }

  async hasLines(orderId: string): Promise<boolean> {
    return (await jsonRow(this.db, sql`select 1 as x from public.order_items where order_id = ${orderId} limit 1`)) !== null;
  }

  /** Σ quantity × unit price of the given lines, in exact arithmetic. */
  async itemsTotal(lines: { quantity: number; unit_price: number }[]): Promise<string> {
    if (lines.length === 0) return "0";
    const values = lines.map((l) => sql`(${l.quantity}::int * ${String(l.unit_price)}::numeric)`);
    return (await jsonRow<{ t: string }>(this.db, sql`select (0::numeric + ${sql.join(values, sql` + `)})::text as t`))!.t;
  }

  /** The buyer's details and the new total (items + delivery fee); delivery details only on delivery orders. */
  async saveEdit(orderId: string, itemsTotal: string, note: string | null, address: string | null, phone: string | null): Promise<void> {
    await this.db.execute(sql`
      update public.orders
      set buyer_note = nullif(trim(coalesce(${note}::text, '')), ''),
          delivery_address = case when delivery_method = 'delivery' then nullif(trim(coalesce(${address}::text, delivery_address)), '') else delivery_address end,
          delivery_phone = case when delivery_method = 'delivery' then nullif(trim(coalesce(${phone}::text, delivery_phone)), '') else delivery_phone end,
          total_amount = ${itemsTotal}::numeric + coalesce(delivery_fee, 0)
      where id = ${orderId}`);
  }

  /* --------------------------------------------------------- quantity suggestion */

  /** The order's lines by product name (the order the suggestion lists them in). */
  linesByName(orderId: string): Promise<{ id: string; quantity: number; name: string }[]> {
    return jsonRows(
      this.db,
      sql`select oi.id, oi.quantity, p.name from public.order_items oi join public.products p on p.id = oi.product_id
          where oi.order_id = ${orderId} order by p.name, oi.id`,
    );
  }

  /** The suggested quantity for a line (the first entry with this id), or null when none was given. */
  async suggestedQuantity(items: unknown, lineId: string): Promise<number | null> {
    const row = await jsonRow<{ qty: number | null }>(
      this.db,
      sql`select (select (e->>'quantity')::int from jsonb_array_elements(${JSON.stringify(items)}::jsonb) e where (e->>'id')::uuid = ${lineId}::uuid limit 1) as qty`,
    );
    return row!.qty;
  }

  async saveProposal(orderId: string, lines: unknown[], note: string | null): Promise<void> {
    await this.db.execute(sql`
      update public.orders set quantity_proposal = jsonb_build_object('items', ${JSON.stringify(lines)}::jsonb, 'note', ${note}::text, 'proposed_at', now())
      where id = ${orderId}`);
  }

  async clearProposal(orderId: string): Promise<void> {
    await this.db.execute(sql`update public.orders set quantity_proposal = null where id = ${orderId}`);
  }

  /** A line's quantity (locked), if it is still part of the order. */
  async lockLine(orderId: string, lineId: string): Promise<number | null> {
    const [row] = rowsOf<{ quantity: number }>(
      await this.db.execute(sql`select quantity from public.order_items where id = ${lineId}::uuid and order_id = ${orderId} for update`),
    );
    return row?.quantity ?? null;
  }

  /** The accepted suggestion: new total, and the deposit recomputed (all of it when paying up front). */
  async reprice(orderId: string): Promise<void> {
    await this.db.execute(sql`
      with t as (
        select coalesce(sum(oi.unit_price * oi.quantity), 0) + coalesce((select delivery_fee from public.orders where id = ${orderId}), 0) as total
        from public.order_items oi where oi.order_id = ${orderId})
      update public.orders set quantity_proposal = null, total_amount = t.total,
             deposit_amount = case when payment_timing = 'pay_before' then t.total else round(t.total * coalesce(payment_deposit_percent, 20) / 100, 2) end
      from t where id = ${orderId}`);
  }

  async displayName(userId: string): Promise<string | null> {
    return (await jsonRow<{ n: string | null }>(this.db, sql`select coalesce(nullif(trim(name), ''), 'The customer') as n from public.users where id = ${userId}`))?.n ?? null;
  }

  /** A notification row written directly (these functions did not go through create_notification()). Returns its id. */
  async notify(n: {
    userId: string | null;
    type: string;
    title: string;
    body: string;
    targetParams: Record<string, unknown>;
    actorId?: string | null;
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    vendorId?: string | null;
    category?: string | null;
    metadata?: Record<string, unknown> | null;
    targetView?: string;
  }): Promise<string> {
    const [row] = rowsOf<{ id: string }>(
      await this.db.execute(sql`
        insert into public.notifications (user_id, type, title, body, target_view, target_params, actor_id, actor_name, actor_avatar_url, vendor_id, notification_category ${n.metadata ? sql`, metadata` : sql``})
        values (${n.userId}::uuid, ${n.type}, ${n.title}, ${n.body}, ${n.targetView ?? "orderDetail"}, ${JSON.stringify(n.targetParams)}::jsonb, ${n.actorId ?? null}::uuid, ${n.actorName ?? null}, ${n.actorAvatarUrl ?? null},
                ${n.vendorId ?? null}::uuid, ${n.category ?? null} ${n.metadata ? sql`, ${JSON.stringify(n.metadata)}::jsonb` : sql``})
        returning id`),
    );
    return row!.id;
  }

  /* ---------------------------------------------------------------- reminders */

  /** The caller's order that is still waiting for the vendor. */
  pendingOrderOf(orderId: string, buyerId: string): Promise<{ id: string; vendor_id: string } | null> {
    return jsonRow(this.db, sql`select id, vendor_id from public.orders where id = ${orderId} and buyer_id = ${buyerId} and status = 'pending'`);
  }

  /** The buyer's order while it still waits on the shop (accepting it, handing it over or delivering it), and whether a reminder went out in the last 2 minutes. */
  remindableOrderOf(orderId: string, buyerId: string): Promise<{ id: string; vendor_id: string; status: string; recent: boolean; buyer_name: string | null } | null> {
    return jsonRow(
      this.db,
      sql`select o.id, o.vendor_id, o.status::text as status, (select u.name from public.users u where u.id = o.buyer_id) as buyer_name,
                 exists (select 1 from public.notifications n where n.type = 'order_reminder' and n.target_params->>'orderId' = o.id::text and n.created_at > now() - interval '2 minutes') as recent
            from public.orders o where o.id = ${orderId} and o.buyer_id = ${buyerId} and o.status in ('pending', 'confirmed', 'handed_over')`,
    );
  }

  /** The shop owner's order that is waiting on the customer (to pay or to confirm), and whether a reminder went out in the last 2 minutes. */
  vendorRemindableOrderOf(orderId: string, ownerId: string): Promise<{ id: string; buyer_id: string; status: string; recent: boolean; vendor_name: string | null } | null> {
    return jsonRow(
      this.db,
      sql`select o.id, o.buyer_id, o.status::text as status, v.business_name as vendor_name,
                 exists (select 1 from public.notifications n where n.type = 'order_reminder_customer' and n.target_params->>'orderId' = o.id::text and n.created_at > now() - interval '2 minutes') as recent
            from public.orders o join public.vendors v on v.id = o.vendor_id
           where o.id = ${orderId} and v.user_id = ${ownerId}::uuid and o.status in ('confirmed', 'handed_over')`,
    );
  }

  /** Every order of the buyer that still waits on a shop (for the "remind all vendors" bell). */
  async remindableOrderIds(buyerId: string): Promise<string[]> {
    const rows = await jsonRows<{ id: string }>(this.db, sql`select id from public.orders where buyer_id = ${buyerId} and status in ('pending', 'confirmed', 'handed_over') order by created_at desc limit 50`);
    return rows.map((r) => r.id);
  }

  /** Is chat between this customer and shop open right now (the same rule as buyer_can_message_vendor)? */
  async chatOpen(buyerId: string, vendorId: string): Promise<boolean> {
    const row = await jsonRow<{ ok: boolean }>(this.db, sql`select public.buyer_can_message_vendor(${buyerId}::uuid, ${vendorId}::uuid) as ok`);
    return row?.ok ?? false;
  }

  /** Did this shop already send this customer a message request in the last 24 hours? */
  async recentChatRequest(buyerId: string, vendorId: string): Promise<boolean> {
    const row = await jsonRow<{ ok: boolean }>(this.db, sql`select exists (select 1 from public.notifications where user_id = ${buyerId}::uuid and type = 'chat_request' and vendor_id = ${vendorId}::uuid and created_at > now() - interval '24 hours') as ok`);
    return row?.ok ?? false;
  }

  /** Is there a message request from this shop to this customer from the last 7 days that has not been answered yet? */
  async openChatRequest(buyerId: string, vendorId: string): Promise<boolean> {
    const row = await jsonRow<{ ok: boolean }>(this.db, sql`select exists (select 1 from public.notifications where user_id = ${buyerId}::uuid and type = 'chat_request' and vendor_id = ${vendorId}::uuid and created_at > now() - interval '7 days') as ok`);
    return row?.ok ?? false;
  }

  async grantChat(buyerId: string, vendorId: string): Promise<void> {
    await this.db.execute(sql`insert into public.chat_grants (buyer_id, vendor_id, expires_at) values (${buyerId}::uuid, ${vendorId}::uuid, now() + interval '24 hours')
      on conflict (buyer_id, vendor_id) do update set expires_at = excluded.expires_at, created_at = now()`);
  }

  async liveVendorOwner(vendorId: string): Promise<string | null> {
    return (await jsonRow<{ user_id: string }>(this.db, sql`select user_id from public.vendors where id = ${vendorId} and deleted_at is null limit 1`))?.user_id ?? null;
  }

  /** set_order_buyer_location(): only the buyer's pending delivery orders. True when the order was one. */
  async setBuyerLocation(orderId: string, buyerId: string, lat: number, lng: number): Promise<boolean> {
    const rows = rowsOf(
      await this.db.execute(sql`
        update public.orders set buyer_lat = ${lat}::double precision, buyer_lng = ${lng}::double precision
        where id = ${orderId} and buyer_id = ${buyerId} and delivery_method = 'delivery' and status = 'pending'
        returning id`),
    );
    return rows.length > 0;
  }

  /* ------------------------------------------------------------- buyer contact */

  /** get_order_buyer_contact(): the buyer's name once the order is accepted (always for admins); the phone only for admins. */
  buyerContact(orderId: string, userId: string | null, admin: boolean): Promise<{ name: string | null; phone: string | null }[]> {
    return jsonRows(
      this.db,
      sql`select case when o.status::text in ('pending','cancelled') and not ${admin} then null else u.name end as name,
                 case when ${admin} then u.phone else null end as phone
          from public.orders o join public.vendors v on v.id = o.vendor_id join public.users u on u.id = o.buyer_id
          where o.id = ${orderId} and (v.user_id = ${userId}::uuid or public.team_can(${userId}::uuid, o.vendor_id, 'orders') or ${admin})`,
    );
  }

  /** get_order_buyer_avatar(): the buyer's profile picture for the shop, on the same rule as the name (not while pending/cancelled). */
  buyerAvatar(orderId: string, userId: string | null, admin: boolean): Promise<{ avatar_url: string | null }[]> {
    return jsonRows(
      this.db,
      sql`select case when o.status::text in ('pending','cancelled') and not ${admin} then null else u.avatar_url end as avatar_url
          from public.orders o join public.vendors v on v.id = o.vendor_id join public.users u on u.id = o.buyer_id
          where o.id = ${orderId} and (v.user_id = ${userId}::uuid or public.team_can(${userId}::uuid, o.vendor_id, 'orders') or ${admin})`,
    );
  }

  /** get_orders_buyer_names(): the same rule for several orders. */
  buyerNames(orderIds: string[], userId: string | null, admin: boolean): Promise<{ order_id: string; name: string | null }[]> {
    return jsonRows(
      this.db,
      sql`select o.id as order_id, case when o.status::text in ('pending','cancelled') and not ${admin} then null else u.name end as name
          from public.orders o join public.vendors v on v.id = o.vendor_id join public.users u on u.id = o.buyer_id
          where o.id = any(${uuidArray(orderIds)}) and (v.user_id = ${userId}::uuid or public.team_can(${userId}::uuid, o.vendor_id, 'orders') or ${admin})`,
    );
  }

  /**
   * `from("order_notes").select("id,sender_id,body,created_at").eq("order_id", id).order("created_at").limit(60)`,
   * as the user: only the order's buyer and the shop's owner see its notes (row-level security).
   */
  notes(orderId: string): Promise<{ id: string; sender_id: string; body: string; created_at: string }[]> {
    return jsonRows(this.db, sql`select id, sender_id, body, created_at from public.order_notes where order_id = ${orderId} order by created_at asc limit 60`);
  }

  /** `from("payments").select("id,status,amount" | "payment_type,status").eq("order_id", id)` (as the user: the order's buyer, its shop and admins). */
  payments(orderId: string): Promise<{ id: string; payment_type: string; status: string; amount: number }[]> {
    return jsonRows(this.db, sql`select id, payment_type, status, amount from public.payments where order_id = ${orderId}`);
  }
}
