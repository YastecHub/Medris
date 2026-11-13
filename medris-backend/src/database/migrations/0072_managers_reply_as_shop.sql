-- Migration:  0072_managers_reply_as_shop
-- Why:        A shop's managers should be able to answer customers' comments on its products as the shop. Their comment shows the shop's
--             name and picture, so customers see one voice. The owner and everyone else are unchanged.
-- Changes:    snapshot_product_comment_author() now writes the shop's name and picture for an active manager of the product's shop;
--             the insert policy also lets managers comment when comments are limited to followers.
-- Applying:   run once by the engineer on production after review (after 0070). Safe to re-run.
--             Rollback: re-create snapshot_product_comment_author() and policy product_comments_insert_own from the baseline.

create or replace function public.snapshot_product_comment_author() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare u public.users%rowtype; v record;
begin
  select * into u from public.users where id = auth.uid();
  if u.id is null then raise exception 'Authenticated user profile not found'; end if;
  new.user_id := auth.uid();
  new.author_name := coalesce(nullif(trim(u.name), ''), 'Levromart user');
  new.author_avatar_url := u.avatar_url;
  begin
    select vv.id, vv.user_id, vv.business_name, vv.logo_url into v
      from public.products p join public.vendors vv on vv.id = p.vendor_id where p.id = new.product_id;
    if v.id is not null and v.user_id is distinct from auth.uid()
       and exists (select 1 from public.vendor_members m where m.vendor_id = v.id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'manager') then
      new.author_name := coalesce(nullif(trim(v.business_name), ''), new.author_name);
      new.author_avatar_url := coalesce(v.logo_url, new.author_avatar_url);
    end if;
  exception when others then
    null;
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop policy if exists product_comments_insert_own on public.product_comments;
create policy product_comments_insert_own on public.product_comments for insert
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.products p
        join public.vendors v on v.id = p.vendor_id
        left join public.product_engagement_settings s on s.product_id = p.id
       where p.id = product_comments.product_id
         and coalesce(s.allow_comments, true) = true
         and (coalesce(s.comment_audience, 'everyone') = 'everyone'
              or exists (select 1 from public.vendor_follows f where f.vendor_id = v.id and f.follower_id = auth.uid())
              or v.user_id = auth.uid()
              or public.can_act_for_vendor(v.id, 'listings'))));
