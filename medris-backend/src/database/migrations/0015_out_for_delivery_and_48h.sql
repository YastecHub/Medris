-- =============================================================================
-- 0015  Out for delivery after payment, and 48 hours (not 24) before an order is received automatically
-- Why:        (1) After a buyer's payment is confirmed, the vendor must be able to mark the order "Out for delivery"
--             (or "Handed over" for pickup), so the buyer sees the order move on. Until now a vendor could only
--             complete or cancel a confirmed order. (2) If the buyer neither confirms receipt nor raises a dispute,
--             the order is now marked received after 48 hours (was 24) and the vendor's payout is queued.
-- Changes:    transition_order_status(): a vendor may move a confirmed order to handed_over, only when the payment is in
--               (the buyer's confirmation timer starts then, as it already did for handed_over);
--             auto_complete_eligible_orders(): 48 hours instead of 24;
--             admin_confirm_reported_payment(), vendor_confirm_reported_payment(), vendor_confirm_unreported_payment():
--               only the notification wording changes ("48 hours");
--             apply_card_payment_to_order() (from 0014): a card payment no longer starts the buyer's timer; the
--               "out for delivery" step does. Safe to apply 0014 and 0015 together.
-- Roll back:  restore transition_order_status and auto_complete_eligible_orders from
--             src/database/baseline/01-public-schema.sql, and apply_card_payment_to_order from 0014.
-- Approved:   NOT YET. Needs the founder's approval. The backend and frontend of this change expect it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0015).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transition_order_status(p_order_id uuid, p_new_status public.order_status) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_uid uuid:=auth.uid(); v_order public.orders%rowtype; v_is_vendor boolean; v_fee_paid boolean; v_delivery_deposit_paid boolean; v_pct numeric;
begin
  select * into v_order from public.orders where id=p_order_id for update; if v_order.id is null then raise exception 'order not found'; end if;
  v_is_vendor:=public.owns_vendor(v_order.vendor_id); if not v_is_vendor and v_order.buyer_id<>v_uid then raise exception 'not authorized'; end if;
  v_pct:=greatest(1,least(99,coalesce(v_order.payment_deposit_percent,20)));
  if not v_is_vendor and not ((v_order.status='pending' and p_new_status='cancelled') or (v_order.status='confirmed' and p_new_status='cancelled') or (v_order.status='handed_over' and p_new_status='returned' and v_order.order_type='rental')) then raise exception 'buyers may only cancel eligible orders or return handed-over rentals'; end if;
  if v_is_vendor and not ((v_order.status='pending' and p_new_status in ('confirmed','cancelled')) or (v_order.status='confirmed' and p_new_status in ('completed','cancelled','handed_over')) or (v_order.status='handed_over' and p_new_status='returned' and v_order.order_type='rental') or (v_order.status='handed_over' and p_new_status='completed' and v_order.delivery_method='delivery')) then raise exception 'invalid status transition from % to %',v_order.status,p_new_status; end if;
  if p_new_status='handed_over' then
    -- out for delivery / handed over: only once the money is in
    select exists(select 1 from public.payments where order_id=p_order_id and payment_type in ('sale_price','rental_fee') and status='paid') into v_fee_paid;
    select (v_order.delivery_method<>'delivery' or v_order.payment_timing<>'pay_after' or exists(select 1 from public.payments where order_id=p_order_id and payment_type='delivery_deposit_20' and status='paid')) into v_delivery_deposit_paid;
    if not v_fee_paid or not v_delivery_deposit_paid then raise exception 'The payment must be confirmed before the order can be marked out for delivery.'; end if;
  end if;
  if p_new_status='completed' then
    select exists(select 1 from public.payments where order_id=p_order_id and payment_type in ('sale_price','rental_fee') and status='paid') into v_fee_paid;
    if v_order.delivery_method='delivery' then
      select exists(select 1 from public.payments where order_id=p_order_id and payment_type='delivery_deposit_20' and status='paid') into v_delivery_deposit_paid;
      if not v_delivery_deposit_paid or not v_fee_paid then raise exception 'Required delivery payments must be verified before this order can be completed.'; end if;
      if not v_is_vendor then raise exception 'Only the vendor can complete a delivery order after required payment is verified.'; end if;
    elsif v_order.order_type in ('sale','rental') then
      if not v_fee_paid then raise exception 'The required sale/rental payment must be verified before this order can be completed.'; end if;
      if not v_is_vendor then raise exception 'Only the vendor can complete this order after payment is verified.'; end if;
    end if;
  end if;
  update public.orders set status=p_new_status where id=p_order_id;
  if p_new_status in ('handed_over','returned') then update public.orders set awaiting_confirmation_since=now() where id=p_order_id; end if;
end;$$;

CREATE OR REPLACE FUNCTION public.auto_complete_eligible_orders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record; n integer:=0;
begin
  for r in
    select o.id, o.buyer_id, o.vendor_id from public.orders o
    where o.status in ('confirmed','handed_over') and o.awaiting_confirmation_since is not null
      and o.awaiting_confirmation_since < now() - interval '48 hours'
      and o.order_type<>'rental' and o.service_offer_id is null
      and coalesce(o.payout_status,'not_applicable')='not_applicable'
      and exists(select 1 from public.payments p where p.order_id=o.id and p.payment_type in ('sale_price','rental_fee') and p.status='paid')
      and (not (o.delivery_method='delivery' and o.payment_timing='pay_after') or exists(select 1 from public.payments p where p.order_id=o.id and p.payment_type='delivery_deposit_20' and p.status='paid'))
      and not exists(select 1 from public.disputes d where d.order_id=o.id and d.status='open')
    for update of o skip locked
  loop
    update public.orders set status='completed'::public.order_status, completed_at=coalesce(completed_at,now()), auto_completed_at=now(), awaiting_confirmation_since=null where id=r.id;
    n:=n+1;
    begin
      perform public.create_notification(r.buyer_id,'order_completed','Order marked as received','No issue was reported within 48 hours, so your order was marked as received and completed.','orderDetail',jsonb_build_object('orderId',r.id,'reviewEligible',true),null);
    exception when others then null; end;
  end loop;
  return n;
end $$;

create or replace function public.apply_card_payment_to_order(p_reference text, p_paid_kobo bigint default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_total numeric;
  v_pending int;
  v_type public.payment_type;
  v_complete boolean := false;
  v_await boolean := false;
begin
  if p_reference is null or p_reference = '' then return jsonb_build_object('applied', false, 'reason', 'no_reference'); end if;

  select order_id, sum(amount), count(*) filter (where status = 'pending')
    into v_order_id, v_total, v_pending
    from public.payments where provider_reference = p_reference group by order_id limit 1;
  if v_order_id is null then return jsonb_build_object('applied', false, 'reason', 'unknown_reference'); end if;

  -- lock the order so the webhook and the buyer's return cannot both apply the same payment
  select * into v_order from public.orders where id = v_order_id for update;
  if not found then return jsonb_build_object('applied', false, 'reason', 'order_missing'); end if;

  select count(*) into v_pending from public.payments where provider_reference = p_reference and status = 'pending';
  if v_pending = 0 then return jsonb_build_object('applied', false, 'reason', 'already_applied', 'order_status', v_order.status); end if;

  if p_paid_kobo is not null and p_paid_kobo < round(v_total * 100) then
    return jsonb_build_object('applied', false, 'reason', 'amount_too_low');
  end if;

  update public.payments set status = 'paid', paid_at = coalesce(paid_at, now())
    where provider_reference = p_reference and status = 'pending';

  select payment_type into v_type from public.payments
    where provider_reference = p_reference and payment_type in ('sale_price', 'rental_fee', 'delivery_deposit_20')
    order by created_at limit 1;

  -- an order that was cancelled or finished meanwhile keeps its status; the money is still recorded as paid
  if v_order.status in ('cancelled', 'completed') then
    return jsonb_build_object('applied', true, 'order_status', v_order.status, 'order_changed', false);
  end if;

  if v_type = 'delivery_deposit_20' then
    update public.orders set status = 'confirmed'::public.order_status, payment_unresolved_at = null, payment_escalated_at = null
      where id = v_order_id;
  elsif v_type in ('sale_price', 'rental_fee') then
    v_complete := case when v_order.delivery_method = 'delivery' and v_order.payment_timing = 'pay_after'
                       then exists(select 1 from public.payments where order_id = v_order_id and payment_type = 'delivery_deposit_20' and status = 'paid')
                       else true end;
    if v_complete and v_order.order_type <> 'rental' and v_order.service_offer_id is null
       and coalesce(v_order.payout_status, 'not_applicable') = 'not_applicable' then
      v_complete := false; v_await := true;
      -- the buyer's confirmation window starts when the vendor marks the order out for delivery, not at payment
      update public.orders set status = 'confirmed'::public.order_status, payment_unresolved_at = null, payment_escalated_at = null
        where id = v_order_id;
    elsif v_complete then
      update public.orders set status = 'completed'::public.order_status, completed_at = coalesce(completed_at, now()),
             payment_unresolved_at = null, payment_escalated_at = null, awaiting_confirmation_since = null
        where id = v_order_id;
      if v_order.service_offer_id is not null then
        update public.service_offers set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.service_offer_id;
      end if;
    else
      update public.orders set status = 'confirmed'::public.order_status, payment_unresolved_at = null, payment_escalated_at = null
        where id = v_order_id;
    end if;
  end if;

  return jsonb_build_object('applied', true, 'order_changed', true, 'order_completed', v_complete, 'awaiting_buyer_confirmation', v_await);
end;
$$;


CREATE OR REPLACE FUNCTION public.admin_confirm_reported_payment(p_order_id uuid, p_admin_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype; v_dispute_id uuid; v_should_complete boolean:=false; v_await boolean:=false; v_offer_id uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can verify payment claims.' using errcode='42501'; end if;
  select * into v_order from public.orders where id=p_order_id for update; if not found then raise exception 'Order not found.'; end if;
  select * into v_payment from public.payments where order_id=p_order_id and status='pending' and provider_reference in ('buyer_report','service_offer_report') order by created_at desc limit 1 for update; if v_payment.id is null then raise exception 'No pending reported payment was found.'; end if;
  update public.payments set status='paid'::public.payment_status,paid_at=coalesce(paid_at,now()),provider_reference='admin_confirmed' where id=v_payment.id;
  if v_payment.payment_type in ('sale_price','rental_fee') then
    if v_order.delivery_method='delivery' and v_order.payment_timing='pay_after' then v_should_complete:=exists(select 1 from public.payments where order_id=p_order_id and payment_type='delivery_deposit_20' and status='paid'); else v_should_complete:=true; end if;
    if v_should_complete and v_order.order_type<>'rental' and v_order.service_offer_id is null and coalesce(v_order.payout_status,'not_applicable')='not_applicable' then v_should_complete:=false; v_await:=true; update public.orders set status=case when status='payment_unresolved' then 'confirmed'::public.order_status else status end,payment_unresolved_at=null,payment_escalated_at=null,awaiting_confirmation_since=now() where id=p_order_id; end if;
    if v_should_complete then update public.orders set status='completed'::public.order_status,completed_at=coalesce(completed_at,now()),payment_unresolved_at=null,payment_escalated_at=null,awaiting_confirmation_since=null where id=p_order_id and status<>'cancelled'; elsif not v_await then update public.orders set status='confirmed'::public.order_status,payment_unresolved_at=null,payment_escalated_at=null where id=p_order_id; end if;
  elsif v_payment.payment_type='delivery_deposit_20' then update public.orders set status='confirmed'::public.order_status,payment_unresolved_at=null,payment_escalated_at=null where id=p_order_id; end if;
  if v_order.service_offer_id is not null and v_should_complete then select id into v_offer_id from public.service_offers where id=v_order.service_offer_id; if v_offer_id is not null then update public.service_offers set status='completed',completed_at=now(),updated_at=now() where id=v_offer_id; end if; end if;
  select id into v_dispute_id from public.disputes where order_id=p_order_id and status='open' order by created_at desc limit 1; if v_dispute_id is not null then update public.disputes set status='resolved',admin_notes=coalesce(p_admin_notes,'Payment claim verified by admin.') where id=v_dispute_id; end if;
  perform public.create_notification(v_order.buyer_id,'payment_confirmed','Payment verified by Levromart','Levromart verified the reported payment.'||case when v_should_complete then ' The order is now complete and ready for review.' when v_await then ' Please confirm once you have received your order. It completes automatically in 48 hours if no issue is reported.' else '' end,'orderDetail',jsonb_build_object('orderId',p_order_id,'reviewEligible',v_should_complete),null);
  return jsonb_build_object('success',true,'payment_id',v_payment.id,'order_completed',v_should_complete,'awaiting_buyer_confirmation',v_await);
end;$$;

CREATE OR REPLACE FUNCTION public.vendor_confirm_reported_payment(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_uid uuid:=auth.uid(); v_order public.orders%rowtype; v_payment public.payments%rowtype; v_vendor_name text; v_payment_label text; v_should_complete boolean:=false; v_await boolean:=false; v_dispute_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  select * into v_order from public.orders where id=p_order_id for update; if not found then raise exception 'Order not found.'; end if;
  if not exists(select 1 from public.vendors where id=v_order.vendor_id and user_id=v_uid and deleted_at is null) then raise exception 'Only the vendor can confirm this payment.' using errcode='42501'; end if;
  select * into v_payment from public.payments where order_id=p_order_id and status='pending' and provider_reference in ('buyer_report','service_offer_report') order by created_at desc limit 1 for update; if v_payment.id is null then raise exception 'There is no buyer-reported payment awaiting confirmation.' using errcode='22023'; end if;
  update public.payments set status='paid'::public.payment_status,paid_at=coalesce(paid_at,now()),provider_reference=case when provider_reference='service_offer_report' then 'service_offer_confirmed' else 'vendor_confirmed' end where id=v_payment.id;
  if v_payment.payment_type='delivery_deposit_20' then
    update public.orders set status='confirmed'::public.order_status,payment_unresolved_at=null,payment_escalated_at=null where id=p_order_id;
  elsif v_payment.payment_type in ('sale_price','rental_fee') then
    if v_order.delivery_method='delivery' and v_order.payment_timing='pay_after' then v_should_complete:=exists(select 1 from public.payments where order_id=p_order_id and payment_type='delivery_deposit_20' and status='paid'); else v_should_complete:=true; end if;
    if v_should_complete and v_order.order_type<>'rental' and v_order.service_offer_id is null and coalesce(v_order.payout_status,'not_applicable')='not_applicable' then v_should_complete:=false; v_await:=true; update public.orders set status=case when status='payment_unresolved' then 'confirmed'::public.order_status else status end,payment_unresolved_at=null,payment_escalated_at=null,awaiting_confirmation_since=now() where id=p_order_id; end if;
    if v_should_complete then update public.orders set status='completed'::public.order_status,completed_at=coalesce(completed_at,now()),payment_unresolved_at=null,payment_escalated_at=null,awaiting_confirmation_since=null where id=p_order_id and status<>'cancelled';
    elsif not v_await then update public.orders set status='confirmed'::public.order_status,payment_unresolved_at=null,payment_escalated_at=null where id=p_order_id; end if;
  end if;
  select id into v_dispute_id from public.disputes where order_id=p_order_id and status='open' order by created_at desc limit 1; if v_dispute_id is not null then update public.disputes set status='resolved',admin_notes=coalesce(admin_notes,'') || case when coalesce(admin_notes,'')='' then '' else E'\n' end || 'Vendor later confirmed the reported payment.' where id=v_dispute_id; end if;
  if v_order.service_offer_id is not null and v_should_complete then update public.service_offers set status='completed',completed_at=now(),updated_at=now() where id=v_order.service_offer_id; end if;
  select business_name into v_vendor_name from public.vendors where id=v_order.vendor_id; v_payment_label:=case v_payment.payment_type when 'delivery_deposit_20' then 'delivery deposit' when 'rental_fee' then 'rental fee' when 'deposit' then 'refundable deposit' else 'payment' end;
  perform public.create_notification(v_order.buyer_id,'payment_confirmed','Payment confirmed',coalesce(v_vendor_name,'The vendor')||' confirmed receipt of your '||v_payment_label||'.'||case when v_should_complete then ' The order is now complete and ready for review.' when v_await then ' Please confirm once you have received your order. It completes automatically in 48 hours if no issue is reported.' else '' end,'orderDetail',jsonb_build_object('orderId',p_order_id,'reviewEligible',v_should_complete),v_uid);
  return jsonb_build_object('success',true,'payment_id',v_payment.id,'order_completed',v_should_complete,'awaiting_buyer_confirmation',v_await,'status',case when v_should_complete then 'completed' else 'confirmed' end);
end;$$;

CREATE OR REPLACE FUNCTION public.vendor_confirm_unreported_payment(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid:=auth.uid(); v_order public.orders%rowtype; v_payment_type public.payment_type;
  v_expected numeric:=0; v_pct numeric; v_vendor_name text; v_payment_id uuid; v_completed boolean:=false;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not exists(select 1 from public.vendors where id=v_order.vendor_id and user_id=v_uid and deleted_at is null) then raise exception 'Only the vendor can confirm payment for this order.' using errcode='42501'; end if;
  if v_order.status<>'confirmed' then raise exception 'This order is no longer awaiting payment confirmation.' using errcode='22023'; end if;
  if v_order.payment_escalated_at is null then raise exception 'This order has not reached the payment follow-up stage yet.' using errcode='22023'; end if;
  if v_order.delivery_method='delivery' and v_order.payment_timing='pay_after' and not exists(select 1 from public.payments where order_id=p_order_id and payment_type='delivery_deposit_20' and status='paid') then
    v_payment_type:='delivery_deposit_20'::public.payment_type;
    v_pct:=greatest(1,least(99,coalesce(v_order.payment_deposit_percent,20)));
    v_expected:=round(greatest(0,coalesce(v_order.total_amount,0)-coalesce(v_order.delivery_fee,0))*v_pct/100,2);
  else
    v_payment_type:=case when v_order.order_type='rental' then 'rental_fee'::public.payment_type else 'sale_price'::public.payment_type end;
    v_expected:=greatest(0,coalesce(v_order.total_amount,0));
  end if;
  if v_expected<=0 then raise exception 'There is no outstanding payment amount on this order.' using errcode='22023'; end if;
  insert into public.payments(order_id,payment_type,amount,method,status,provider_reference,paid_at)
  values(p_order_id,v_payment_type,v_expected,'transfer'::public.payment_method,'paid'::public.payment_status,'vendor_confirmed_direct',now())
  returning id into v_payment_id;
  if v_payment_type='delivery_deposit_20' then
    update public.orders set payment_escalated_at=null,payment_unresolved_at=null where id=p_order_id;
  else
    v_completed:=true;
    if v_order.order_type<>'rental' and v_order.service_offer_id is null and coalesce(v_order.payout_status,'not_applicable')='not_applicable' then v_completed:=false; update public.orders set status=case when status='payment_unresolved' then 'confirmed'::public.order_status else status end,payment_escalated_at=null,payment_unresolved_at=null,awaiting_confirmation_since=now() where id=p_order_id; else update public.orders set status='completed'::public.order_status,completed_at=coalesce(completed_at,now()),payment_escalated_at=null,payment_unresolved_at=null,awaiting_confirmation_since=null where id=p_order_id; end if;
  end if;
  select business_name into v_vendor_name from public.vendors where id=v_order.vendor_id;
  perform public.create_notification(v_order.buyer_id,'payment_confirmed','Payment confirmed',coalesce(v_vendor_name,'The vendor')||' confirmed that your payment was received. '||case when v_completed then 'Your order is now complete.' else 'Payment recorded. Please confirm once you have received your order; it completes automatically in 48 hours if no issue is reported.' end,'orderDetail',jsonb_build_object('orderId',p_order_id,'reviewEligible',v_completed),v_uid);
  return jsonb_build_object('success',true,'payment_id',v_payment_id,'order_completed',v_completed,'status',case when v_completed then 'completed' else 'confirmed' end);
end;
$$;
