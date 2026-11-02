-- =============================================================================
-- 0031  Vendor of the Week for each campus
-- Why:        Vendor of the Week was one winner for the whole of Levromart. Students want to see who is winning on
--             THEIR campus, and the campus view of the Leaderboard could only hide winners who happened not to be from
--             that campus (usually leaving nothing to show).
-- Changes:    function get_campus_week_winners(campus, limit): for each finished week, the best shop of that campus
--             (same ranking and same rules as the whole-app winner: points, then sales, then who got there first; verified,
--             live, not paused shops only), newest week first, with the top three.
--             function get_campus_vendor_spotlight(campus): the same shape as get_vendor_spotlight(), for one campus:
--             last week's campus winner, this week's campus top three and when the week ends.
--             Read-only: nothing is stored, nothing existing is changed, the whole-app winner works as before. Campus
--             winners are not sent a notification (only the whole-app winner is).
-- Roll back:  drop function public.get_campus_week_winners(text, integer);
--             drop function public.get_campus_vendor_spotlight(text);
-- Approved:   pending (apply: docs/DATABASE.md section 3, --only 0031).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.get_campus_week_winners(p_campus text, p_limit integer default 12)
returns table(week_start date, vendor_id uuid, business_name text, logo_url text, city text, avg_rating numeric,
              review_count integer, bio text, cover text, points integer, top3 jsonb)
  language sql stable security definer set search_path to 'public' as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 12), 52)) n),
  ranked as (
    select pw.week_start ws, pw.user_id uid, v.id vid, v.business_name bn, v.logo_url lu, v.city ct, v.avg_rating ar,
           v.review_count rc, left(coalesce(v.bio, ''), 140) bio, coalesce(v.cover_url, v.cover_image_url) cv, pw.points pts,
           row_number() over (partition by pw.week_start order by pw.points desc, pw.tx_count desc, pw.last_at asc) rn
      from public.points_weekly pw
      join public.vendors v on v.user_id = pw.user_id and v.deleted_at is null and v.verification_status = 'verified'
       and coalesce(v.admin_paused, false) = false and v.campus_id = p_campus
     where p_campus is not null and p_campus <> '' and p_campus <> 'none'
       and pw.week_start < public.points_week_start()
       and pw.week_start >= public.points_week_start() - 7 * (select n from lim)
       and pw.points > 0)
  select r.ws, r.vid, r.bn, r.lu, r.ct, r.ar, r.rc, r.bio, r.cv, r.pts,
         (select jsonb_agg(jsonb_build_object('rank', t.rn, 'user_id', t.uid, 'vendor_id', t.vid, 'business_name', t.bn, 'points', t.pts) order by t.rn)
            from ranked t where t.ws = r.ws and t.rn <= 3)
    from ranked r
   where r.rn = 1
   order by r.ws desc
   limit (select n from lim)
$$;

create or replace function public.get_campus_vendor_spotlight(p_campus text) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as $$
declare cur date := public.points_week_start(); w record; leaders jsonb;
begin
  if p_campus is null or p_campus = '' or p_campus = 'none' then
    return jsonb_build_object('winner', null, 'leaders', '[]'::jsonb, 'week_ends_at', ((cur + 7)::timestamp at time zone 'Africa/Lagos'));
  end if;
  select cw.week_start, cw.points, cw.vendor_id vid, cw.business_name, cw.logo_url, cw.cover, cw.city, cw.avg_rating, cw.review_count, cw.bio
    into w
    from public.get_campus_week_winners(p_campus, 2) cw
    join public.vendors v on v.id = cw.vendor_id and v.is_active = true
   where cw.week_start = cur - 7;
  select coalesce(jsonb_agg(jsonb_build_object('rank', t.rn, 'vendor_id', t.vid, 'business_name', t.bn, 'logo_url', t.lu, 'points', t.pts) order by t.rn), '[]'::jsonb)
    into leaders
    from (select v.id vid, v.business_name bn, v.logo_url lu, pw.points pts,
                 row_number() over (order by pw.points desc, pw.tx_count desc, pw.last_at asc) rn
            from public.points_weekly pw
            join public.vendors v on v.user_id = pw.user_id and v.is_active and v.deleted_at is null
             and v.verification_status = 'verified' and coalesce(v.admin_paused, false) = false and v.campus_id = p_campus
           where pw.week_start = cur and pw.points > 0
           order by pw.points desc, pw.tx_count desc, pw.last_at asc limit 3) t;
  return jsonb_build_object(
    'winner', case when w.vid is null then null else jsonb_build_object('vendor_id', w.vid, 'business_name', w.business_name,
        'logo_url', w.logo_url, 'cover', w.cover, 'city', w.city, 'avg_rating', w.avg_rating, 'review_count', w.review_count,
        'bio', w.bio, 'points', w.points, 'week_start', w.week_start) end,
    'leaders', leaders, 'week_ends_at', ((cur + 7)::timestamp at time zone 'Africa/Lagos'));
end $$;

revoke all on function public.get_campus_week_winners(text, integer) from public;
revoke all on function public.get_campus_vendor_spotlight(text) from public;
grant execute on function public.get_campus_week_winners(text, integer) to anon, authenticated, service_role;
grant execute on function public.get_campus_vendor_spotlight(text) to anon, authenticated, service_role;
