# Database clean-up (Backend Build Manual, section 11)

The manual left a list of removals "for you to approve". This page is where each one stands, what is prepared and
what is left to do. **Nothing here has been applied to production.** Every database change is a migration that
waits for approval; the rest are dashboard steps for whoever owns the account.

## Summary

| # | Item (manual §11) | Prepared | Left to do |
|---|---|---|---|
| 1 | Duplicate trigram indexes on `vendor_packages` | migration `0003` | approve + apply |
| 2 | Duplicate sectors "Food & Groceries" and "Photography" | migration `0004` | approve + apply |
| 3 | Legacy `inventory` table (first-version blood/equipment stock) | migration `0005` (moves it to schema `retired`, keeps the rows) | approve + apply; drop later |
| 4 | `search_products_full` v1 next to v2 | frontend fallback removed (asset version 127) + migration `0006` | deploy the frontend, **then** approve + apply; drop later |
| 5 | Mobihealth leftovers: edge function `champions-notify`, buckets `champion-photos`, `champion-cvs` | - | dashboard steps below |
| 6 | Stale standby project `rtmnrdzmcnlhqfptgkkn` | - | decide: delete, or rebuild as a rehearsal copy |
| 7 | Bucket `product-photos` (144 MB, from before R2) | read-only check below | run the check; delete only when it shows nothing still uses it |
| 8 | ~64 vendor-created sectors with no vendors or categories | read-only list below | product decision: keep as options or delete |
| 9 | "A user updated their details" admin alert sent twice | read-only diagnosis below | run it and share the output; the fix becomes a new migration |
| 10 | Soft-deleted data (9 vendors, 75 notifications) | - | decision. Read notifications older than 60 days are already deleted daily (`/api/daily-cron`) |
| 11 | Function privileges (manual §5.3) | - | separate security task |

**Not legacy:** the admin **Inventory** screen. The Frontend Build Manual calls it a "legacy inventory screen", but it
lists every marketplace product (active / removed) through `admin_get_inventory` and lets admins delete one through
`admin_delete_inventory_product`. It does not use the legacy `inventory` table and stays as it is.

## Applying the migrations

Process and rules: [DATABASE.md, section 3](DATABASE.md#3-changing-the-database-migrations). `0001` and `0002` (the
backend's own) may still be waiting for approval, so apply the clean-up files by number with `--only`:

```bash
export MIGRATE_DATABASE_URL='postgresql://postgres.ovklnoroyxobijgvsyfp:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
npm run db:migrate -w medris-backend -- --only 0003,0004,0005            # dry run
npm run db:migrate -w medris-backend -- --only 0003,0004,0005 --apply --confirm aws-0-<region>.pooler.supabase.com
# 0006 only after the frontend with asset version 127 is live:
npm run db:migrate -w medris-backend -- --only 0006 --apply --confirm aws-0-<region>.pooler.supabase.com
```

Each file checks the database first and **stops without changing anything** if it does not look as the manual
describes (a twin index missing or different, a sector still in use or not actually duplicated, a function still
using `inventory` or calling `search_products_full`). Objects that are already gone are skipped. What each file
removed or moved is printed in the output (NOTICE lines) - keep that output with the approval; it is what the
roll-back SQL in each file's header needs. All four are tested against those cases in
`medris-backend/tests/cleanup-migrations.test.ts`.

**Retired, not dropped.** `0005` and `0006` move objects into schema `retired`, which the API cannot reach. Nothing is
lost and moving them back is one statement. After a few weeks without anyone missing them, and with a fresh backup,
drop them in a new migration (`drop table retired.inventory; drop function retired.search_products_full(...)`) - that
step needs its own approval.

## Steps outside the database

**Mobihealth leftovers (item 5).** They belong to another project (Mobihealth Campus Champions); nothing in this
repository uses them.

1. `champion-photos` holds one file. It may be a person's photo or CV from that project: download it and ask whoever
   ran Mobihealth whether it must be kept, before deleting anything.
2. Supabase dashboard → Storage → empty and delete `champion-photos` and `champion-cvs`. (Use the dashboard or the
   Storage API, not SQL on `storage.objects`: deleting rows there does not delete the files.)
3. Supabase dashboard → Edge Functions → delete `champions-notify` (or `supabase functions delete champions-notify
   --project-ref ovklnoroyxobijgvsyfp`).
4. GitHub: the branches `claude/mobihealth-champions-portal-uouiwi` and `claude/index-file-gunes6` on both remotes,
   if no longer needed: `git push <remote> --delete <branch>`.

**Standby project (item 6).** It is out of date and nothing reads it. Either delete it in the Supabase dashboard, or
rebuild it from a fresh `supabase/export.sh` and keep it as the rehearsal target the migration playbook (manual §12)
asks for. Leaving it stale only causes confusion.

## Read-only checks

Run these in the Supabase SQL editor; none of them changes anything.

**Item 7 - is `product-photos` still used?** Every count must be 0 before the bucket can go:

```sql
select 'products.photos' as place, count(*) from public.products p, unnest(p.photos) u where u like '%/product-photos/%'
union all select 'product_variants.photo_url', count(*) from public.product_variants where photo_url like '%/product-photos/%'
union all select 'vendor_packages.photos', count(*) from public.vendor_packages where photos::text like '%/product-photos/%'
union all select 'messages.attachment_url', count(*) from public.messages where attachment_url like '%/product-photos/%';
```

If anything is left, run the admin "R2 migration" tool first. Then download the bucket as a backup and delete it in the
dashboard.

**Item 8 - unused sectors:**

```sql
select s.id, s.name, s.slug, s.sort_order
  from public.sectors s
 where not exists (select 1 from public.vendors v where v.sector_id = s.id)
   and not exists (select 1 from public.categories c where c.sector_id = s.id)
 order by s.name;
```

Decide whether the vendor application should keep offering them. If not, deleting unreferenced sectors is safe (only
vendors and categories reference sectors) and becomes a migration like `0004`.

**Item 9 - duplicate admin alert:**

```sql
select p.oid::regprocedure as function from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%updated their details%';

select t.tgname, t.tgrelid::regclass as on_table, t.tgfoid::regprocedure as calls
  from pg_trigger t
 where not t.tgisinternal and t.tgrelid in ('public.users'::regclass, 'public.vendors'::regclass)
 order by 2, 1;
```

The first query shows which functions send that alert, the second which triggers fire on a profile change. Two
triggers reaching an alert function for the same update is the duplicate; the fix (keep one) is a new migration.
