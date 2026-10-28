-- =============================================================================
-- 0028  Only a person's first 3 comments each week earn points
-- Why:        To stop people farming points with comments: whoever comments, only their first 3 comments of the week
--             (on any shop's products) give the shop points. Later comments are fine but earn nothing.
-- Changes:    public.trg_points_comment(): the weekly limit is counted per commenter across all shops (before: per shop).
--             Everything else stays: 5 points, at most 10 a day per shop, the shop's own comments give no points,
--             emojis and stickers count.
-- Roll back:  restore the function from 0027_comment_points_any_comment.sql.
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0028).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

update public.points_rules
   set description = 'Someone else commented on one of your products (emojis count too). Up to 10 a day. Each person''s first 3 comments of the week earn points; later ones do not.'
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
     where kind = 'product_comment' and source_user_id = NEW.user_id and week_start = v_week;
    if v_cnt >= 3 then
      perform public.points_log_skip(v_user, 'product_comment', 'comment:' || NEW.id, 'This person already earned points with 3 comments this week');
      return NEW;
    end if;
    perform public.award_points(v_user, 'product_comment', 'comment:' || NEW.id, NEW.user_id, 'Comment on your product',
                                jsonb_build_object('product_id', NEW.product_id));
  exception when others then raise warning 'points comment: %', sqlerrm;
  end;
  return NEW;
end $$;
