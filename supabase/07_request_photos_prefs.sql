-- Buyer requests can carry photos; vendors choose which requests they receive.
alter table public.equipment_requests add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.vendors add column if not exists request_pref text not null default 'all';
alter table public.vendors drop constraint if exists vendors_request_pref_chk;
alter table public.vendors add constraint vendors_request_pref_chk check (request_pref in ('all','sector','none'));
-- notify_new_request(): 'none' vendors get no alerts; 'sector' vendors only for requests in their own sector;
-- 'all' keeps the original behaviour (matching category or same sector). Full body is in the database.
