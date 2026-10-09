-- Applied via MCP (migration student_verification_face_ocr): face check + ID OCR evidence on student verification rows.
alter table public.vendor_student_verification
  add column if not exists selfie_url text,
  add column if not exists face_distance real,
  add column if not exists face_match text check (face_match in ('strong','possible','mismatch','unchecked')),
  add column if not exists face_liveness boolean,
  add column if not exists face_checked_at timestamptz,
  add column if not exists ocr_matric_found boolean,
  add column if not exists ocr_name_found boolean,
  add column if not exists ocr_text text,
  add column if not exists ocr_checked_at timestamptz;

-- migration student_verification_face_recheck: face_v marks rows that did the upgraded face check; submit_face_check() lets the
-- vendor (any status, including approved) store the selfie / match / OCR evidence without touching status.
alter table public.vendor_student_verification add column if not exists face_v int not null default 0;
-- function public.submit_face_check(p_selfie_url, p_distance, p_match, p_liveness, p_ocr_matric, p_ocr_name, p_ocr_text) security definer
