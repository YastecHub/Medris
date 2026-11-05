-- =============================================================================
-- 0042  Delivery by campus for packages too
-- Why:        Packages used the shop's one delivery fee. Shops can now give a package the same delivery options by
--             campus as a product (0041): free on their campus, a flat fee on chosen campuses, per km elsewhere.
-- Changes:    vendor_packages.delivery_rules   jsonb, null = the shop's delivery fee as before; same shape and the same
--                                              check as products.delivery_rules (public.lv_valid_delivery_rules, 0041).
-- Roll back:  alter table public.vendor_packages drop constraint vendor_packages_delivery_rules_chk, drop column delivery_rules;
-- Approved:   NOT YET. Needs 0041 first; apply together with the backend that reads it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0042).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

ALTER TABLE public.vendor_packages ADD COLUMN IF NOT EXISTS delivery_rules jsonb;
ALTER TABLE public.vendor_packages DROP CONSTRAINT IF EXISTS vendor_packages_delivery_rules_chk;
ALTER TABLE public.vendor_packages ADD CONSTRAINT vendor_packages_delivery_rules_chk CHECK (public.lv_valid_delivery_rules(delivery_rules));
COMMENT ON COLUMN public.vendor_packages.delivery_rules IS 'Delivery options by campus (0042). Null = the shop''s delivery fee.';
