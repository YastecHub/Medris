-- Applied via MCP (migration keep_role_prompt_for_new_oauth_accounts):
-- sync_current_account_role() no longer sets role_selected=true, so brand-new Google accounts
-- (role_selected=false from the signup trigger) get the "buyer or vendor?" prompt.
create or replace function public.sync_current_account_role()
returns user_role language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid:=auth.uid(); v_role user_role; begin
 if v_uid is null then raise exception 'Authentication required.'; end if;
 select public.resolve_account_role(v_uid) into v_role; if v_role is null then raise exception 'Account profile not found.'; end if;
 update public.users set role=v_role where id=v_uid and role<>'admin' and role is distinct from v_role; return v_role;
end; $function$;
