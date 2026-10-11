-- =============================================================================
-- TEST FIXTURE ONLY. Supabase's default grants, row level security on every
-- table, the policies of the tables the backend touches (copied from the
-- Backend Build Manual, section 8b), and simplified stand-ins for the database
-- functions the backend calls. The real functions live only in the live
-- database; these stand-ins reproduce the behaviour the backend relies on.
-- =============================================================================

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- helpers --------------------------------------------------------------------
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;
create or replace function public.owns_vendor(p_vendor_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vendors where id = p_vendor_id and user_id = auth.uid())
$$;

-- policies (from the manual) -------------------------------------------------
create policy users_select_self_or_admin on public.users for select using ((id = (select auth.uid())) or (select public.is_admin()));
create policy users_update_self on public.users for update using (id = (select auth.uid()));

create policy sectors_select_all on public.sectors for select using (true);
create policy categories_select_all on public.categories for select using (true);
create policy categories_write_admin on public.categories for insert with check ((select public.is_admin()));

create policy vendors_select_public on public.vendors for select
  using (((verification_status = 'verified') and is_active) or (user_id = (select auth.uid())) or (select public.is_admin()));
create policy vendors_update_own_or_admin on public.vendors for update using ((user_id = (select auth.uid())) or (select public.is_admin()));

create policy products_select_active_or_own on public.products for select
  using (((status = 'active') and exists (select 1 from public.vendors v where v.id = products.vendor_id and v.verification_status = 'verified' and v.is_active))
         or public.owns_vendor(vendor_id) or (select public.is_admin()));
create policy product_variants_select_active_or_own on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_variants.product_id and ((p.status = 'active') or public.owns_vendor(p.vendor_id) or public.is_admin())));
create policy vendor_packages_select_active_or_own on public.vendor_packages for select
  using (((status = 'active') and exists (select 1 from public.vendors v where v.id = vendor_packages.vendor_id and v.verification_status = 'verified' and v.is_active))
         or public.owns_vendor(vendor_id) or (select public.is_admin()));

create policy cart_items_owner on public.cart_items for all using (buyer_id = auth.uid());

create policy favorites_delete_own on public.favorites for delete using (buyer_id = (select auth.uid()));
create policy favorites_insert_own on public.favorites for insert with check (buyer_id = (select auth.uid()));
create policy favorites_select_own_or_admin on public.favorites for select using ((buyer_id = (select auth.uid())) or (select public.is_admin()));

create policy "package favorites delete own" on public.package_favorites for delete using ((buyer_id = auth.uid()) and (not public.is_admin()));
create policy "package favorites insert own" on public.package_favorites for insert with check ((buyer_id = auth.uid()) and (not public.is_admin()));
create policy "package favorites select own" on public.package_favorites for select using ((buyer_id = auth.uid()) or public.is_admin());

create policy vendor_follows_delete_own on public.vendor_follows for delete to authenticated using (follower_id = auth.uid());
create policy vendor_follows_insert_own on public.vendor_follows for insert to authenticated
  with check ((follower_id = auth.uid()) and not exists (select 1 from public.vendors v where v.id = vendor_follows.vendor_id and v.user_id = auth.uid()));
create policy vendor_follows_select_own on public.vendor_follows for select to authenticated using (follower_id = auth.uid());

create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());
create policy notifications_insert_admin on public.notifications for insert to authenticated with check (public.is_admin());
create policy notifications_select_own on public.notifications for select using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update using (user_id = (select auth.uid()));

create policy push_subs_select_own on public.push_subscriptions for select using (auth.uid() = user_id);
create policy push_subs_delete_own on public.push_subscriptions for delete using (auth.uid() = user_id);

create policy orders_select_party_or_admin on public.orders for select
  using ((buyer_id = auth.uid()) or public.owns_vendor(vendor_id) or public.is_admin());
create policy payments_select_party_or_admin on public.payments for select
  using (exists (select 1 from public.orders o where o.id = payments.order_id and ((o.buyer_id = auth.uid()) or public.owns_vendor(o.vendor_id) or public.is_admin())));
create policy voice_calls_select_participants on public.voice_calls for select to authenticated
  using ((caller_id = auth.uid()) or (callee_id = auth.uid()) or public.is_admin());
create policy conversations_select_own on public.conversations for select
  using ((buyer_id = auth.uid()) or public.owns_vendor(vendor_id));
create policy commission_charges_select_own on public.commission_charges for select using (public.owns_vendor(vendor_id) or public.is_admin());

-- the trigger that keeps vendors from buying their own products ---------------
create or replace function public.prevent_vendor_self_cart_item() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.products p join public.vendors v on v.id = p.vendor_id where p.id = new.product_id and v.user_id = new.buyer_id) then
    raise exception 'You cannot add your own product to your cart.';
  end if;
  return new;
end $$;
create trigger trg_prevent_vendor_self_cart_item before insert or update of buyer_id, product_id on public.cart_items
  for each row execute function public.prevent_vendor_self_cart_item();

-- RPC stand-ins ---------------------------------------------------------------
create or replace function public.add_to_cart(p_product_id uuid, p_quantity integer, p_variant_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please log in to add items to your cart.'; end if;
  if public.is_admin() then raise exception 'Admin accounts can''t make purchases on Levromart.'; end if;
  if not exists (select 1 from public.products where id = p_product_id and status = 'active') then
    raise exception 'This item is no longer available.';
  end if;
  update public.cart_items set quantity = quantity + greatest(p_quantity, 1)
   where buyer_id = v_uid and product_id = p_product_id and variant_id is not distinct from p_variant_id;
  if not found then
    insert into public.cart_items (buyer_id, product_id, quantity, variant_id) values (v_uid, p_product_id, greatest(p_quantity, 1), p_variant_id);
  end if;
end $$;

create or replace function public.toggle_vendor_follow(p_vendor_id uuid, p_following boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please log in to follow shops.'; end if;
  if public.owns_vendor(p_vendor_id) then raise exception 'You can''t follow your own shop.'; end if;
  if p_following then
    insert into public.vendor_follows (follower_id, vendor_id)
    select v_uid, p_vendor_id where not exists (select 1 from public.vendor_follows where follower_id = v_uid and vendor_id = p_vendor_id);
  else
    delete from public.vendor_follows where follower_id = v_uid and vendor_id = p_vendor_id;
  end if;
  return jsonb_build_object('following', p_following, 'follower_count', (select count(*) from public.vendor_follows where vendor_id = p_vendor_id));
end $$;

grant execute on all functions in schema public to anon, authenticated, service_role;
