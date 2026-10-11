-- =============================================================================
-- 0004  delete duplicate sectors
-- =============================================================================
-- Why:        Backend manual section 11: "Food & Groceries" and "Photography" each
--             exist twice. The extra rows below have no categories and no
--             vendors; they only make the sector lists show a name twice.
--               a5a6c2b2-2c52-4c4c-b386-bc64a8760a61  Food & Groceries
--               d35d824f-4b7c-4890-9736-3d58c5cccd48  Photography
-- Effect:     deletes those two rows from public.sectors. Nothing else.
--             Safety: a row is deleted only if it still has that exact name,
--             another sector with the same name exists (the one that stays), and
--             no vendor or category points at it; otherwise the migration stops
--             and nothing changes. A row that is already gone is skipped. Each
--             deleted row is printed (NOTICE) for the record.
-- Roll back:  insert the printed rows back, e.g.
--               insert into public.sectors (id, slug, name, icon, sort_order)
--               values ('<id>', '<slug>', '<name>', '<icon>', <sort_order>);
-- Approved:   <who approved applying it to production, and when>
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

do $$
declare
  target record;
  sector public.sectors%rowtype;
begin
  for target in
    select * from (values
      ('a5a6c2b2-2c52-4c4c-b386-bc64a8760a61'::uuid, 'Food & Groceries'),
      ('d35d824f-4b7c-4890-9736-3d58c5cccd48'::uuid, 'Photography')
    ) as t(id, name)
  loop
    select * into sector from public.sectors where id = target.id;
    if not found then
      raise notice 'sector % (%) does not exist; nothing to delete', target.id, target.name;
      continue;
    end if;
    if sector.name <> target.name then
      raise exception 'sector % is now named "%", expected "%": not deleting', target.id, sector.name, target.name;
    end if;
    if not exists (select 1 from public.sectors where name = target.name and id <> target.id) then
      raise exception 'sector % is the only "%": it is not a duplicate, not deleting', target.id, target.name;
    end if;
    if exists (select 1 from public.vendors where sector_id = target.id) then
      raise exception 'sector % (%) is used by vendors: not deleting', target.id, target.name;
    end if;
    if exists (select 1 from public.categories where sector_id = target.id) then
      raise exception 'sector % (%) has categories: not deleting', target.id, target.name;
    end if;

    delete from public.sectors where id = target.id;
    raise notice 'deleted sector %: slug=%, name=%, icon=%, sort_order=%',
      sector.id, sector.slug, sector.name, sector.icon, sector.sort_order;
  end loop;
end
$$;
