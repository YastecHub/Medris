-- =============================================================================
-- 0023  A shop can change its own referral code
-- Why:        Shops want their referral code to be their name (or anything easy to say). Until now the code was
--             generated once and a trigger refused every change.
-- Changes:    the trigger on vendors lets a change through when it comes from set_my_referral_code(); that function
--             checks the new code (4 to 16 letters or digits, not taken, not reserved), saves it in capitals and
--             records the old one in vendor_referral_code_history. Codes are matched without caring about capitals.
-- Roll back:  drop function public.set_my_referral_code(text); drop table public.vendor_referral_code_history;
--             and restore the previous body of public.trg_vendor_referral_code() (keep OLD.referral_code on update).
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0023).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.vendor_referral_code_history (
  id bigserial primary key,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  old_code text,
  new_code text not null,
  changed_at timestamptz not null default now()
);
alter table public.vendor_referral_code_history enable row level security;

create or replace function public.trg_vendor_referral_code() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if NEW.referral_code is null or NEW.referral_code = '' then
      NEW.referral_code := public.generate_referral_code(NEW.business_name);
    end if;
  else
    if OLD.referral_code is not null then
      -- only set_my_referral_code() may change it
      if coalesce(current_setting('levro.referral_change', true), '') <> 'on' then NEW.referral_code := OLD.referral_code; end if;
    elsif NEW.referral_code is null then NEW.referral_code := public.generate_referral_code(NEW.business_name); end if;
  end if;
  return NEW;
end $$;

create or replace function public.set_my_referral_code(p_code text) returns jsonb
  language plpgsql security definer set search_path to 'public' as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into v from public.vendors where user_id = auth.uid() and deleted_at is null limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_a_shop', 'message', 'Only shops have a referral code.'); end if;
  if length(c) < 4 or length(c) > 16 then
    return jsonb_build_object('ok', false, 'error', 'bad_length', 'message', 'Use 4 to 16 letters or numbers, no spaces.');
  end if;
  if c in ('VOID', 'LEVROMART', 'LEVROMARTADMIN', 'ADMIN') then
    return jsonb_build_object('ok', false, 'error', 'reserved', 'message', 'That code is not available. Try another.');
  end if;
  if c = v.referral_code then return jsonb_build_object('ok', true, 'referral_code', c, 'unchanged', true); end if;
  if exists (select 1 from public.vendors where referral_code = c and id <> v.id) then
    return jsonb_build_object('ok', false, 'error', 'taken', 'message', 'Someone already uses that code. Try another.');
  end if;
  if (select count(*) from public.vendor_referral_code_history where vendor_id = v.id and changed_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'message', 'You changed it a lot today. Try again tomorrow.');
  end if;
  perform set_config('levro.referral_change', 'on', true);
  update public.vendors set referral_code = c where id = v.id;
  perform set_config('levro.referral_change', 'off', true);
  insert into public.vendor_referral_code_history (vendor_id, old_code, new_code) values (v.id, v.referral_code, c);
  return jsonb_build_object('ok', true, 'referral_code', c);
end $$;

revoke all on function public.set_my_referral_code(text) from public;
grant execute on function public.set_my_referral_code(text) to authenticated;
