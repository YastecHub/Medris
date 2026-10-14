-- Follow notifications now default to "All" (the bell next to "Following" shows All / Most relevant / Off).
-- The column defaults in 01_tables.sql are already "all"; this brings older rows in line.
--
-- Only rows the follower never changed are touched: updated_at = created_at means nobody saved a preference
-- after the follow was created, so the row is still the app's own default and not a choice. Anyone who picked
-- "Most relevant" or "Off" themselves keeps it.
--
-- Review before running; it is not applied automatically. Safe to run twice.

update public.vendor_follow_preferences
set notify_new_listing = true,
    notify_new_service = true,
    notify_new_package = true,
    notify_new_variety = true,
    notify_price_change = true,
    notify_discount = true,
    mute_mode = 'none',
    muted_until = null
where updated_at = created_at
  and not (notify_new_listing and notify_new_service and notify_new_package
           and notify_new_variety and notify_price_change and notify_discount
           and mute_mode = 'none');
