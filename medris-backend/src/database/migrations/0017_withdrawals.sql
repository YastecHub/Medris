-- =============================================================================
-- 0017  Vendors withdraw their money (instant after 48 hours, admin approval before)
-- Why:        Money from Levromart checkout payments should not leave on its own. A shop asks to withdraw. Money that has
--             been in the wallet for 48 hours or more (and has no open dispute) is sent straight away; newer money goes to
--             an admin who approves or rejects it (with a reason). Disputed orders' money stays on hold.
-- Changes:    new table withdrawal_requests (who asked, which orders, how much, approved or rejected and why);
--             vendor_payouts.withdrawal_id (which request a payout belongs to);
--             queue_vendor_payout(): when a Levromart-checkout order completes, its payout row is now created ON HOLD
--               ("waiting for the vendor to withdraw") instead of being sent. The payout worker is unchanged: it sends a
--               row only once it is released to 'pending' by a withdrawal. Payouts already queued stay as they are.
-- Roll back:  restore queue_vendor_payout() from 0007; drop table public.withdrawal_requests (only while empty);
--             alter table public.vendor_payouts drop column withdrawal_id;
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0017).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.withdrawal_requests (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors (id) on delete restrict,
  status        text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  kind          text not null default 'approval' check (kind in ('instant', 'approval')),
  order_ids     uuid[] not null default '{}',
  amount_kobo   bigint not null check (amount_kobo > 0),
  has_dispute   boolean not null default false,
  reject_reason text,
  decided_by    uuid references public.users (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- one open request per shop at a time
create unique index if not exists withdrawal_requests_one_open_idx on public.withdrawal_requests (vendor_id) where status = 'requested';
create index if not exists withdrawal_requests_vendor_idx on public.withdrawal_requests (vendor_id, created_at desc);

alter table public.withdrawal_requests enable row level security;
drop policy if exists withdrawal_requests_select_owner_or_admin on public.withdrawal_requests;
create policy withdrawal_requests_select_owner_or_admin on public.withdrawal_requests
  for select using (public.owns_vendor(vendor_id) or (select public.is_admin()));
-- every write goes through the backend (service role); the browser roles can only read what the policy allows
revoke insert, update, delete on public.withdrawal_requests from anon, authenticated;

alter table public.vendor_payouts add column if not exists withdrawal_id uuid references public.withdrawal_requests (id) on delete set null;
create index if not exists vendor_payouts_withdrawal_idx on public.vendor_payouts (withdrawal_id) where withdrawal_id is not null;

create or replace function public.queue_vendor_payout() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from public.payments p
                 where p.order_id = new.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%') then
    insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference, status, hold_reason)
    values (new.id, new.vendor_id, 0, 'lvm_po_' || replace(new.id::text, '-', ''), 'on_hold', 'Waiting for the vendor to withdraw')
    on conflict (order_id, payout_purpose) do nothing;
  end if;
  return new;
end $$;
