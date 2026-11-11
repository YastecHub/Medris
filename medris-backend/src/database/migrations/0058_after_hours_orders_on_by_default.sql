-- Buyers may place orders outside a shop's working hours unless the shop switches this off itself.
-- Every shop is switched on now; a shop can turn it off in Edit profile.
alter table vendors alter column allow_after_hours_orders set default true;
update vendors set allow_after_hours_orders = true where allow_after_hours_orders = false;
