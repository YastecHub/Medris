-- Migration:  0059_shop_team_read_orders_and_chat
-- Why:        Step 2a of docs/MULTI_BUSINESS.md. A shop's manager/staff member may SEE the shop's orders and chats
--             (read only). Nothing can be changed by a team member yet, and money, bank details and settings stay owner-only.
-- Changes:    four extra SELECT policies. They only add access for people listed in public.vendor_members (empty today),
--             so no existing user sees anything new.
-- Applying:   after 0057. Safe to re-run. Rollback: drop the four policies.

drop policy if exists orders_select_team on public.orders;
create policy orders_select_team on public.orders for select
  using (public.can_act_for_vendor(vendor_id, 'orders'));

drop policy if exists order_items_select_team on public.order_items;
create policy order_items_select_team on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and public.can_act_for_vendor(o.vendor_id, 'orders')));

drop policy if exists conversations_select_team on public.conversations;
create policy conversations_select_team on public.conversations for select
  using (public.can_act_for_vendor(vendor_id, 'chat'));

drop policy if exists messages_select_team on public.messages;
create policy messages_select_team on public.messages for select
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id and public.can_act_for_vendor(c.vendor_id, 'chat')));
