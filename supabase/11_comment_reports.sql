-- Applied via MCP (migration comment_reports): users can report a product/package comment; admins read them.
create table if not exists public.comment_reports(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product','package')),
  comment_id uuid not null,
  reporter_id uuid not null default auth.uid(),
  reason text,
  created_at timestamptz not null default now(),
  unique(kind, comment_id, reporter_id)
);
alter table public.comment_reports enable row level security;
create policy comment_reports_insert on public.comment_reports for insert to authenticated with check (reporter_id = auth.uid());
create policy comment_reports_select on public.comment_reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
