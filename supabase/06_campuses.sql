-- Campus selection: users and vendors carry a campus_id (a slug from /campuses.json, "custom:<name>" or "none").
alter table public.users add column if not exists campus_id text;
alter table public.vendors add column if not exists campus_id text;
create index if not exists vendors_campus_id_idx on public.vendors(campus_id) where campus_id is not null;
create or replace function public.vendors_default_campus() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.campus_id is null then select u.campus_id into new.campus_id from public.users u where u.id = new.user_id; end if;
  return new;
end $$;
create or replace function public.users_campus_to_vendor() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.campus_id is distinct from old.campus_id then update public.vendors set campus_id = new.campus_id where user_id = new.id; end if;
  return new;
end $$;
create trigger vendors_default_campus_trg before insert on public.vendors for each row execute function public.vendors_default_campus();
create trigger users_campus_to_vendor_trg after update of campus_id on public.users for each row execute function public.users_campus_to_vendor();
