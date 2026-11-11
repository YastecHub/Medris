-- WhatsApp order alerts (groundwork). A shop can opt in to get a WhatsApp message when a new order arrives.
-- Off for everyone by default. Nothing is sent until the engineer also sets the WhatsApp variables on Vercel.
alter table vendors add column if not exists whatsapp_alerts boolean not null default false;
