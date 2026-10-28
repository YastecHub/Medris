-- =============================================================================
-- 0025  Points for a completed sale depend on its size
-- Why:        Every sale should earn something, in steps that are easy to reach: under ₦1,000 gives 20 points,
--             ₦1,000 to ₦5,000 gives 50 points, above ₦5,000 gives 100 points. (Before: nothing under ₦500, then a flat amount.)
-- Changes:    points_award_order() gives 20 / 50 / 100 by the order total; the sale rule's minimum is removed (so reviews on
--             small orders count too) and its text is updated. The same-customer weekly limit and "own order" rule stay.
-- Roll back:  restore the previous points_award_order() (see baseline 01-public-schema.sql) and set points_rules.min_amount back.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0025).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

update public.points_rules
   set points = 100, min_amount = 0,
       label = 'Sale completed',
       description = 'Under ₦1,000: 20 points. ₦1,000 to ₦5,000: 50 points. Above ₦5,000: 100 points.'
 where kind = 'order_completed';

create or replace function public.points_award_order(p_order uuid, p_notify boolean default true) returns text
  language plpgsql security definer set search_path to 'public' as $$
declare o record; v_user uuid; r record; v_cnt int; v_pts int; v_give int;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.status::text <> 'completed' then return 'not completed'; end if;
  select user_id into v_user from public.vendors where id = o.vendor_id;
  if v_user is null then return 'no vendor'; end if;
  select * into r from public.points_rules where kind = 'order_completed';
  if v_user = o.buyer_id then perform public.points_log_skip(v_user, 'order_completed', p_order::text, 'Your own order does not count'); return 'own order'; end if;
  if r.per_source_weekly_cap is not null then
    select count(*) into v_cnt from public.points_ledger
     where user_id = v_user and kind = 'order_completed' and source_user_id = o.buyer_id and week_start = public.points_week_start()
       and event_key <> 'order:' || p_order;
    if v_cnt >= r.per_source_weekly_cap then
      perform public.points_log_skip(v_user, 'order_completed', p_order::text, 'Same customer already counted ' || r.per_source_weekly_cap || ' times this week');
      return 'customer cap';
    end if;
  end if;
  v_give := case when coalesce(o.total_amount, 0) > 5000 then 100 when coalesce(o.total_amount, 0) >= 1000 then 50 else 20 end;
  v_pts := public.award_points(v_user, 'order_completed', 'order:' || p_order, o.buyer_id, 'Completed sale',
             jsonb_build_object('order_id', p_order, 'amount', o.total_amount), v_give, p_notify);
  return case when v_pts > 0 then 'awarded' else 'already counted' end;
end $$;
