-- Migration:  0075_cart_order_one_delivery_fee
-- Why:        A cart order from one shop charged every product's own delivery fee, so several products from the same shop paid
--             delivery several times. The backend (checkout.service.ts, merged in #468) now charges one fee per shop: the highest
--             of the items' fees. This makes the database's own create_cart_order() do the same, so both give the same total
--             (it is used when the backend is switched off) and the parity test passes again.
-- Changes:    public.create_cart_order(...): the delivery fee is greatest(...) of the items' fees instead of their sum. Nothing else.
-- Applying:   run once by the engineer on production after review. Safe to re-run (create or replace, same signature and grants).
--             Rollback: re-run the function from baseline/01-public-schema.sql (the sum).

CREATE OR REPLACE FUNCTION public.create_cart_order(p_vendor_id uuid, p_items jsonb, p_delivery_method public.delivery_method, p_delivery_address text, p_delivery_phone text DEFAULT NULL::text, p_buyer_lat double precision DEFAULT NULL::double precision, p_buyer_lng double precision DEFAULT NULL::double precision, p_buyer_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
 v_buyer_id uuid:=auth.uid(); v_vendor_active boolean; v_vendor_user_id uuid; v_order_id uuid; v_delivery_fee numeric:=0; v_items_total numeric:=0; v_item jsonb; v_product_id uuid; v_variant_id uuid; v_variant_product_id uuid; v_qty int; v_price numeric; v_discount numeric; v_unit_price numeric; v_available int; v_payment_timing text:=''; v_item_timing text; v_payment_deposit_percent numeric; v_item_deposit_percent numeric;
begin
 if v_buyer_id is null then raise exception 'must be signed in'; end if;
 if is_admin() then raise exception 'admin accounts cannot make purchases on Levromart'; end if;
 if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'Your cart is empty.'; end if;
 select is_active,user_id into v_vendor_active,v_vendor_user_id from vendors where id=p_vendor_id;
 if v_vendor_active is not true then raise exception 'this shop is currently paused and not accepting orders'; end if;
 if v_vendor_user_id=v_buyer_id then raise exception 'You can''t buy from your own shop.'; end if;
 insert into orders(buyer_id,vendor_id,order_type,status,total_amount,deposit_amount,delivery_method,delivery_address,delivery_phone,delivery_fee,buyer_note,payment_timing,payment_deposit_percent)
 values(v_buyer_id,p_vendor_id,'sale','pending',0,0,p_delivery_method,p_delivery_address,p_delivery_phone,0,nullif(trim(p_buyer_note),''),'pay_before',100) returning id into v_order_id;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_product_id:=nullif(v_item->>'product_id','')::uuid; v_variant_id:=nullif(v_item->>'variant_id','')::uuid; v_qty:=(v_item->>'quantity')::int;
   if v_product_id is null or v_qty is null or v_qty<=0 then raise exception 'invalid item in your cart'; end if;
   select sale_price,discount_price,quantity_available,payment_timing,payment_deposit_percent into v_price,v_discount,v_available,v_item_timing,v_item_deposit_percent from products where id=v_product_id and vendor_id=p_vendor_id and status='active' for update;
   if v_price is null then raise exception 'One of the items in your cart is no longer available.'; end if;
   -- Buyers may order more than the counter shows; the vendor can suggest the quantity they can actually supply.
   v_item_timing:=case when v_item_timing in ('pay_before','pay_after') then v_item_timing else 'pay_before' end;
   v_item_deposit_percent:=case when v_item_timing='pay_after' then greatest(1,least(99,coalesce(v_item_deposit_percent,20))) else null end;
   if p_delivery_method='delivery' then
     if v_payment_timing='' then v_payment_timing:=v_item_timing; elsif v_payment_timing<>v_item_timing then raise exception 'These cart items use different delivery payment plans. Please check out them separately.'; end if;
     if v_item_timing='pay_after' then
       if v_payment_deposit_percent is null then v_payment_deposit_percent:=v_item_deposit_percent; elsif abs(v_payment_deposit_percent-v_item_deposit_percent)>0.001 then raise exception 'These cart items use different delivery deposit percentages. Please check out them separately.'; end if;
     end if;
   end if;
   if v_variant_id is not null then
     select product_id into v_variant_product_id from product_variants where id=v_variant_id;
     if v_variant_product_id is distinct from v_product_id then raise exception 'invalid product variety'; end if;
     select sale_price,discount_price into v_price,v_discount from product_variants where id=v_variant_id;
     if v_price is null then raise exception 'Selected product variety is no longer available.'; end if;
   end if;
   v_unit_price:=case when v_discount is not null and v_discount>0 and v_discount<v_price then v_discount else v_price end;
   update products set quantity_available=greatest(quantity_available-v_qty,0) where id=v_product_id;
   insert into order_items(order_id,product_id,quantity,unit_price,variant_id) values(v_order_id,v_product_id,v_qty,v_unit_price,v_variant_id);
   v_items_total:=v_items_total+(v_unit_price*v_qty);
   if p_delivery_method='delivery' then v_delivery_fee:=greatest(v_delivery_fee,compute_product_delivery_fee(v_product_id,p_buyer_lat,p_buyer_lng)); end if;   -- one delivery per shop: the highest item fee, not the sum
 end loop;
 update orders set total_amount=v_items_total+v_delivery_fee,delivery_fee=v_delivery_fee,
   payment_timing=case when p_delivery_method='delivery' and v_payment_timing<>'' then v_payment_timing else 'pay_before' end,
   payment_deposit_percent=case when p_delivery_method='delivery' and v_payment_timing='pay_after' then v_payment_deposit_percent else 100 end,
   deposit_amount=case when p_delivery_method='delivery' and v_payment_timing='pay_after' then round((v_items_total+v_delivery_fee)*v_payment_deposit_percent/100,2) else v_items_total+v_delivery_fee end
 where id=v_order_id;
 return v_order_id;
end;$$;

