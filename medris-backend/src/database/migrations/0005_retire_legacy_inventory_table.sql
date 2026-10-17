-- =============================================================================
-- 0005  retire legacy inventory table
-- =============================================================================
-- Why:        Backend manual section 11: public.inventory holds the blood /
--             equipment stock of the app's first version. No marketplace screen,
--             endpoint or function uses it any more.
--             NOT the admin "Inventory" screen: that screen lists marketplace
--             products (admin_get_inventory / admin_delete_inventory_product)
--             and stays exactly as it is.
-- Effect:     moves the table, unchanged with its rows, policies and indexes, from
--             schema public to schema retired. The browser and the REST API can
--             no longer reach it; nothing is deleted. Drop it in a later
--             migration once nobody has missed it (docs/CLEANUP.md).
--             Safety: stops without changing anything if a function in public
--             still reads or writes inventory, or a view depends on it. Skipped
--             if the table is already gone.
-- Roll back:  alter table retired.inventory set schema public;
-- Approved:   <who approved applying it to production, and when>
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create schema if not exists retired;
comment on schema retired is
  'Objects taken out of use and kept for a while before they are dropped (docs/CLEANUP.md). Not exposed to the API.';
revoke all on schema retired from public;

do $$
declare
  users text;
  row_count bigint;
begin
  if to_regclass('public.inventory') is null then
    raise notice 'public.inventory does not exist; nothing to retire';
    return;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into users
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prolang <> (select oid from pg_language where lanname = 'c')
     and p.prosrc ~* '(from|join|into|update|table)\s+("?public"?\.)?"?inventory"?\M';
  if users is not null then
    raise exception 'public.inventory is still used by: %. Not retiring it.', users;
  end if;

  if exists (
    select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid
     where d.refobjid = 'public.inventory'::regclass and rw.ev_class <> 'public.inventory'::regclass
  ) then
    raise exception 'a view depends on public.inventory. Not retiring it.';
  end if;

  alter table public.inventory set schema retired;
  select count(*) into row_count from retired.inventory;
  raise notice 'moved public.inventory to retired.inventory (% rows kept)', row_count;
end
$$;
