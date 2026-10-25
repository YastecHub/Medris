-- =============================================================================
-- 0018  Everything is paid before delivery; a shop cannot cancel a paid order by itself
-- Why:        Payments now go through Paystack and the money is held safely, so "pay after delivery" is no longer offered.
--             A shop that wants to cancel an order the buyer has already paid for asks Levromart; an admin decides, and
--             the buyer is refunded (the Paystack fee is not refunded).
-- Changes:    new table cancellation_requests (which order, who asked, why, decided by whom and why not);
--             every product that was set to "pay after delivery" is set to "pay before delivery" (orders that already
--             exist keep the terms they were made under).
-- Roll back:  drop table public.cancellation_requests (only while empty). The products' old payment_timing is not kept:
--             to bring it back, set it again from the shop's listing page.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0018).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.cancellation_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  requested_by  uuid not null references public.users (id) on delete cascade,
  reason        text not null,
  status        text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  reject_reason text,
  decided_by    uuid references public.users (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists cancellation_requests_one_open_per_order on public.cancellation_requests (order_id) where status = 'requested';
create index if not exists cancellation_requests_status_idx on public.cancellation_requests (status, created_at desc);

alter table public.cancellation_requests enable row level security;

drop policy if exists cancellation_requests_select on public.cancellation_requests;
create policy cancellation_requests_select on public.cancellation_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));

revoke insert, update, delete on public.cancellation_requests from anon, authenticated;
grant select on public.cancellation_requests to authenticated;
grant all on public.cancellation_requests to service_role;

update public.products set payment_timing = 'pay_before' where payment_timing = 'pay_after';
