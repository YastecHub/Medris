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
