-- =============================================================================
-- 0013  Sellers who are not students
-- Why:        Some sellers are not students but still sell near a campus. They must be able to apply, be reviewed by an
--             admin, and get their own "Verified seller" badge (not the green "Verified student" one).
-- Changes:    vendor_student_verification.not_student (boolean, default false);
--             vendors.non_student_verified (boolean, default false);
--             admin_review_student_verification(): a not_student application does not need a matric number; approving it
--             sets non_student_verified (and never student_verified).
-- Roll back:  alter table public.vendors drop column if exists non_student_verified;
--             alter table public.vendor_student_verification drop column if exists not_student;
--             (then restore admin_review_student_verification from supabase/13_matric_pending.sql)
-- Approved:   NOT YET. Needs the founder's approval. APPLY BEFORE the backend and frontend of this change go live
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0013).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.vendor_student_verification add column if not exists not_student boolean not null default false;
alter table public.vendors add column if not exists non_student_verified boolean not null default false;

create or replace function public.admin_review_student_verification(p_vendor_id uuid, p_status text, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_user uuid; v_row public.vendor_student_verification%rowtype;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Only admins can review student verification.' using errcode='42501'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'Invalid status.'; end if;
  select * into v_row from public.vendor_student_verification where vendor_id=p_vendor_id;
  if not found then raise exception 'No verification submitted for this vendor.'; end if;
  if p_status='approved' and not v_row.not_student and (v_row.matric_pending or coalesce(trim(v_row.matric_number),'')='') then
    raise exception 'This vendor has not added a matric number yet, so they cannot be verified.';
  end if;
  update public.vendor_student_verification set status=p_status, review_note=p_note, reviewed_by=v_uid, reviewed_at=now(), updated_at=now() where vendor_id=p_vendor_id;
  update public.vendors set student_verified=(p_status='approved' and not v_row.not_student),
                            non_student_verified=(p_status='approved' and v_row.not_student)
   where id=p_vendor_id returning user_id into v_user;
  begin
    perform public.create_notification(v_user,'student_verification',
      case p_status when 'approved' then (case when v_row.not_student then 'Seller verification approved' else 'Student verification approved' end) when 'rejected' then 'Student verification needs attention' else 'Student verification updated' end,
      case p_status when 'approved' then (case when v_row.not_student then 'Your account was verified. A Verified seller badge now shows on your store.' else 'Your student details were verified. A Verified student badge now shows on your store.' end) when 'rejected' then coalesce(nullif(p_note,''),'Please re-upload clearer documents and submit again.') else 'Your verification is back under review.' end,
      'vendorEditProfile','{}'::jsonb,null);
  exception when others then null; end;
  return jsonb_build_object('success',true,'status',p_status);
end $$;
