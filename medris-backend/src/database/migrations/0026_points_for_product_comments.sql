-- =============================================================================
-- 0026  Points for real comments on a shop's products
-- Why:        Shops should be rewarded when other people take the time to comment on their products.
-- Changes:    new points rule 'product_comment': 5 points per comment, at most 10 a day per shop; a trigger on
--             product_comments awards it. Only comments from someone else count (not the shop's own), they must be real
--             (at least 12 characters, 3 words and 5 different letters), and the same person counts at most 3 times a
--             week for the same shop. Skipped comments are written to the points log with the reason.
-- Roll back:  drop trigger trg_points_comment on public.product_comments; drop function public.trg_points_comment();
--             delete from public.points_rules where kind = 'product_comment'; (points already given stay in the ledger).
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0026).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

insert into public.points_rules (kind, label, description, points, audience, category, icon, daily_cap, weekly_cap, sort_order, active)
select 'product_comment', 'Comment on your product',
       'Someone else wrote a real comment on one of your products. Up to 10 a day; the same person counts up to 3 times a week.',
       5, 'vendor', 'reputation', 'fa-comment', 10, null, 55, true
 where not exists (select 1 from public.points_rules where kind = 'product_comment');

create or replace function public.trg_points_comment() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_text text; v_words int; v_letters int; v_cnt int; v_week date := public.points_week_start();
begin
  begin
    select v.user_id into v_user from public.products p join public.vendors v on v.id = p.vendor_id where p.id = NEW.product_id;
    if v_user is null or v_user = NEW.user_id then return NEW; end if;
    v_text := trim(regexp_replace(coalesce(NEW.content, ''), '\s+', ' ', 'g'));
    v_words := coalesce(array_length(regexp_split_to_array(v_text, ' '), 1), 0);
    select count(distinct c) into v_letters from regexp_split_to_table(lower(v_text), '') c where c ~ '[[:alpha:]]';
    if length(v_text) < 12 or v_words < 3 or v_letters < 5 then
      perform public.points_log_skip(v_user, 'product_comment', 'comment:' || NEW.id, 'The comment was too short to count');
      return NEW;
    end if;
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

drop trigger if exists trg_points_comment on public.product_comments;
create trigger trg_points_comment after insert on public.product_comments
  for each row execute function public.trg_points_comment();
