-- Migration:  0046_product_order_expiry
-- Why:        A vendor can now choose, per product, how long they have to confirm an order for it (food: 1-2 hours; others longer).
--             Empty = use the shop's own time (vendors.order_expiry_minutes, migration 0045).
-- Changes:    products.order_expiry_minutes (null = shop's time; 0 = never cancel by itself). Allowed: 0, 30, 60, 120, 180, 1440, 2880, 10080.
-- Applying:   run once by the engineer on production after review (needs 0045 first). Safe to re-run. Rollback: drop the column.

alter table public.products add column if not exists order_expiry_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_order_expiry_minutes_check') then
    alter table public.products add constraint products_order_expiry_minutes_check check (order_expiry_minutes is null or order_expiry_minutes in (0, 30, 60, 120, 180, 1440, 2880, 10080));
  end if;
end $$;
