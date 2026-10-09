-- Comment notifications: owner comment alerts (products already had these), package comments,
-- replies, and @mentions of vendors. A mention is the text "@<business name>" inside a comment.
create or replace function public.notify_comment_mentions(
  p_kind text, p_item_id uuid, p_comment_id uuid, p_author uuid, p_author_name text, p_author_avatar text,
  p_content text, p_item_name text, p_skip uuid[]
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v record;
begin
  if p_content is null or position('@' in p_content) = 0 then return; end if;
  for v in
    select id, user_id, business_name from public.vendors
    where user_id is not null and verification_status = 'verified' and coalesce(is_active, true)
      and length(business_name) >= 2
      and strpos(lower(p_content), lower('@' || business_name)) > 0
  loop
    if v.user_id = p_author or v.user_id = any(coalesce(p_skip, '{}'::uuid[])) then continue; end if;
    insert into public.notifications(user_id,type,title,body,target_view,target_params,actor_id,actor_name,actor_avatar_url,vendor_id,notification_category,group_key,metadata)
    values (v.user_id,'comment_mention', p_author_name || ' mentioned you in a comment on "' || coalesce(p_item_name,'a listing') || '"', left(p_content,180),
      case when p_kind='package' then 'packageDetail' else 'productDetail' end,
      case when p_kind='package' then jsonb_build_object('packageId',p_item_id,'openComments',true) else jsonb_build_object('productId',p_item_id,'openComments',true) end,
      p_author, p_author_name, p_author_avatar, v.id, 'comment_mention', 'comment-mention:' || p_comment_id::text || ':' || v.id::text,
      jsonb_build_object('comment_id',p_comment_id,'kind',p_kind));
  end loop;
end $$;

create or replace function public.notify_product_comment_event() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare vendor_user uuid; vendor_id_value uuid; product_name text; parent_author uuid; skip uuid[] := '{}';
begin
  select v.user_id,v.id,p.name into vendor_user,vendor_id_value,product_name from public.products p join public.vendors v on v.id=p.vendor_id where p.id=new.product_id;
  if vendor_user is not null and vendor_user<>new.user_id then
    insert into public.notifications(user_id,type,title,body,target_view,target_params,actor_id,actor_name,actor_avatar_url,vendor_id,notification_category,group_key,metadata)
    values(vendor_user,'product_comment',new.author_name||' commented on your product "'||coalesce(product_name,'your product')||'"',left(new.content,180),'productDetail',jsonb_build_object('productId',new.product_id,'openComments',true),new.user_id,new.author_name,new.author_avatar_url,vendor_id_value,'product_comment','product-comment:'||new.id::text,jsonb_build_object('product_id',new.product_id,'comment_id',new.id));
    skip := skip || vendor_user;
  end if;
  if new.parent_comment_id is not null then
    select pc.user_id into parent_author from public.product_comments pc where pc.id=new.parent_comment_id;
    if parent_author is not null and parent_author<>new.user_id then
      insert into public.notifications(user_id,type,title,body,target_view,target_params,actor_id,actor_name,actor_avatar_url,notification_category,group_key,metadata)
      values(parent_author,'comment_reply',new.author_name||' replied to your comment',left(new.content,180),'productDetail',jsonb_build_object('productId',new.product_id,'openComments',true,'commentId',new.parent_comment_id),new.user_id,new.author_name,new.author_avatar_url,'comment_reply','comment-reply:'||new.id::text,jsonb_build_object('product_id',new.product_id,'comment_id',new.id,'parent_comment_id',new.parent_comment_id));
      skip := skip || parent_author;
    end if;
  end if;
  perform public.notify_comment_mentions('product',new.product_id,new.id,new.user_id,new.author_name,new.author_avatar_url,new.content,product_name,skip);
  return new;
end $$;

create or replace function public.notify_package_comment_event() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare vendor_user uuid; vendor_id_value uuid; pkg_name text; parent_author uuid; skip uuid[] := '{}';
begin
  select v.user_id,v.id,p.name into vendor_user,vendor_id_value,pkg_name from public.vendor_packages p join public.vendors v on v.id=p.vendor_id where p.id=new.package_id;
  if vendor_user is not null and vendor_user<>new.user_id then
    insert into public.notifications(user_id,type,title,body,target_view,target_params,actor_id,actor_name,actor_avatar_url,vendor_id,notification_category,group_key,metadata)
    values(vendor_user,'product_comment',new.author_name||' commented on your package "'||coalesce(pkg_name,'your package')||'"',left(new.content,180),'packageDetail',jsonb_build_object('packageId',new.package_id,'openComments',true),new.user_id,new.author_name,new.author_avatar_url,vendor_id_value,'product_comment','package-comment:'||new.id::text,jsonb_build_object('package_id',new.package_id,'comment_id',new.id));
    skip := skip || vendor_user;
  end if;
  if new.parent_comment_id is not null then
    select pc.user_id into parent_author from public.package_comments pc where pc.id=new.parent_comment_id;
    if parent_author is not null and parent_author<>new.user_id then
      insert into public.notifications(user_id,type,title,body,target_view,target_params,actor_id,actor_name,actor_avatar_url,notification_category,group_key,metadata)
      values(parent_author,'comment_reply',new.author_name||' replied to your comment',left(new.content,180),'packageDetail',jsonb_build_object('packageId',new.package_id,'openComments',true,'commentId',new.parent_comment_id),new.user_id,new.author_name,new.author_avatar_url,'comment_reply','comment-reply:'||new.id::text,jsonb_build_object('package_id',new.package_id,'comment_id',new.id,'parent_comment_id',new.parent_comment_id));
      skip := skip || parent_author;
    end if;
  end if;
  perform public.notify_comment_mentions('package',new.package_id,new.id,new.user_id,new.author_name,new.author_avatar_url,new.content,pkg_name,skip);
  return new;
end $$;

drop trigger if exists package_comments_notify_event on public.package_comments;
create trigger package_comments_notify_event after insert on public.package_comments for each row execute function public.notify_package_comment_event();
