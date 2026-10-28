-- =============================================================================
-- 0029  Comment points: a person's first 3 comments of a day, on at most 3 days a week
-- Why:        People can comment as much as they like, but points come only from a person's first 3 comments each day,
--             and only on the first 3 days of the week on which they earned points. (Before: 3 comments a week in total.)
-- Changes:    public.trg_points_comment(): counts the commenter's earlier point-earning comments today (Lagos time, across
--             all shops) and the distinct days this week on which they earned. Everything else stays: 5 points, at most
--             10 a day per shop, a shop's own comments give no points, emojis and stickers count.
-- Roll back:  restore the function from 0028_comment_points_three_a_week.sql.
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0029).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

update public.points_rules
   set description = 'Someone else commented on one of your products (emojis count too). Each person''s first 3 comments of a day earn points, on up to 3 days a week.'
 where kind = 'product_comment';

create or replace function public.trg_points_comment() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_today int; v_days int; v_today_counted boolean; v_week date := public.points_week_start();
        v_day date := (now() at time zone 'Africa/Lagos')::date;
begin
  begin
    select v.user_id into v_user from public.products p join public.vendors v on v.id = p.vendor_id where p.id = NEW.product_id;
    if v_user is null or v_user = NEW.user_id then return NEW; end if;
    if length(trim(coalesce(NEW.content, ''))) = 0 then return NEW; end if;
    select count(*) filter (where (created_at at time zone 'Africa/Lagos')::date = v_day),
           count(distinct (created_at at time zone 'Africa/Lagos')::date)
      into v_today, v_days
      from public.points_ledger
     where kind = 'product_comment' and source_user_id = NEW.user_id and week_start = v_week;
    v_today_counted := v_today > 0;
    if v_today >= 3 then
      perform public.points_log_skip(v_user, 'product_comment', 'comment:' || NEW.id, 'This person already earned points with 3 comments today');
      return NEW;
    end if;
    if not v_today_counted and v_days >= 3 then
      perform public.points_log_skip(v_user, 'product_comment', 'comment:' || NEW.id, 'This person already earned comment points on 3 days this week');
      return NEW;
    end if;
    perform public.award_points(v_user, 'product_comment', 'comment:' || NEW.id, NEW.user_id, 'Comment on your product',
                                jsonb_build_object('product_id', NEW.product_id));
  exception when others then raise warning 'points comment: %', sqlerrm;
  end;
  return NEW;
end $$;
