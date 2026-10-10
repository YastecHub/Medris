-- Applied via MCP (migration student_verification_matric_pending):
-- vendors without a matric number yet can tick "not available yet"; the application still reaches the admin,
-- but admin_review_student_verification refuses to approve it until a matric number has been added.
alter table public.vendor_student_verification add column if not exists matric_pending boolean not null default false;
-- admin_review_student_verification(p_vendor_id, p_status, p_note) now raises
-- 'This vendor has not added a matric number yet, so they cannot be verified.' when approving a row with matric_pending or an empty matric_number.
