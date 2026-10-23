-- =============================================================================
-- 0011  No numbers in a shop's "about" text
-- Why:        Phone numbers, account numbers or any digits in a shop's business description let people take customers
--             away from the app. The app already removes digits as they are typed; this makes the database refuse
--             them too, so no other route (an old app, the API) can save them.
-- Changes:    trigger vendors_bio_no_numbers on public.vendors (only when the bio is inserted or changed).
--             Existing bios are left alone; a shop with digits in its old bio can still edit other fields, and
--             has to remove the digits only when it edits the bio itself.
-- Roll back:  drop trigger if exists vendors_bio_no_numbers on public.vendors;
--             drop function if exists public.vendors_bio_no_numbers();
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0011).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.vendors_bio_no_numbers() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.bio is not null and new.bio ~ '[0-9٠-٩۰-۹０-９]'
     and (tg_op = 'INSERT' or new.bio is distinct from old.bio) then
    raise exception 'Numbers are not allowed in a business description.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists vendors_bio_no_numbers on public.vendors;
create trigger vendors_bio_no_numbers before insert or update of bio on public.vendors
  for each row execute function public.vendors_bio_no_numbers();
