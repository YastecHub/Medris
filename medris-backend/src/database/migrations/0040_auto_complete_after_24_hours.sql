-- =============================================================================
-- 0040  A paid order is received automatically after 24 hours (was 48), and refund requests appear live
-- Why:        If the buyer does not confirm or dispute within 24 hours, the order completes by itself and the shop's money
--             moves on. Refund requests must show on the shop's screen at once.
-- Changes:    public.auto_complete_eligible_orders()   24 hours instead of 48 (the backend job already uses 24 hours).
--             cancellation_requests                    added to the realtime publication, so a refund request shows up on
--                                                      the shop's and the admin's screens without a refresh.
-- Roll back:  restore the previous body of auto_complete_eligible_orders() (0015) and
--             alter publication supabase_realtime drop table public.cancellation_requests;
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0040).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auto_complete_eligible_orders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record; n integer:=0;
begin
  for r in
    select o.id, o.buyer_id, o.vendor_id from public.orders o
    where o.status in ('confirmed','handed_over') and o.awaiting_confirmation_since is not null
      and o.awaiting_confirmation_since < now() - interval '24 hours'
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
      perform public.create_notification(r.buyer_id,'order_completed','Order marked as received','No issue was reported within 24 hours, so your order was marked as received and completed.','orderDetail',jsonb_build_object('orderId',r.id,'reviewEligible',true),null);
    exception when others then null; end;
  end loop;
  return n;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.cancellation_requests;
exception when others then null; end $$;
