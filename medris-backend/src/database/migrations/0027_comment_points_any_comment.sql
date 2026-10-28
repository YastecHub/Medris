-- =============================================================================
-- 0027  Any comment counts for points (emojis, short, any language)
-- Why:        People may comment anything, including emojis and one-tap reactions. The "at least 12 characters, 3 words and
--             5 different letters" test of 0026 is removed. The limits stay: only someone else's comment counts (not the
--             shop's own), at most 10 comments a day per shop, and the same person counts at most 3 times a week.
-- Changes:    public.trg_points_comment() no longer checks the length or the words of the comment (it must not be empty).
-- Roll back:  restore the function from 0026_points_for_product_comments.sql.
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0027).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

update public.points_rules
   set description = 'Someone else commented on one of your products (emojis count too). Up to 10 a day; the same person counts up to 3 times a week.'
 where kind = 'product_comment';

create or replace function public.trg_points_comment() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_cnt int; v_week date := public.points_week_start();
begin
  begin
    select v.user_id into v_user from public.products p join public.vendors v on v.id = p.vendor_id where p.id = NEW.product_id;
    if v_user is null or v_user = NEW.user_id then return NEW; end if;
    if length(trim(coalesce(NEW.content, ''))) = 0 then return NEW; end if;
    select count(*) into v_cnt from public.points_ledger
     where user_id = v_user and kind = 'product_comment' and source_user_id = NEW.user_id and week_start = v_week;
    if v_cnt >= 3 then
      perform public.points_log_skip(v_user, 'product_comment', 'comment:' || NEW.id, 'Same person already counted 3 times this week');
      return NEW;
    end if;
    perform public.award_points(v_user, 'product_comment', 'comment:' || NEW.id, NEW.user_id, 'Comment on your product',
                                jsonb_build_object('product_id', NEW.product_id));
  exception when others then raise warning 'points comment: %', sqlerrm;
  end;
  return NEW;
end $$;
