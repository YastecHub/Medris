# Levromart database (Supabase / PostgreSQL)

Live project: `ovklnoroyxobijgvsyfp`. Standby copy: `rtmnrdzmcnlhqfptgkkn` (kept in step by hand).

| File | Contents |
|---|---|
| `01_tables.sql` | All 64 tables, grouped A–I, with columns, types, defaults, primary keys |
| `02_cron_jobs.sql` | The 4 pg_cron jobs |
| `export.sh` | Re-exports everything (schema, functions, policies, triggers, cron) into `supabase/export/` |
| this file | Index of functions, triggers, policies and conventions |

Security model: **Row Level Security is on for every table** (144 policies). Anything that must
bypass RLS is a `SECURITY DEFINER` function that checks `auth.uid()` itself. The browser only holds
the public anon key; payment secrets, the service-role key and the webhook secret live in Vercel
environment variables / inside two database functions (see "Secrets" below).

## Functions by area (233)

Names marked **(definer)** run with elevated rights. Overloads are listed once.

**Orders & checkout** – `create_sale_order` (3 overloads), `create_rental_order`, `create_package_order`,
`create_cart_order`, `create_rental_booking`, `edit_buyer_order`, `edit_pending_order`, `transition_order_status`,
`vendor_decline_order`, `set_order_buyer_note`, `set_order_buyer_location`, `set_order_item_variant`,
`add_order_note`, `send_order_reminder`, `remind_unattended_orders` (cron), `auto_complete_eligible_orders`,
`get_order_buyer_contact` (vendors see the customer's name only after accepting; phone is admin-only),
`get_order_vendor_payment_details`, `compute_delivery_fee`, `compute_product_delivery_fee`.

**Payments & disputes** – `create_payment_intent`, `record_offline_payment`, `buyer_report_manual_payment`,
`vendor_confirm_reported_payment`, `vendor_dispute_reported_payment`, `vendor_confirm_unreported_payment`,
`vendor_dispute_unreported_payment`, `escalate_unresolved_payment_orders` (cron), `process_payment_unresolved_escalations`,
`raise_dispute`, `vendor_respond_to_dispute`, `resolve_dispute`, `admin_confirm_reported_payment`,
`admin_reject_reported_payment`, `admin_list_transactions`, `admin_list_vendor_payouts`.

**Commission & vendor billing** – `create_commission_payment_intent`, `enforce_commission_deadlines`,
`process_commission_deadline_reminders` (cron 07:00; reminders at 5/3/2/1 days + due day),
`process_vendor_commission_hour_reminders`, `get_vendor_commission_owed`, `get_vendor_commission_deadline`,
`get_vendor_commission_breakdown`, `set_vendor_billing_model`, `compute_monthly_billing_amount`,
`submit_monthly_listing_payment`, `admin_approve_monthly_listing`, `admin_reject_monthly_listing`,
`admin_deactivate_monthly_listing`, `process_listing_billing_reminders`, `record_order_completion_commission` (trigger).

**Vendors & admin** – `submit_vendor_application`, `admin_approve_vendor`, `admin_reject_vendor`,
`admin_set_vendor_status`, `admin_delete_vendor`, `admin_trash_vendor`, `admin_restore_vendor`,
`admin_permanently_delete_vendor`, `admin_force_unlock_vendor`, `admin_list_locked_vendors`,
`admin_set_vendor_storefront_active`, `vendor_set_storefront_active`, `admin_set_user_role`,
`admin_suspend_user`, `admin_unsuspend_user`, `admin_get_pending_appeals`, `admin_deny_appeal`,
`submit_account_appeal`, `admin_*_manual_password_reset`, `request_manual_password_reset`,
`complete_manual_password_reset`, `admin_list_conversations`, `admin_find_conversation`,
`admin_get_conversation_participants`, `delete_my_account`, `get_vendor_stats`, `get_vendor_product_regions`,
`get_vendor_payment_details`, `increment_vendor_profile_view`, `nearby_vendors`.

**Catalogue & search** – `search_products_full` (original) and `search_products_full_v2` (adds vendor id,
rating, review count, listing type, service unit — used by the Search page; the app falls back to the original
if v2 is missing), `search_product_ids`, `save_product_variants`, `get_owned_product_variants`,
`increment_product_view`, `get_favorite_count(s)`, `get_product_reviews`, `get_reviewable_order_for_product`,
`create_vendor_category`, `create_vendor_sector`, `get_or_create_custom_sector`, `admin_delete_inventory_product`, `admin_get_inventory`.

**Cart** – `add_to_cart`, trigger `prevent_vendor_self_cart_item`.

**Messaging & calls** – `get_or_create_conversation`, `list_my_conversations` (open chats only; shows the shop
name/logo to buyers), `conversation_is_open` (a chat closes 24 h after its order completes — it is hidden,
never deleted), `mark_conversation_opened`, `toggle_conversation_pin`, `toggle_conversation_unread`,
`edit_message`, `delete_message`, `toggle_message_reaction`, `create_chat_list`, `delete_chat_list`,
`list_my_chat_lists`, `toggle_conversation_in_list`, `get_conversation_other_party`, `get_conversation_presence`,
`touch_last_seen`, `am_i_blocked_with`, `is_blocked_between`, `buyer_can_message_vendor`,
`can_call_in_conversation`, `get_call_party`, `start_voice_call`, `update_voice_call`, `ring_callee_again`
(re-sends the call push; contains the webhook secret), `chat_purge_candidates` (intentionally returns nothing).

**Follows & social** – `toggle_vendor_follow`, `get_vendor_follow_state(s)`, `get_vendor_follower_counts`,
`get_vendor_followers`, `is_vendor_follower`, `set_vendor_follow_preferences`, `submit_suggestion`,
`get_vendor_suggestions`, `get_platform_suggestions`, `mark_suggestion_read`, `get_product_comment_counts`,
`get_package_comment_counts`, `get_package_favorite_counts`.

**Requests, offers & service offers** – `accept_request_offer`, `create_service_offer`, `respond_service_offer`,
`report_service_offer_payment`, `confirm_service_offer_payment`, `dispute_service_offer_payment`,
`get_service_price_hint`, `process_service_offer_deadlines` (cron).

**Notifications** – `create_notification`, `notify_admins`, and the `notify_*` trigger functions (new order, order
status, message, review, offer, request, payment, dispute, signup, vendor application, follows, listing events,
low stock). `notify_email_on_notification` forwards every notification row to `/api/notify` (email + push).

**Levi (AI)** – `increment_chat_usage`, `increment_tts_usage`, `search_ai_conversations`,
`set_ai_conversation_shared`, `get_shared_ai_conversation`, `toggle_ai_message_reaction`.

**Accounts & roles** – `handle_new_user`, `handle_new_levromart_user`, `current_role`, `is_admin`,
`owns_vendor`, `is_vendor_owner`, `resolve_account_role`, `sync_current_account_role`,
`accept_legal_terms`, `get_legal_terms_consent` (terms version string), `record_auth_activity`,
`log_auth_session_start`, `get_my_account_appeal`.

**Housekeeping triggers** – `set_updated_at_timestamp`, `touch_*`, `sync_*`, `prevent_*`, `enforce_*`,
`set_*_snapshot`, `levromart_stamp_order_status`, `normalize_*`, `rls_auto_enable`.

## Triggers (60)

`orders`: stamp status clock, normalize payment terms, require buyer phone, prevent vendor self-order, guard
unverified completion, notify new order / status change, record commission on completion, restore stock when a sale
is cancelled. `payments`: notify paid, mark order "payment unresolved" from a claim. `messages`: notify new message
(sends sender photo / shop identity). `notifications`: email + push forwarder. `vendors`: onboarding requirements,
phone validation, commission-activation guard, role sync, profile-updated, payout setup notice, new application notice.
`users`: prevent self role change, avatar syncs, new signup notice. `products` / `vendor_packages` /
`product_variants`: notify followers, low stock, remove monthly submission when removed. `reviews`: snapshot buyer,
notify, update vendor rating. `favorites`, `product_comments`, `product_comment_likes`, `vendor_follows`,
`request_offers`, `equipment_requests`, `disputes`, `service_offers`, `support_requests`, `ai_messages`,
`listing_drafts`, `homepage_carousel_slides`, `message_pins` (limit), `cart_items` (no self purchase),
`order_items` (deposit percent sync), `admin_actions` (notify admins).

## Row-level security (144 policies)

Every table has RLS. Typical shapes: owner-only (`user_id = auth.uid()`), participant-only
(conversations/messages/voice_calls), vendor-owner (`owns_vendor(vendor_id)`), public read
(`reviews`, `sectors`, `categories`, active catalogue) and admin override (`is_admin()`).
Policy count per table: orders 3, vendors 3, products 4, messages 3, notifications 4, voice_calls 1 (participants read;
writes go through `start_voice_call` / `update_voice_call`), all others 1–5.

## Secrets (not in git)

Two functions embed the webhook secret used to call `/api/notify`:
`notify_email_on_notification` and `ring_callee_again`. When you re-create them in a new project set the same
value as the `EMAIL_WEBHOOK_SECRET` environment variable in Vercel.

## Conventions

* Functions are `snake_case`, parameters start with `p_`.
* Money is `numeric` in naira (not kobo); the Paystack API converts at the edge in `api/`.
* Never delete chats; `conversation_is_open` hides them instead.
* When adding an RPC that the browser calls, make it `SECURITY DEFINER`, `set search_path = public`, check
  `auth.uid()` first, and `grant execute ... to authenticated`.
