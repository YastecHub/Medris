-- Migration:  0045_vendor_order_expiry
-- Why:        Pending orders were always cancelled after 30 minutes. Each vendor can now choose how long they have to confirm an
--             order (food sellers usually want 1-2 hours; others a day or more, or never). Default stays 30 minutes.
-- Changes:    vendors.order_expiry_minutes (0 = never cancel by itself). Allowed: 0, 30, 60, 120, 180, 1440, 2880, 10080.
-- Applying:   run once by the engineer on production after review. Safe to re-run (idempotent). Rollback: drop the column.

alter table public.vendors add column if not exists order_expiry_minutes integer not null default 30;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_order_expiry_minutes_check') then
    alter table public.vendors add constraint vendors_order_expiry_minutes_check check (order_expiry_minutes in (0, 30, 60, 120, 180, 1440, 2880, 10080));
  end if;
end $$;
