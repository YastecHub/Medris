-- =============================================================================
-- 0002  Backend-managed browser sessions                       NOT YET APPLIED
-- =============================================================================
-- Status: written for review. Do not run against production without approval.
-- Effect: adds one new, empty table. Changes no existing table, row, policy or
-- function. Nothing reads it until AUTH_BACKEND_SESSIONS=true.
--
-- One row per signed-in browser. Only a SHA-256 hash of the session token is
-- stored. Row level security is on with no policies: only the backend (as
-- service_role) can read or write it; the browser cannot reach it through
-- Supabase's REST API.
-- Roll back: drop table public.backend_sessions;  (signs out backend sessions only)
-- =============================================================================

create table if not exists public.backend_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  auth_method text not null check (auth_method in ('password', 'google')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_hash text
);

create index if not exists backend_sessions_user_idx on public.backend_sessions (user_id) where revoked_at is null;
create index if not exists backend_sessions_expires_idx on public.backend_sessions (expires_at);

alter table public.backend_sessions enable row level security;
revoke all on public.backend_sessions from anon, authenticated;
grant select, insert, update, delete on public.backend_sessions to service_role;

comment on table public.backend_sessions is 'Backend-managed browser sessions (medris-backend). Token hashes only; service_role access only.';
