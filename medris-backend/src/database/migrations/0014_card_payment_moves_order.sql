-- =============================================================================
-- 0014  A card/transfer payment made through Paystack moves the order on by itself
-- Why:        When a buyer pays an order through Paystack (card, bank transfer, OPay ... all arrive as a successful
--             Paystack charge), the server only marked the `payments` row as paid. Nothing moved the ORDER, so it stayed
--             "confirmed" until someone pressed a button by hand. Commission payments already worked because their code
--             updates the charges directly.
-- Changes:    adds public.apply_card_payment_to_order(reference, paid_kobo): one function, callable only by the server
--             (service role). It marks that payment reference paid and moves the order on with exactly the same rules as
--             a vendor confirming a bank transfer (vendor_confirm_reported_payment):
--               * a delivery deposit confirms the order;
--               * a final payment completes it, or (ordinary sale) starts the buyer's 24-hour "confirm you got it" timer.
--             Safe to call twice (webhook and the buyer's return both call it): the second call changes nothing. If the
--             amount Paystack reports is lower than what the order needed, nothing is changed.
--             The existing trigger trg_notify_payment_paid still sends the "Payment successful" / "paid" notifications.
-- Roll back:  drop function if exists public.apply_card_payment_to_order(text, bigint);
-- Approved:   NOT YET. Needs the founder's approval. Apply BEFORE (or together with) deploying the api/ and backend change
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0014).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

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
      update public.orders set status = 'confirmed'::public.order_status, payment_unresolved_at = null, payment_escalated_at = null,
             awaiting_confirmation_since = coalesce(awaiting_confirmation_since, now())
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

revoke all on function public.apply_card_payment_to_order(text, bigint) from public, anon, authenticated;
grant execute on function public.apply_card_payment_to_order(text, bigint) to service_role;
