-- =============================================================================
-- 0041  Delivery by campus: a listing can charge a different delivery fee (or none) per campus
-- Why:        Shops want, for example, free delivery on their own campus, a flat fee on two nearby campuses and a
--             per-kilometre fee everywhere else. The buyer picks the campus the order goes to, and the fee follows it.
-- Changes:    products.delivery_rules       jsonb, null = the old single setting (delivery_fee_mode / fee / per km).
--                                           A list of options: {mode: free|flat|distance, fee, perKm,
--                                           scope: mine|selected|all, campuses: [campus ids]}.
--             public.lv_valid_delivery_rules(jsonb)  the shape check; products_delivery_rules_chk uses it, so a
--                                           broken or contradictory list can never be saved, whatever the browser sends.
--             orders.delivery_campus_id     the campus the buyer chose; the shop sees it on the order.
-- Roll back:  alter table public.products drop constraint products_delivery_rules_chk, drop column delivery_rules;
--             drop function public.lv_valid_delivery_rules(jsonb); alter table public.orders drop column delivery_campus_id;
-- Approved:   NOT YET. Apply together with the backend that reads it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0041).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lv_valid_delivery_rules(r jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare e jsonb; seen text[] := '{}'; c text; n_all int := 0; n_mine int := 0; m text; s text;
begin
  if r is null then return true; end if;
  if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) < 1 or jsonb_array_length(r) > 10 then return false; end if;
  for e in select * from jsonb_array_elements(r) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    m := e->>'mode'; s := e->>'scope';
    if m is null or m not in ('free','flat','distance') then return false; end if;
    if s is null or s not in ('mine','selected','all') then return false; end if;
    if m = 'flat' and not (jsonb_typeof(e->'fee') = 'number' and (e->>'fee')::numeric > 0 and (e->>'fee')::numeric <= 1000000) then return false; end if;
    if m = 'distance' and not (jsonb_typeof(e->'perKm') = 'number' and (e->>'perKm')::numeric > 0 and (e->>'perKm')::numeric <= 1000) then return false; end if;
    if s = 'all' then n_all := n_all + 1; end if;
    if s = 'mine' then n_mine := n_mine + 1; end if;
    if s = 'selected' then
      if jsonb_typeof(e->'campuses') <> 'array' or jsonb_array_length(e->'campuses') < 1 or jsonb_array_length(e->'campuses') > 300 then return false; end if;
      for c in select * from jsonb_array_elements_text(e->'campuses') loop
        if length(c) < 1 or length(c) > 160 or c = any(seen) then return false; end if;   -- a campus can only have one delivery option
        seen := seen || c;
      end loop;
    end if;
  end loop;
  return n_all <= 1 and n_mine <= 1;
end $$;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS delivery_rules jsonb;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_delivery_rules_chk;
ALTER TABLE public.products ADD CONSTRAINT products_delivery_rules_chk CHECK (public.lv_valid_delivery_rules(delivery_rules));
COMMENT ON COLUMN public.products.delivery_rules IS 'Delivery options by campus (0041). Null = the single delivery_fee_mode setting.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_campus_id text;
COMMENT ON COLUMN public.orders.delivery_campus_id IS 'The campus the buyer chose for delivery (0041); the fee was worked out for this campus.';
