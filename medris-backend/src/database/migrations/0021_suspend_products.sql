-- =============================================================================
-- 0021  Admins can suspend a product (hidden from everyone, and the shop cannot bring it back)
-- Why:        Admins sometimes need a product off the marketplace without deleting it. A suspended product is not
--             "active", so every public screen already hides it; the shop sees why and cannot switch it back on.
-- Changes:    product_status gets the value 'suspended'; products.suspended_reason / suspended_at / suspended_by;
--             a guard so only an admin can change a suspended product's status.
-- Roll back:  drop trigger products_guard_suspended on public.products; drop function public.products_guard_suspended();
--             update public.products set status = 'paused' where status = 'suspended';
--             (a value cannot be removed from an enum; leaving 'suspended' unused is harmless.)
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0021).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter type public.product_status add value if not exists 'suspended';

alter table public.products
  add column if not exists suspended_reason text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.users (id) on delete set null;

-- Only an admin (or the server) may change the status of a suspended product.
create or replace function public.products_guard_suspended() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.status::text = 'suspended' and new.status::text is distinct from 'suspended'
     and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres')
     and not public.is_admin() then
    raise exception 'This product was suspended by Levromart. Contact support to have it reviewed.';
  end if;
  return new;
end $$;

drop trigger if exists products_guard_suspended on public.products;
create trigger products_guard_suspended before update of status on public.products
  for each row execute function public.products_guard_suspended();
