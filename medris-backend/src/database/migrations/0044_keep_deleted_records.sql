-- =============================================================================
-- 0044  Nothing is ever lost when something is deleted: every deleted account, shop, listing, order, payment and
--       wallet row is kept in a recycle table, and an admin can put a whole account back
-- Why:        On 7-8 Nov 2026 the app's "repair my profile" request fell through to account deletion and wiped a vendor
--             (profile, shop, listings, orders) on the Free plan, which has no backups: the data could not be restored.
--             Deletes from the app ("Delete account", "Permanently delete" in admin, removing a listing...) keep working
--             the same for people, but the database now keeps a full copy of every deleted row.
-- Changes:    table public.deleted_records (the copy, the table it came from, when, by whom, and the transaction id so
--             one deletion can be put back as a whole). Only the service role reads it (RLS on, no policies).
--             function public.keep_deleted_row() and an AFTER DELETE trigger keep_deleted_row on each table listed below
--             (tables that do not exist are skipped).
--             function public.restore_deleted_account(uuid): re-inserts everything removed together with that account's
--             users row (rows that already exist again are left alone). Service role / SQL editor only.
--             function public.restore_deleted_rows(bigint): the same for any one deletion (by transaction id).
-- Roll back:  drop trigger keep_deleted_row on each table; drop function public.restore_deleted_account(uuid),
--             public.restore_deleted_rows(bigint), public.keep_deleted_row(); the table deleted_records can stay (it
--             only holds copies).
-- Approved:   by the founder, 2026-11-08 (apply: docs/DATABASE.md section 3, --only 0044).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.deleted_records (
  id          bigserial primary key,
  table_name  text not null,
  row_id      text,
  row_data    jsonb not null,
  deleted_at  timestamptz not null default now(),
  deleted_by  text,                       -- the signed-in user who caused it (from the request), when known
  db_role     text not null default current_user,
  txid        bigint not null default txid_current(),
  restored_at timestamptz
);
create index if not exists deleted_records_table_row_idx on public.deleted_records (table_name, row_id);
create index if not exists deleted_records_txid_idx on public.deleted_records (txid);
create index if not exists deleted_records_deleted_at_idx on public.deleted_records (deleted_at desc);
alter table public.deleted_records enable row level security;
revoke all on public.deleted_records from public, anon, authenticated;
grant select, insert, update on public.deleted_records to service_role;
grant usage on sequence public.deleted_records_id_seq to service_role;

create or replace function public.keep_deleted_row() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  who := nullif(current_setting('request.jwt.claim.sub', true), '');
  if who is null then
    begin
      who := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
    exception when others then who := null;
    end;
  end if;
  insert into public.deleted_records (table_name, row_id, row_data, deleted_by)
  values (tg_table_name, to_jsonb(old) ->> 'id', to_jsonb(old), who);
  return old;
end $$;
revoke all on function public.keep_deleted_row() from public, anon, authenticated;

-- the tables whose rows are kept (in the order they are put back: parents first)
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'vendors', 'products', 'product_variants', 'vendor_packages', 'package_items',
    'conversations', 'messages', 'orders', 'order_items', 'payments', 'bookings', 'disputes', 'reviews',
    'vendor_follows', 'favorites', 'package_favorites',
    'wallet_accounts', 'wallet_entries', 'wallet_transfers', 'wallet_withdrawals', 'withdrawal_requests',
    'commission_charges', 'vendor_payouts', 'paystack_transactions', 'paystack_refunds', 'refund_requests'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists keep_deleted_row on public.%I', t);
      execute format('create trigger keep_deleted_row after delete on public.%I for each row execute function public.keep_deleted_row()', t);
    end if;
  end loop;
end $$;

-- Put back every row removed by one deletion (one transaction). Rows are inserted parents first; a row whose parent is
-- still missing is retried on the next pass, and rows that exist again are skipped. Returns how many rows came back.
create or replace function public.restore_deleted_rows(p_txid bigint) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  r record;
  cols text;
  restored integer := 0;
  progress integer;
  pass integer := 0;
begin
  loop
    pass := pass + 1;
    progress := 0;
    for r in select d.* from public.deleted_records d where d.txid = p_txid and d.restored_at is null order by d.id loop
      if to_regclass('public.' || r.table_name) is null then continue; end if;
      -- generated and identity-always columns cannot be written
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a
       where a.attrelid = ('public.' || r.table_name)::regclass and a.attnum > 0 and not a.attisdropped
         and a.attgenerated = '' and a.attidentity <> 'a';
      begin
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
                       r.table_name, cols, cols, r.table_name) using r.row_data;
        update public.deleted_records set restored_at = now() where id = r.id;
        progress := progress + 1;
      exception when foreign_key_violation then
        null;   -- its parent comes back on a later pass
      end;
    end loop;
    restored := restored + progress;
    exit when progress = 0 or pass >= 8;
  end loop;
  return restored;
end $$;

-- Put back a deleted account: everything removed in the same deletion as its users row (profile, shops, listings,
-- orders, payments, wallet, chats, follows...).
create or replace function public.restore_deleted_account(p_user_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  t bigint;
  total integer := 0;
begin
  for t in select distinct d.txid from public.deleted_records d
            where d.table_name = 'users' and d.row_id = p_user_id::text and d.restored_at is null loop
    total := total + public.restore_deleted_rows(t);
  end loop;
  return total;
end $$;

revoke all on function public.restore_deleted_rows(bigint) from public, anon, authenticated;
revoke all on function public.restore_deleted_account(uuid) from public, anon, authenticated;
grant execute on function public.restore_deleted_rows(bigint) to service_role;
grant execute on function public.restore_deleted_account(uuid) to service_role;
