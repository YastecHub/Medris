-- 1) "Let buyers place orders outside working hours": off by default (only matters when a shop has set working hours).
alter table vendors add column if not exists allow_after_hours_orders boolean not null default false;
-- 2) Shops' WhatsApp numbers are no longer shown to buyers: it is only used to send the shop its alerts.
update vendors set whatsapp_visible = false where whatsapp_visible;
alter table vendors alter column whatsapp_visible set default false;
-- 3) Customers give a WhatsApp number too, so reminders and order updates can reach them.
alter table users add column if not exists whatsapp_number text;
