# Design proposal: several businesses, several campuses, shop teams

Status: **proposal for engineer review - nothing here is built yet.** It touches money, permissions and the database,
so it should be agreed before any code is written.

## What the founder wants
1. One person owns **more than one business** (e.g. a food stall and a phone-repair shop) under one login.
2. A business can **serve more than one campus** (the app already has `campus_id`, `operating_scope`, `operating_campuses`).
3. A business can add **team members** (a manager, a cashier/order-handler) who can work on orders and chat without
   seeing bank details or being able to delete the shop.

## Today
`vendors.user_id` is unique per user: one login = one shop. All shop RPCs find the shop by `auth.uid()`.
Orders, chat, wallet, billing and notifications are tied to that single `vendors` row / user.

## Proposed model (smallest safe step)
- Keep `vendors` as "a business". Drop the one-shop-per-user assumption: add `vendors.owner_id` (same value as today's
  `user_id`, so nothing existing changes) and let one owner have many rows.
- New table `vendor_members (vendor_id, user_id, role, invited_by, created_at)` with roles
  `owner | manager | staff`. Policies: owner = everything; manager = orders, chat, listings, no bank/billing/delete;
  staff = orders and chat only.
- A single helper `acting_vendor_id()` / `can_act_for_vendor(vendor_id, permission)` used by every shop RPC instead of
  `auth.uid()` lookups. The app keeps a "currently selected business" and sends its id.
- Notifications: a new order notifies the owner plus members whose role allows orders.
- Campus: no new tables - a business already lists the campuses it serves; the change is only letting each business
  have its own list.

## Why this is not done in one go
- ~every shop-related RPC (orders, wallet, billing, suggestions, chat gating) resolves "the shop" from the logged-in
  user, so each must be changed and parity-tested.
- Payouts, commission lock and legal text (terms/privacy: who is responsible for a business, what team members can see)
  need a lawyer's review.
- Suggested order: (1) `vendor_members` + helper + read-only team list, (2) switch order/chat RPCs to the helper,
  (3) business switcher in the app, (4) multiple businesses per owner, (5) invites by phone/email.

## Open questions for the founder/engineer
- Is commission/billing per business or per owner?
- Can a team member belong to several businesses?
- Does verification (student / non-student) apply per business or per owner?

## Decisions from the founder (11 Nov 2026)
- **Commission is per sale of a product**, not per business or branch: whenever a product sold on the commission method
  is sold, Levromart takes 3%, whichever business/branch it belongs to. Shops on a monthly listing plan pay the
  monthly fee instead. So the billing and commission code needs no per-business logic - it keeps working per order.

## Progress
- **Step 1 (done, migration 0057):** `vendor_members` table and `can_act_for_vendor(vendor_id, permission)` helper. Nothing
  uses them yet, so existing shops are unchanged.
- Next: step 2 (order/chat functions use the helper so a manager/staff can really work on a shop), then the "Team" screen
  and invites, then several businesses per owner. The team screen is held back until step 2 so it never offers people
  access that does not work yet.

## Step 2 inventory (what must change so a manager/staff member can really work on a shop)
Found by reading the baseline SQL and the backend code. This is the list to review before any code is written, because it
decides who can see orders and chat - the most sensitive part of the app.

- **One central helper decides "is this my shop" in policies:** `public.owns_vendor(vendor_id)` is used about 50 times
  in row-level-security policies (orders, order items, products, conversations ...). `is_vendor_owner` is similar.
  Do **not** widen these two: they also guard bank details, wallet and billing, which must stay owner-only.
- **Plan:** add `public.acts_for_vendor(vendor_id, permission)` (already built in 0057 as `can_act_for_vendor`) and switch
  *only* the order, chat and listing policies/functions to it; leave money-and-settings policies on `owns_vendor`.
- **Database functions that look up the shop by the logged-in user (29):** add_to_cart, can_call_in_conversation,
  conversation_is_open, get_call_party, get_conversation_other_party, get_conversation_presence,
  get_order_buyer_contact, get_orders_buyer_names, list_my_conversations, mark_conversation_opened,
  toggle_conversation_in_list / _pin / _unread, set_order_item_variant, plus shop-settings ones that stay owner-only
  (create_vendor_category/sector, set_vendor_billing_model, submit_monthly_listing_payment, submit_face_check,
  get_vendor_commission_deadline, get_points_leaderboard, vendor_set_storefront_active, ...).
- **Backend code (26 places in 14 repositories):** orders, order-actions and conversations repositories (reminders,
  buyer names/avatar, conversation lists) move to the permission check; wallet, payouts, commission, packages-billing
  stay owner-only. Each moved query needs a parity test that a member sees the shop's orders and a stranger does not.
- **Notifications:** `create_notification` for a new order / message goes to the owner only today; it must also go to
  members whose role allows orders/chat (and WhatsApp alerts keep going to the owner's number).
- **Needs a decision before coding:** should a member's actions show their own name to the customer, or the shop's?
  (Recommended: the shop's name, with the member recorded in the order history for disputes.)
- **Legal:** terms/privacy must say that a shop's team members can see its orders and customer delivery details.
- **Step 2a (done, migration 0059):** a manager/staff member can *see* the shop's orders and chats (read only, four extra
  row-level policies; nobody is on a team yet, so nobody sees anything new). Tested in `tests/team-permissions.test.ts`.
  Still to do: letting members *act* (accept/decline, reply), routing new-order/message notifications to them, the Team
  screen with invites, the terms/privacy line, then several businesses per owner.
- **Step 2b (done, migration 0060 + backend):** a team member can act on the shop's orders according to their role
  (accept/decline/hand over, notes, suggest a quantity; message request needs "chat"). The shop's new-order and order
  alerts are copied to members (so they get the push). Bank, wallet, billing, settings and shop deletion are untouched
  and stay owner-only. Tested in `tests/team-permissions.test.ts` and the existing order-action tests.
- **Still to do (front end, the larger part):** (1) a "Team" screen for the owner to add/remove members by their Levromart
  account; (2) "work as this shop" mode for a member - the app finds a shop by `vendors.user_id = me` in many screens
  (about 40 places in `src/legacy`), each must also accept a membership; (3) member chat replies (message insert policy +
  the chat screens); (4) several businesses per owner with a business switcher; (5) terms/privacy line saying team
  members can see a shop's orders and delivery details. Until (2) exists a team member cannot use the shop screens, so no
  invites are offered yet.
- **Step 3 (done):** owner "Team" screen (profile menu and shop hub: add by e-mail/phone, choose manager or staff, remove);
  members get "Work for <shop>" in their profile menu, which opens a team workspace with the shop's active orders
  (accept, decline, mark handed over); backend functions `list_shop_team`, `add_shop_team_member`,
  `remove_shop_team_member`, `get_my_shop_teams`, `get_team_shop_orders`; terms and privacy lines added.
- **Deliberately not done:** (a) team members replying in the shop's chats - chat sender/identity rules need their own
  design so customers never get confused about who they are talking to; (b) several businesses per owner - needs the
  one-shop-per-user rule (`vendors.user_id` unique, used in ~40 places) to be lifted and a business switcher; that is a
  separate, larger change best done after the team workspace has been used for a while.
- **Step 4 (done, migration 0061):** team members can answer the shop's chats from the team workspace ("Chats" tab).
  The customer sees the shop's name and logo on the message and its alert, never the staff member; team members also get the
  shop's "new message" alerts. Chat rules (closed chats, message requests) apply to them as to the owner.
- **Still not built:** several businesses per owner (needs `vendors.user_id` unique lifted and a business switcher in
  about 40 places). Recommended only after the team workspace has been used for a while.
