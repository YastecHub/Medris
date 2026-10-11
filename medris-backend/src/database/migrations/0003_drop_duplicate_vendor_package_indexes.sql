-- =============================================================================
-- 0003  drop duplicate vendor package indexes
-- =============================================================================
-- Why:        Backend manual section 11: vendor_packages has two identical pairs
--             of trigram indexes. Every insert/update maintains both copies and
--             each takes space; queries only ever use one of them.
--               idx_vendor_packages_name_trgm         = vendor_packages_name_trgm_idx
--               idx_vendor_packages_description_trgm  = vendor_packages_description_trgm_idx
-- Effect:     drops the two idx_vendor_packages_*_trgm copies; their twins stay,
--             so search keeps exactly the same indexes. No data changes.
--             Safety: a copy is dropped only if its twin exists and has the same
--             definition; otherwise the migration stops and nothing changes. A
--             copy that is already gone is skipped. The dropped definitions are
--             printed (NOTICE) for the record.
-- Roll back:  re-create each dropped index from the printed definition, e.g.
--               create index idx_vendor_packages_name_trgm on public.vendor_packages
--                 using gin (name gin_trgm_ops);
-- Approved:   <who approved applying it to production, and when>
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

do $$
declare
  pair text[];
  duplicate_def text;
  twin_def text;
begin
  foreach pair slice 1 in array array[
    ['idx_vendor_packages_name_trgm', 'vendor_packages_name_trgm_idx'],
    ['idx_vendor_packages_description_trgm', 'vendor_packages_description_trgm_idx']
  ] loop
    select pg_get_indexdef(c.oid) into duplicate_def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'i' and c.relname = pair[1];
    if duplicate_def is null then
      raise notice '% does not exist; nothing to drop', pair[1];
      continue;
    end if;

    select pg_get_indexdef(c.oid) into twin_def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'i' and c.relname = pair[2];
    if twin_def is null then
      raise exception '% exists but its twin % does not: refusing to drop the only copy', pair[1], pair[2];
    end if;

    -- Same definition apart from the index name?
    if regexp_replace(duplicate_def, '^CREATE (UNIQUE )?INDEX \S+ ON ', 'CREATE \1INDEX _ ON ')
       <> regexp_replace(twin_def, '^CREATE (UNIQUE )?INDEX \S+ ON ', 'CREATE \1INDEX _ ON ') then
      raise exception '% and % are not identical (% / %): not dropping', pair[1], pair[2], duplicate_def, twin_def;
    end if;

    execute format('drop index public.%I', pair[1]);
    raise notice 'dropped % (kept %); its definition was: %', pair[1], pair[2], duplicate_def;
  end loop;
end
$$;
