-- Vendor operating campuses, request campus scope, requests carry the buyer's campus, student verification.
alter table public.vendors add column if not exists operating_scope text not null default 'one';        -- one | multiple | all
alter table public.vendors add column if not exists operating_campuses text[] not null default '{}';
alter table public.vendors add column if not exists request_campus_scope text not null default 'all';   -- mine | selected | all
alter table public.vendors add column if not exists student_verified boolean not null default false;
alter table public.equipment_requests add column if not exists campus_id text;
-- vendor_student_verification (matric, faculty, department, level, ID card + biodata images, status) with owner/admin RLS,
-- admin_review_student_verification() RPC, and notify_new_request() honouring request_pref + request_campus_scope
-- were applied directly in the database.
