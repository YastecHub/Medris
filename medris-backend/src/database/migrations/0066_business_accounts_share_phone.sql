-- Migration:  0066_business_accounts_share_phone
-- Why:        A person who adds another business ("Add business") must be able to give that business the same phone number as
--             their main account. Until now every phone number could be on one account only (users_phone_key), so saving the same
--             number on the new business failed with "duplicate key value violates unique constraint".
-- Changes:    users.is_business_account (true for the accounts created by "Add business"); the phone number stays unique among all
--             other accounts, but business accounts are left out of that rule. The flag can only be set by the server, never by a
--             signed-in person (a trigger resets any attempt), so nobody can use it to copy somebody else's number.
-- Applying:   run once by the engineer on production after review (after 0064). Safe to re-run.
--             Rollback: drop the trigger and the index, add the old constraint back
--             (alter table public.users add constraint users_phone_key unique (phone)) - only possible while no two accounts share a number.

alter table public.users add column if not exists is_business_account boolean not null default false;

-- accounts that were already created by "Add business" (the table only exists from migration 0064)
do $$
begin
  if to_regclass('public.business_links') is not null then
    update public.users set is_business_account = true
     where id in (select business_user_id from public.business_links) and is_business_account = false;
  end if;
end $$;

-- the same rule as before (one account per phone number) for everyone except business accounts
alter table public.users drop constraint if exists users_phone_key;
drop index if exists public.users_phone_key;
create unique index users_phone_key on public.users (phone) where not is_business_account;

-- only the server (no signed-in person) may change the flag
create or replace function public.protect_business_account_flag() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.is_business_account := false;
    else new.is_business_account := old.is_business_account; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_business_account_flag on public.users;
create trigger trg_protect_business_account_flag before insert or update of is_business_account on public.users
  for each row execute function public.protect_business_account_flag();
