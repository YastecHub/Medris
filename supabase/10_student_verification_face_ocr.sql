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
