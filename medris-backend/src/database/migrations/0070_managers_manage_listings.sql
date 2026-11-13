-- Migration:  0070_managers_manage_listings
-- Why:        A shop's managers should be able to add, edit, pause and delete the shop's products, services and packages
--             (staff stay limited to orders and chat). Money, bank details, billing and shop settings stay owner-only.
-- Changes:    Extra row-level-security policies (on top of the owner's) for products, product_variants, vendor_packages and
--             package_items, using public.can_act_for_vendor(vendor, 'listings'), which is true for the owner and active managers only.
-- Applying:   run once by the engineer on production after review (after 0065). Safe to re-run.
--             Rollback: drop the policies named *_team below.

drop policy if exists products_select_team on public.products;
create policy products_select_team on public.products for select using (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists products_insert_team on public.products;
create policy products_insert_team on public.products for insert with check (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists products_update_team on public.products;
create policy products_update_team on public.products for update using (public.can_act_for_vendor(vendor_id, 'listings')) with check (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists products_delete_team on public.products;
create policy products_delete_team on public.products for delete using (public.can_act_for_vendor(vendor_id, 'listings'));

drop policy if exists product_variants_select_team on public.product_variants;
create policy product_variants_select_team on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_id and public.can_act_for_vendor(p.vendor_id, 'listings')));
drop policy if exists product_variants_insert_team on public.product_variants;
create policy product_variants_insert_team on public.product_variants for insert
  with check (exists (select 1 from public.products p where p.id = product_id and public.can_act_for_vendor(p.vendor_id, 'listings')));
drop policy if exists product_variants_update_team on public.product_variants;
create policy product_variants_update_team on public.product_variants for update
  using (exists (select 1 from public.products p where p.id = product_id and public.can_act_for_vendor(p.vendor_id, 'listings')));
drop policy if exists product_variants_delete_team on public.product_variants;
create policy product_variants_delete_team on public.product_variants for delete
  using (exists (select 1 from public.products p where p.id = product_id and public.can_act_for_vendor(p.vendor_id, 'listings')));

drop policy if exists vendor_packages_select_team on public.vendor_packages;
create policy vendor_packages_select_team on public.vendor_packages for select using (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists vendor_packages_insert_team on public.vendor_packages;
create policy vendor_packages_insert_team on public.vendor_packages for insert with check (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists vendor_packages_update_team on public.vendor_packages;
create policy vendor_packages_update_team on public.vendor_packages for update using (public.can_act_for_vendor(vendor_id, 'listings')) with check (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists vendor_packages_delete_team on public.vendor_packages;
create policy vendor_packages_delete_team on public.vendor_packages for delete using (public.can_act_for_vendor(vendor_id, 'listings'));

drop policy if exists package_items_insert_team on public.package_items;
create policy package_items_insert_team on public.package_items for insert
  with check (exists (select 1 from public.vendor_packages vp where vp.id = package_id and public.can_act_for_vendor(vp.vendor_id, 'listings')));
drop policy if exists package_items_update_team on public.package_items;
create policy package_items_update_team on public.package_items for update
  using (exists (select 1 from public.vendor_packages vp where vp.id = package_id and public.can_act_for_vendor(vp.vendor_id, 'listings')));
drop policy if exists package_items_delete_team on public.package_items;
create policy package_items_delete_team on public.package_items for delete
  using (exists (select 1 from public.vendor_packages vp where vp.id = package_id and public.can_act_for_vendor(vp.vendor_id, 'listings')));
