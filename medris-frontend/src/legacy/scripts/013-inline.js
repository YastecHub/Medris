
(function(){
  const applySendStyle=()=>document.querySelectorAll('.product-comment-compose-row>.icon-btn,.package-comment-compose-row>.icon-btn').forEach(b=>{b.classList.add('product-comment-send-btn');b.setAttribute('aria-label','Send comment');});
  const obs=new MutationObserver(()=>applySendStyle());obs.observe(document.body,{childList:true,subtree:true});applySendStyle();

  async function optimisticLike(kind,id){
    if(!session){showLogin();return}
    const root=document.querySelector(`[data-comment-id="${CSS.escape(String(id))}"]`);
    const btn=root?.querySelector('.product-comment-action');if(!btn)return;
    if(btn.dataset.likeBusy==="1")return;
    const icon=btn.querySelector('i'),rowN=root.querySelector('.lv-cr-n'),count=rowN||btn.querySelector('.comment-like-count'),wasLiked=btn.classList.contains('active');
    const oldCount=Math.max(0,Number(count?.textContent||0)),nextLiked=!wasLiked,nextCount=Math.max(0,oldCount+(nextLiked?1:-1));
    btn.classList.toggle('active',nextLiked);if(icon)icon.className=`fa-${nextLiked?'solid':'regular'} fa-heart`;
    if(nextLiked){btn.style.color='#ef4444';if(icon)icon.style.color='#ef4444'}else{btn.style.removeProperty('color');icon?.style.removeProperty('color')}
    if(rowN)rowN.textContent=nextCount>0?String(nextCount):'';else if(count)count.textContent=String(nextCount);else if(nextCount>0){const n=document.createElement('span');n.className='comment-like-count';n.textContent=String(nextCount);btn.appendChild(n)}
    btn.dataset.likeBusy='1';
    try{
      const table=kind==='package'?'package_comment_likes':'product_comment_likes';
      const existing=await sb.from(table).select('id').eq('comment_id',id).eq('user_id',session.user.id).maybeSingle();
      const r=existing.data?.id?await sb.from(table).delete().eq('id',existing.data.id).eq('user_id',session.user.id):await sb.from(table).insert({comment_id:id,user_id:session.user.id});
      if(r.error&&!/duplicate/i.test(r.error.message||''))throw r.error;
      /* the like is saved; refresh the list quietly (never turns a saved like into an error) */
      try{
        if(rowN)throw 0; /* the number on screen is already right: redrawing the list would make it flicker */
        if(kind==='package'&&currentViewParams?.packageId)window.loadPackageComments?.(currentViewParams.packageId,{showLoading:false});
        if(kind==='product'&&currentProductDetail?.id)window.loadProductComments?.(currentProductDetail.id,{showLoading:false});
      }catch(_){}
    }catch(e){
      btn.classList.toggle('active',wasLiked);if(icon)icon.className=`fa-${wasLiked?'solid':'regular'} fa-heart`;
      if(wasLiked){btn.style.color='#ef4444';if(icon)icon.style.color='#ef4444'}else{btn.style.removeProperty('color');icon?.style.removeProperty('color')}
      if(rowN)rowN.textContent=oldCount>0?String(oldCount):'';else if(count)count.textContent=String(oldCount);else btn.querySelector('.comment-like-count')?.remove();
      showToast(e.message||'Could not update comment like.','error');
    }finally{delete btn.dataset.likeBusy}
  }
  window.toggleProductCommentLike=id=>optimisticLike('product',id);
  window.togglePackageCommentLike=id=>optimisticLike('package',id);

  window.copyAdminPhone=async function(phone){
    const value=String(phone||'').trim();if(!value)return;
    try{await navigator.clipboard.writeText(value);showToast('Phone number copied.','success')}
    catch(_){const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');showToast('Phone number copied.','success')}catch(__){showToast('Copy is unavailable on this device.','info')}ta.remove()}
  };
  const oldRows=window.renderAdminPeopleRows;
  if(typeof oldRows==='function'&&!window.__adminPeoplePhoneCopyWrapped){
    window.__adminPeoplePhoneCopyWrapped=true;
    window.renderAdminPeopleRows=function(){
      oldRows.apply(this,arguments);
      document.querySelectorAll('#adminPeopleTable tbody tr').forEach(tr=>{
        const phone=tr.querySelector('.admin-phone-btn');if(!phone||tr.querySelector('.admin-phone-copy-btn'))return;
        const raw=phone.textContent.replace(/[^\d+]/g,'');
        const b=document.createElement('button');b.type='button';b.className='admin-phone-copy-btn';b.title='Copy phone number';b.setAttribute('aria-label','Copy phone number');b.innerHTML='<i class="fa-regular fa-copy"></i>';b.onclick=e=>{e.stopPropagation();copyAdminPhone(raw)};phone.insertAdjacentElement('afterend',b);
      });
    };
  }

  const oldChoose=window.chooseAccountRole;
  if(typeof oldChoose==='function'&&!window.__vendorRoleRouteWrapped){
    window.__vendorRoleRouteWrapped=true;
    window.chooseAccountRole=async function(role){
      if(role==='vendor')try{sessionStorage.setItem('levromart-force-vendor-application','1')}catch(_){}
      const result=await oldChoose.apply(this,arguments);
      if(role==='vendor')setTimeout(()=>{if(session&&profile?.role!=='admin'&&!vendor)navigate('vendorApply',{},false)},80);
      return result;
    };
  }

  /* If a Google/new-vendor account returns through an auth callback, force the
     application route after the shared auth bootstrap has settled. */
  setTimeout(()=>{
    try{
      if(session&&profile?.role!=='admin'&&!vendor&&sessionStorage.getItem('levromart-force-vendor-application')==='1'){
        sessionStorage.removeItem('levromart-force-vendor-application');navigate('vendorApply',{},false);
      }
    }catch(_){}
  },1200);

  /* Hard-reload route guard: if the URL/storage remembers a non-home page,
     don't leave a freshly booted Home screen in place. */
  window.addEventListener('pageshow',()=>{
    try{
      const last=window.__levromartReadPersistedRoute?.();
      if(last?.view&&last.view!=='home'&&session&&currentView==='home')setTimeout(()=>{if(currentView==='home')navigate(last.view,last.params||{},false)},120);
    }catch(_){}
  });
})();
