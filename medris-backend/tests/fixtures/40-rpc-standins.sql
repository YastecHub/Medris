-- =============================================================================
-- TEST FIXTURE ONLY. Simplified stand-ins for database functions the original
-- endpoints call. Signatures follow the calls in the code (argument names);
-- bodies do just enough for the tests to observe the backend's behaviour.
-- =============================================================================

create or replace function public.process_listing_billing_reminders() returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('reminded', 2, 'expired', 0)
$$;

create or replace function public.process_commission_deadline_reminders() returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('sent', 1)
$$;

create or replace function public.apply_referral_internal(p_uid uuid, p_code text, p_skip_customer boolean default false)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('applied', true, 'code', p_code, 'skip_customer', p_skip_customer)
$$;

create or replace function public.delete_my_account(p_user_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.cart_items where buyer_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.users where id = p_user_id;
end $$;

-- Order status changes: only the buyer of the order (or an admin) - mirrors the real function's guard.
create or replace function public.transition_order_status(p_order_id uuid, p_new_status order_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and (buyer_id = auth.uid() or public.owns_vendor(vendor_id) or public.is_admin())) then
    raise exception 'You are not allowed to change this order.';
  end if;
  update public.orders set status = p_new_status, status_changed_at = now() where id = p_order_id;
end $$;

create or replace function public.vendor_decline_order(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and public.owns_vendor(vendor_id)) then
    raise exception 'Only the vendor can decline this order.';
  end if;
  update public.orders set status = 'cancelled', cancellation_reason = p_reason where id = p_order_id;
end $$;

create or replace function public.create_payment_intent(p_order_id uuid)
returns table(reference text, amount numeric) language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and buyer_id = auth.uid()) then
    raise exception 'Order not found.';
  end if;
  insert into public.payments (order_id, payment_type, amount, method, status, provider_reference)
  select o.id, 'sale_price', o.total_amount, 'card', 'pending', 'medris_' || replace(o.id::text, '-', '') from public.orders o where o.id = p_order_id;
  return query select 'medris_' || replace(o.id::text, '-', ''), o.total_amount from public.orders o where o.id = p_order_id;
end $$;

create or replace function public.create_commission_payment_intent(p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text := 'commission_' || substr(md5(random()::text), 1, 10); v_amount numeric;
begin
  if not public.owns_vendor(p_vendor_id) then raise exception 'not authorized'; end if;
  select coalesce(sum(amount), 0) into v_amount from public.commission_charges where vendor_id = p_vendor_id and status = 'owed';
  insert into public.commission_settlements (vendor_id, amount, status, provider_reference) values (p_vendor_id, v_amount, 'pending', v_ref);
  return jsonb_build_object('reference', v_ref, 'amount', v_amount);
end $$;

create or replace function public.compute_monthly_billing_amount(p_vendor_id uuid)
returns table(listing_count integer, amount numeric) language sql security definer set search_path = public as $$
  select count(*)::int, count(*) * 500::numeric from public.products where vendor_id = p_vendor_id and status = 'active'
$$;

create or replace function public.increment_chat_usage(p_user_id uuid, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then raise exception 'not allowed'; end if;
  return p_limit > 0;
end $$;

grant execute on all functions in schema public to anon, authenticated, service_role;
