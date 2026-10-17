-- =============================================================================
-- 0006  retire search products full v1
-- =============================================================================
-- Why:        Backend manual section 11: search_products_full (the original
--             search) sits next to search_products_full_v2, which the app uses.
--             The app only called v1 as a fallback when v2 failed; that fallback
--             is removed in the same change as this file.
-- Effect:     moves every overload of public.search_products_full to schema
--             retired, unchanged. It can no longer be called through the API.
--             search_products_full_v2 and search_product_ids are not touched.
--             Safety: stops without changing anything if another function in
--             public still calls search_products_full. Skipped if it is gone.
-- ORDER:      apply only AFTER the frontend without the fallback is deployed
--             (asset version 127 or later).
-- Roll back:  alter function retired.search_products_full(<arguments>) set schema public;
--             (the NOTICE lists each moved function with its arguments)
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
  callers text;
  fn regprocedure;
  moved int := 0;
begin
  -- \M is "end of word"; "_" is a word character, so search_products_full_v2 does not match.
  select string_agg(p.oid::regprocedure::text, ', ') into callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'search_products_full'
     and p.prolang <> (select oid from pg_language where lanname = 'c')
     and p.prosrc ~* 'search_products_full\M';
  if callers is not null then
    raise exception 'search_products_full is still called by: %. Not retiring it.', callers;
  end if;

  for fn in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'search_products_full'
  loop
    execute format('alter function %s set schema retired', fn);
    raise notice 'moved % to schema retired', fn;
    moved := moved + 1;
  end loop;

  if moved = 0 then
    raise notice 'public.search_products_full does not exist; nothing to retire';
  end if;
end
$$;
