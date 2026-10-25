-- =============================================================================
-- 0020  Admins can verify a student who has no matric number yet
-- Why:        A student who ticked "I don't have a matric number yet" could not be verified at all. An admin who has
--             checked the other documents can now verify them anyway (the app asks the admin to confirm first).
-- Changes:    admin_review_student_verification(): no longer refuses to approve a row without a matric number.
-- Roll back:  restore the function from 0013_non_student_vendors.sql.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0020).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.admin_review_student_verification(p_vendor_id uuid, p_status text, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_user uuid; v_row public.vendor_student_verification%rowtype;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Only admins can review student verification.' using errcode='42501'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'Invalid status.'; end if;
  select * into v_row from public.vendor_student_verification where vendor_id=p_vendor_id;
  if not found then raise exception 'No verification submitted for this vendor.'; end if;
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

-- ---------------------------------------------------------------------------------------------------------------------
-- The new-school requests also say WHO asked: the person who sent the request first, and the shops that use the school.
-- (The returned columns change, so the function is dropped and made again.)
drop function if exists public.admin_campus_submissions();
create function public.admin_campus_submissions() returns table(name_norm text, name text, requests integer, users_count bigint, vendors_count bigint, created_at timestamp with time zone, submitter_name text, submitter_email text, submitter_phone text, shop_names text)
  language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists(select 1 from users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query select s.name_norm,s.name,s.requests,
    (select count(*) from users u where u.campus_id like 'custom:%' and lv_norm_school(substr(u.campus_id,8))=s.name_norm),
    (select count(*) from vendors v where v.campus_id like 'custom:%' and lv_norm_school(substr(v.campus_id,8))=s.name_norm),
    s.created_at,
    (select coalesce(nullif(u.name,''), u.email) from users u where u.id=s.submitted_by),
    (select u.email from users u where u.id=s.submitted_by),
    (select u.phone from users u where u.id=s.submitted_by),
    (select string_agg(v.business_name, ', ' order by v.business_name) from (select vv.business_name from vendors vv where vv.campus_id like 'custom:%' and lv_norm_school(substr(vv.campus_id,8))=s.name_norm and vv.deleted_at is null limit 5) v)
  from campus_submissions s where s.status='pending' order by s.created_at;
end $$;
revoke all on function public.admin_campus_submissions() from public;
grant execute on function public.admin_campus_submissions() to authenticated, service_role;
