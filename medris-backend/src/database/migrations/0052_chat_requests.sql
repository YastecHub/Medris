-- Migration:  0052_chat_requests
-- Why:        After an order is cancelled (30 minutes) or completed (24 hours) the chat closes. A shop sometimes still needs to reach a
--             customer (a wrong delivery, a refund question). The shop can now send a "message request"; if the customer allows it,
--             they can chat for 24 hours.
-- Changes:    public.chat_grants (who allowed whom, until when) and public.buyer_can_message_vendor() also allows an active grant.
-- Applying:   run once by the engineer on production after review (needs 0051 first). Safe to re-run. Rollback: drop the table and
--             re-create the function from 0051.

create table if not exists public.chat_grants (
  buyer_id uuid not null,
  vendor_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (buyer_id, vendor_id)
);
alter table public.chat_grants enable row level security;

create or replace function public.buyer_can_message_vendor(p_buyer uuid, p_vendor uuid) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.orders o
    where o.buyer_id = p_buyer and o.vendor_id = p_vendor
      and (
        o.status in ('confirmed','handed_over','returned','payment_unresolved','disputed')
        or (o.status = 'completed' and coalesce(o.completed_at, o.status_changed_at, o.created_at) > now() - interval '24 hours')
        or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.status_changed_at, o.created_at) > now() - interval '30 minutes')
      )
  ) or exists (
    select 1 from public.chat_grants g where g.buyer_id = p_buyer and g.vendor_id = p_vendor and g.expires_at > now()
  );
$$;
