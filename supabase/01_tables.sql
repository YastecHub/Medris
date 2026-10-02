-- =============================================================================
-- LEVROMART  ·  DATABASE  ·  01 TABLES  (public schema, 64 tables)
-- =============================================================================
-- Reference snapshot of the live schema (Supabase project ovklnoroyxobijgvsyfp).
-- Foreign keys, indexes, RLS policies, triggers and functions are described in
-- supabase/README.md and can be re-exported in full with supabase/export.sh.
-- Enum types used below: order_status, order_type, delivery_method, payment_type,
-- payment_method, payment_status, dispute_status, dispute_raised_by, listing_type,
-- product_condition, product_status, user_role, vendor_verification_status.
--
-- GROUPS
--   A. Accounts & admin        users, vendors, account_appeals, admin_actions, admin_login_otps,
--                              auth_activity_logs, password_reset_requests, user_presence, blocked_users
--   B. Catalogue               sectors, categories, products, product_variants, vendor_packages,
--                              package_items, search_synonyms, listing_drafts, homepage_carousel_slides
--   C. Orders & payments       orders, order_items, order_notes, payments, disputes, bookings,
--                              service_offers, request_offers, equipment_requests, reviews
--   D. Vendor billing          commission_charges, commission_settlements, commission_deadline_reminders,
--                              vendor_monthly_charges, monthly_listing_submissions,
--                              listing_billing_reminders, listing_payment_intents, vendor_recycle_bin
--   E. Messaging & calls       conversations, messages, message_pins, chat_lists,
--                              chat_list_conversations, chat_archive, voice_calls
--   F. Social                  vendor_follows, vendor_follow_preferences, favorites, package_favorites,
--                              product_comments(+likes), package_comments(+likes),
--                              product_engagement_settings, package_engagement_settings, suggestions
--   G. Notifications           notifications, push_subscriptions
--   H. Levi (AI assistant)     ai_conversations, ai_messages, chat_usage, tts_usage
--   I. Misc                    cart_items, support_requests, inventory, vendor_profile_view_events
-- =============================================================================


-- ============================ A. ACCOUNTS & ADMIN ============================

create table public.users (
  id uuid not null,
  name text not null default ''::text,
  phone text,
  email text,
  role user_role not null default 'buyer'::user_role,
  city text,
  created_at timestamp with time zone not null default now(),
  avatar_url text,
  address text,
  ai_data_consent boolean not null default false,
  role_selected boolean not null default true,
  suspended_at timestamp with time zone,
  suspended_reason text,
  suspended_by uuid,
  is_super_admin boolean not null default false,
  has_password boolean not null default false,
  otp_verified_at timestamp with time zone not null default now(),
  legal_terms_version text,
  legal_terms_accepted_at timestamp with time zone,
  primary key (id)
);

create table public.vendors (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  business_name text not null,
  logo_url text,
  cover_image_url text,
  bio text,
  address text,
  city text,
  phone text,
  whatsapp_number text,
  verification_status vendor_verification_status not null default 'pending'::vendor_verification_status,
  cac_number text,
  verification_docs text[] not null default '{}'::text[],
  delivery_radius_km numeric,
  opening_hours text,
  avg_rating numeric,
  created_at timestamp with time zone not null default now(),
  is_active boolean not null default true,
  bank_code text,
  bank_name text,
  account_number text,
  account_name text,
  paystack_subaccount_code text,
  commission_pct numeric(5,2) not null default 3.00,
  delivery_fee numeric not null default 0,
  sector_id uuid not null,
  deleted_at timestamp with time zone,
  transfer_recipient_code text,
  billing_model text not null default 'commission'::text,
  paystack_authorization_code text,
  paystack_customer_code text,
  monthly_billing_status text not null default 'inactive'::text,
  next_monthly_charge_at timestamp with time zone,
  review_count integer not null default 0,
  lat double precision,
  lng double precision,
  business_hours jsonb,
  allow_after_hours_messages boolean not null default true,
  delivery_fee_mode text not null default 'flat'::text,
  delivery_fee_per_km numeric not null default 0,
  previous_business_name text,
  name_changed_at timestamp with time zone,
  whatsapp_visible boolean not null default false,
  cover_url text,
  commission_paused boolean not null default false,
  commission_pause_reason text,
  deleted_previous_verification_status vendor_verification_status,
  deleted_previous_is_active boolean,
  admin_paused boolean not null default false,
  profile_view_count integer not null default 0,
  primary key (id)
);

create table public.account_appeals (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  suspension_reason text,
  message text not null,
  status text not null default 'pending'::text,
  admin_response text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  resolved_by uuid,
  primary key (id)
);

create table public.admin_actions (
  id uuid not null default gen_random_uuid(),
  admin_id uuid not null,
  admin_name text,
  action text not null,
  target_type text not null,
  target_id uuid,
  target_label text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.admin_login_otps (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  code text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.auth_activity_logs (
  id uuid not null default gen_random_uuid(),
  session_id uuid,
  user_id uuid not null,
  event_type text not null,
  occurred_at timestamp with time zone not null default now(),
  user_agent text,
  ip inet,
  source text not null default 'app'::text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.password_reset_requests (
  id uuid not null default gen_random_uuid(),
  email text not null,
  user_id uuid,
  status text not null default 'pending'::text,
  token_hash text not null,
  created_at timestamp with time zone not null default now(),
  approved_at timestamp with time zone,
  approved_by uuid,
  rejected_at timestamp with time zone,
  rejected_by uuid,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone not null default (now() + '00:30:00'::interval),
  primary key (id)
);

create table public.user_presence (
  user_id uuid not null,
  last_seen_at timestamp with time zone not null default now(),
  primary key (user_id)
);

create table public.blocked_users (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (blocker_id, blocked_id)
);


-- ================================ B. CATALOGUE ===============================

create table public.sectors (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  icon text not null default 'fa-shapes'::text,
  sort_order integer not null default 0,
  primary key (id)
);

create table public.categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  parent_category_id uuid,
  sector_id uuid not null,
  primary key (id)
);

create table public.products (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  category_id uuid,
  name text not null,
  description text,
  photos text[] not null default '{}'::text[],
  condition product_condition not null default 'used-good'::product_condition,
  listing_type listing_type not null,
  sale_price numeric,
  rental_rate numeric,
  rental_rate_unit text,
  deposit_amount numeric,
  quantity_total integer not null default 1,
  quantity_available integer not null default 1,
  status product_status not null default 'active'::product_status,
  created_at timestamp with time zone not null default now(),
  view_count integer not null default 0,
  is_service boolean not null default false,
  service_price_unit text,
  discount_price numeric,
  delivery_fee_mode text not null default 'free'::text,
  delivery_fee numeric not null default 0,
  delivery_fee_per_km numeric not null default 0,
  billing_model text not null default 'commission'::text,
  billing_status text not null default 'active'::text,
  billing_paid_until timestamp with time zone,
  billing_reference text,
  payment_timing text not null default 'pay_before'::text,
  payment_deposit_percent numeric(5,2) not null default 20,
  admin_deleted_at timestamp with time zone,
  admin_deleted_by uuid,
  track_quantity boolean not null default true,
  primary key (id)
);

create table public.product_variants (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  name text not null,
  photo_url text,
  sale_price numeric,
  discount_price numeric,
  rental_rate numeric,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  quantity_available integer not null default 0,
  size text,
  color text,
  description text,
  quantity_total integer,
  primary key (id)
);

create table public.vendor_packages (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  name text not null,
  description text,
  price numeric not null,
  status product_status not null default 'active'::product_status,
  created_at timestamp with time zone not null default now(),
  photos jsonb not null default '[]'::jsonb,
  billing_model text not null default 'commission'::text,
  billing_status text not null default 'active'::text,
  billing_paid_until timestamp with time zone,
  billing_reference text,
  primary key (id)
);

create table public.package_items (
  id uuid not null default gen_random_uuid(),
  package_id uuid not null,
  product_id uuid not null,
  quantity integer not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.search_synonyms (
  term text not null,
  synonym text not null,
  primary key (term, synonym)
);

create table public.listing_drafts (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  kind text not null,
  draft_data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.homepage_carousel_slides (
  id uuid not null default gen_random_uuid(),
  storage_path text not null,
  image_url text not null,
  link_url text,
  alt_text text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);


-- =========================== C. ORDERS & PAYMENTS ============================

create table public.orders (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  vendor_id uuid not null,
  order_type order_type not null,
  status order_status not null default 'pending'::order_status,
  total_amount numeric not null default 0,
  deposit_amount numeric not null default 0,
  delivery_method delivery_method not null,
  delivery_address text,
  created_at timestamp with time zone not null default now(),
  delivery_phone text,
  delivery_fee numeric not null default 0,
  package_id uuid,
  payout_status text not null default 'not_applicable'::text,
  auto_release_at timestamp with time zone,
  payout_released_at timestamp with time zone,
  payout_transfer_code text,
  awaiting_confirmation_since timestamp with time zone,
  last_reminder_sent_at timestamp with time zone,
  buyer_note text,
  status_changed_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  auto_completed_at timestamp with time zone,
  payment_timing text not null default 'pay_before'::text,
  payment_deposit_percent numeric(5,2) not null default 20,
  buyer_lat double precision,
  buyer_lng double precision,
  service_offer_id uuid,
  commission_exempt boolean not null default false,
  payment_unresolved_at timestamp with time zone,
  payment_escalated_at timestamp with time zone,
  cancellation_reason text,
  primary key (id)
);

create table public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid not null,
  quantity integer not null,
  unit_price numeric not null,
  rental_start_date date,
  rental_end_date date,
  created_at timestamp with time zone not null default now(),
  variant_id uuid,
  primary key (id)
);

create table public.order_notes (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  sender_id uuid not null,
  body text not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.payments (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  payment_type payment_type not null,
  amount numeric not null,
  method payment_method not null,
  status payment_status not null default 'pending'::payment_status,
  provider_reference text,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone,
  primary key (id)
);

create table public.disputes (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  raised_by dispute_raised_by not null,
  reason text not null,
  status dispute_status not null default 'open'::dispute_status,
  admin_notes text,
  created_at timestamp with time zone not null default now(),
  vendor_response text,
  primary key (id)
);

create table public.bookings (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  order_item_id uuid not null,
  date_range daterange not null,
  quantity integer not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.service_offers (
  id uuid not null default gen_random_uuid(),
  listing_id uuid not null,
  buyer_id uuid not null,
  vendor_id uuid not null,
  description text not null,
  current_price numeric(12,2) not null,
  current_offer_by text not null,
  status text not null default 'pending'::text,
  round_count integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '72:00:00'::interval),
  accepted_at timestamp with time zone,
  payment_reported_at timestamp with time zone,
  completed_at timestamp with time zone,
  order_id uuid,
  payment_reminder_sent_at timestamp with time zone,
  vendor_confirmation_reminder_sent_at timestamp with time zone,
  primary key (id)
);

create table public.equipment_requests (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  title text not null,
  description text,
  category_id uuid,
  city text,
  needed_from date,
  needed_to date,
  status text not null default 'open'::text,
  created_at timestamp with time zone not null default now(),
  request_type text not null default 'rent'::text,
  buyer_name text,
  buyer_avatar_url text,
  primary key (id)
);

create table public.request_offers (
  id uuid not null default gen_random_uuid(),
  request_id uuid not null,
  vendor_id uuid not null,
  message text,
  price numeric(12,2),
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.reviews (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  buyer_id uuid not null,
  vendor_id uuid not null,
  rating integer not null,
  comment text,
  created_at timestamp with time zone not null default now(),
  buyer_name text,
  buyer_avatar_url text,
  primary key (id)
);


-- ============================= D. VENDOR BILLING =============================

create table public.commission_charges (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  payment_id uuid,
  order_id uuid,
  amount numeric(12,2) not null,
  status text not null default 'owed'::text,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone,
  due_at timestamp with time zone default (now() + '7 days'::interval),
  primary key (id)
);

create table public.commission_settlements (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  amount numeric(12,2) not null,
  status text not null default 'pending'::text,
  provider_reference text,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone,
  primary key (id)
);

create table public.commission_deadline_reminders (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  reminder_code text not null,
  period_key timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.vendor_monthly_charges (
  id uuid not null default gen_random_uuid(),
  vendor_id uuid not null,
  listing_count integer not null,
  amount numeric not null,
  status text not null default 'pending'::text,
  provider_reference text,
  failure_reason text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.monthly_listing_submissions (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  listing_id uuid not null,
  vendor_id uuid not null,
  user_id uuid not null,
  payer_name text not null,
  receipt_path text not null,
  status text not null default 'pending'::text,
  submitted_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.listing_billing_reminders (
  kind text not null,
  listing_id uuid not null,
  reminder_code text not null,
  period_key date not null,
  sent_at timestamp with time zone not null default now(),
  primary key (kind, listing_id, reminder_code, period_key)
);

create table public.listing_payment_intents (
  id uuid not null default gen_random_uuid(),
  reference text not null,
  user_id uuid not null,
  vendor_id uuid not null,
  kind text not null,
  amount_naira numeric(12,2) not null default 1000,
  status text not null default 'pending'::text,
  listing_id uuid,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone,
  consumed_at timestamp with time zone,
  draft_data jsonb,
  primary key (id)
);

create table public.vendor_recycle_bin (
  vendor_id uuid not null,
  deleted_at timestamp with time zone not null default now(),
  deleted_by uuid,
  product_statuses jsonb not null default '[]'::jsonb,
  package_statuses jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  primary key (vendor_id)
);


-- ========================== E. MESSAGING & CALLS ==============================

create table public.conversations (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  vendor_id uuid not null,
  created_at timestamp with time zone not null default now(),
  pinned_by_buyer boolean not null default false,
  pinned_by_vendor boolean not null default false,
  marked_unread_by_buyer boolean not null default false,
  marked_unread_by_vendor boolean not null default false,
  primary key (id)
);

create table public.messages (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid not null,
  body text not null,
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone,
  delivered_at timestamp with time zone,
  reactions jsonb not null default '{}'::jsonb,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  reply_to_id uuid,
  primary key (id)
);

create table public.message_pins (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  message_id uuid not null,
  pinned_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  primary key (id)
);

create table public.chat_lists (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.chat_list_conversations (
  list_id uuid not null,
  conversation_id uuid not null,
  added_at timestamp with time zone not null default now(),
  primary key (list_id, conversation_id)
);

-- Safety copy of chats (conversations are never deleted; they only close 24h after an order completes).
create table public.chat_archive (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  buyer_id uuid,
  vendor_id uuid,
  conversation jsonb not null,
  messages jsonb not null,
  archived_at timestamp with time zone not null default now(),
  primary key (id)
);

-- status: ringing | ended | missed | declined.  The chat reads this table to show call log rows.
create table public.voice_calls (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  caller_id uuid not null,
  callee_id uuid not null,
  status text not null default 'ringing'::text,
  created_at timestamp with time zone not null default now(),
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  rings integer not null default 0,
  primary key (id)
);


-- ================================= F. SOCIAL ==================================

create table public.vendor_follows (
  id uuid not null default gen_random_uuid(),
  follower_id uuid not null,
  vendor_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.vendor_follow_preferences (
  id uuid not null default gen_random_uuid(),
  follower_id uuid not null,
  vendor_id uuid not null,
  muted_until timestamp with time zone,
  mute_mode text not null default 'none'::text,
  notify_new_listing boolean not null default true,
  notify_new_service boolean not null default true,
  notify_new_package boolean not null default true,
  notify_new_variety boolean not null default true,
  notify_price_change boolean not null default true,
  notify_discount boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.favorites (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  product_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.package_favorites (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  package_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.product_comments (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  user_id uuid not null,
  parent_comment_id uuid,
  content text not null,
  author_name text not null,
  author_avatar_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.product_comment_likes (
  id uuid not null default gen_random_uuid(),
  comment_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.product_engagement_settings (
  product_id uuid not null,
  vendor_id uuid not null,
  like_visibility text not null default 'everyone'::text,
  allow_comments boolean not null default true,
  comment_audience text not null default 'everyone'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (product_id)
);

create table public.package_comments (
  id uuid not null default gen_random_uuid(),
  package_id uuid not null,
  user_id uuid not null,
  parent_comment_id uuid,
  content text not null,
  author_name text not null default 'Levromart user'::text,
  author_avatar_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.package_comment_likes (
  id uuid not null default gen_random_uuid(),
  comment_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);

create table public.package_engagement_settings (
  package_id uuid not null,
  vendor_id uuid not null,
  like_visibility text not null default 'everyone'::text,
  allow_comments boolean not null default true,
  comment_audience text not null default 'everyone'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (package_id)
);

create table public.suggestions (
  id uuid not null default gen_random_uuid(),
  sender_id uuid,
  target_type text not null,
  target_vendor_id uuid,
  message text not null,
  is_anonymous boolean not null default false,
  status text not null default 'new'::text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);


-- ============================= G. NOTIFICATIONS ===============================
-- Every INSERT fires trigger trg_notify_email -> notify_email_on_notification() -> POST /api/notify
-- (email + web push). See supabase/README.md.

create table public.notifications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  body text,
  target_view text,
  target_params jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  actor_avatar_url text,
  read boolean not null default false,
  created_at timestamp with time zone not null default now(),
  archived boolean not null default false,
  deleted_at timestamp with time zone,
  vendor_id uuid,
  notification_category text not null default 'system'::text,
  group_key text,
  metadata jsonb not null default '{}'::jsonb,
  primary key (id)
);

create table public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);


-- ============================ H. LEVI (AI ASSISTANT) ==========================

create table public.ai_conversations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  share_token uuid,
  primary key (id)
);

create table public.ai_messages (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  reaction text,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  primary key (id)
);

create table public.chat_usage (
  user_id uuid not null,
  day date not null default CURRENT_DATE,
  count integer not null default 0,
  primary key (user_id, day)
);

create table public.tts_usage (
  user_id uuid not null,
  day date not null default CURRENT_DATE,
  chars integer not null default 0,
  primary key (user_id, day)
);


-- ================================== I. MISC ===================================

create table public.cart_items (
  id uuid not null default gen_random_uuid(),
  buyer_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 1,
  created_at timestamp with time zone not null default now(),
  variant_id uuid,
  primary key (id)
);

create table public.support_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  subject text not null,
  message text not null,
  status text not null default 'open'::text,
  admin_reply text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  attachments jsonb not null default '[]'::jsonb,
  primary key (id)
);

create table public.inventory (
  id uuid not null default gen_random_uuid(),
  type text not null,
  category text not null,
  item_name text not null,
  blood_group text,
  quantity integer not null default 1,
  urgency text not null,
  hospital_name text not null,
  phone text not null,
  lat double precision,
  lng double precision,
  description text,
  verified boolean not null default false,
  created_at timestamp with time zone not null default now(),
  owner_id uuid,
  primary key (id)
);

create table public.vendor_profile_view_events (
  id bigint not null,
  vendor_id uuid not null,
  viewed_at timestamp with time zone not null default now(),
  primary key (id)
);
