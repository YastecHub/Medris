-- A shop can hide when it is online / when it was last seen (like WhatsApp). On by default for every shop.
-- The server (get_shop_presence and the chat "last seen") returns nothing when a shop has switched it off.
alter table vendors add column if not exists show_online_status boolean not null default true;
