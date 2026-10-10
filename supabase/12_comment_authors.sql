-- Applied via MCP (migration comment_authors): live display name + picture for comment authors
-- (the vendor's business name and logo when the author is a vendor, otherwise the user's current name and photo).
create or replace function public.get_comment_authors(p_user_ids uuid[])
returns table(user_id uuid, name text, avatar_url text, vendor_id uuid, business_name text, logo_url text, verification_status text, student_verified boolean)
language sql stable security definer set search_path = public as $$
  select u.id, nullif(trim(u.name),''), u.avatar_url, v.id, v.business_name, v.logo_url, v.verification_status, v.student_verified
  from public.users u
  left join lateral (select * from public.vendors vv where vv.user_id = u.id and vv.deleted_at is null order by vv.created_at limit 1) v on true
  where u.id = any(p_user_ids)
$$;
grant execute on function public.get_comment_authors(uuid[]) to anon, authenticated;
