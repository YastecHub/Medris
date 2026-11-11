-- WhatsApp order alerts are now ON by default for every shop. Shops that already gave a WhatsApp number are switched on
-- (they can still turn it off in Edit profile). Shops without a number are asked for one when they next open their dashboard.
alter table vendors alter column whatsapp_alerts set default true;
update vendors set whatsapp_alerts = true where coalesce(btrim(whatsapp_number), '') <> '' and whatsapp_alerts = false;
