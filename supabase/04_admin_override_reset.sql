-- An admin "unlock" (commission_pause_reason = 'admin_override') keeps a vendor live only while
-- they still owe. Once their commission is fully paid the override is cleared, so a future overdue
-- balance pauses the storefront again on its own.
create or replace function public.enforce_commission_deadlines(p_vendor_id uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_changed integer := 0;
  v_rows integer := 0;
  r record;
begin
  if p_vendor_id is not null and not (public.owns_vendor(p_vendor_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;

  update public.vendors v
  set commission_pause_reason=null
  where v.deleted_at is null
    and v.commission_pause_reason='admin_override'
    and (p_vendor_id is null or v.id=p_vendor_id)
    and coalesce((select sum(c.amount) from public.commission_charges c join public.orders o on o.id=c.order_id
                  where c.vendor_id=v.id and c.status='owed' and o.status='completed'),0) <= 0;

  for r in
    update public.vendors v
    set is_active=false, commission_paused=true, commission_pause_reason='commission_overdue'
    where v.deleted_at is null
      and v.verification_status='verified'
      and (p_vendor_id is null or v.id=p_vendor_id)
      and coalesce(v.admin_paused,false)=false
      and coalesce(v.commission_pause_reason,'') <> 'admin_override'
      and exists(select 1 from public.commission_charges c join public.orders o on o.id=c.order_id
                 where c.vendor_id=v.id and c.status='owed' and o.status='completed' and c.due_at <= now())
      and coalesce((select sum(c2.amount) from public.commission_charges c2 join public.orders o2 on o2.id=c2.order_id
                    where c2.vendor_id=v.id and c2.status='owed' and o2.status='completed'),0) >= 100
    returning v.id, v.business_name
  loop
    v_changed := v_changed + 1;
    perform public.notify_admins(
      'Storefront paused: commission overdue',
      coalesce(r.business_name,'A vendor') || '''s storefront was automatically paused because their commission balance is overdue.',
      'adminPanel', jsonb_build_object('vendorId', r.id), null);
  end loop;

  update public.vendors v
  set is_active=true, commission_paused=false, commission_pause_reason=null
  where v.deleted_at is null
    and v.verification_status='verified'
    and (p_vendor_id is null or v.id=p_vendor_id)
    and coalesce(v.admin_paused,false)=false
    and coalesce(v.commission_paused,false)=true
    and v.commission_pause_reason in ('commission_owed','commission_overdue')
    and not (
      exists(select 1 from public.commission_charges c join public.orders o on o.id=c.order_id
             where c.vendor_id=v.id and c.status='owed' and o.status='completed' and c.due_at <= now())
      and coalesce((select sum(c2.amount) from public.commission_charges c2 join public.orders o2 on o2.id=c2.order_id
                    where c2.vendor_id=v.id and c2.status='owed' and o2.status='completed'),0) >= 100);
  get diagnostics v_rows=row_count;
  v_changed := v_changed + v_rows;
  return v_changed;
end;
$function$;
