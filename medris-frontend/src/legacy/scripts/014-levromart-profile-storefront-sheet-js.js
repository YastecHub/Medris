
(function(){
  "use strict";
  function sheetRoot(){return document.getElementById("storefrontMoreSheetRoot");}
  window.openStorefrontMoreSheet=function(ev){
    ev?.preventDefault?.(); ev?.stopPropagation?.();
    const root=sheetRoot(), sheet=document.getElementById("storefrontMoreSheet");
    if(!root||!sheet)return;
    document.querySelectorAll(".ms-list").forEach(el=>el.classList.add("hidden"));
    root.classList.add("is-open");
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden","false");
    document.body.classList.add("levro-sheet-open");
    const focusable=sheet.querySelector("button:not(.levro-sheet-close),a");
    setTimeout(()=>focusable?.focus?.(),80);
    wireMoreSheetGesture(sheet);
  };
  window.closeStorefrontMoreSheet=function(){
    const root=sheetRoot(), sheet=document.getElementById("storefrontMoreSheet");
    if(!root||!sheet)return;
    root.classList.remove("is-open");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden","true");
    document.body.classList.remove("levro-sheet-open");
  };
  function wireMoreSheetGesture(sheet){
    if(sheet.dataset.gestureWired==="1")return;
    sheet.dataset.gestureWired="1";
    let startY=0,lastY=0,dragging=false;
    sheet.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;startY=e.touches[0].clientY;lastY=startY;dragging=true;sheet.style.transition="none";},{passive:true});
    sheet.addEventListener("touchmove",e=>{if(!dragging)return;lastY=e.touches[0].clientY;const dy=Math.max(0,lastY-startY);if(dy>0)sheet.style.transform=`translateY(${dy}px)`;},{passive:true});
    sheet.addEventListener("touchend",()=>{if(!dragging)return;dragging=false;const dy=Math.max(0,lastY-startY);sheet.style.transition="";sheet.style.transform="";if(dy>70)window.closeStorefrontMoreSheet();},{passive:true});
  }
  function followSheetSetBodyLock(on){
    const body=document.body;
    if(!body)return;
    if(on){
      body.classList.add("follow-notification-sheet-open");
      body.classList.add("levro-sheet-open");
    }else if(!document.querySelector(".levro-storefront-sheet.is-open")){
      body.classList.remove("follow-notification-sheet-open");
      body.classList.remove("levro-sheet-open");
    }else{
      body.classList.remove("follow-notification-sheet-open");
    }
  }
  window.closeStorefrontFollowSheet=function(wrap){
    const menu=(wrap?.querySelector?.(".follow-menu")) || document.querySelector(".follow-menu[data-follow-sheet-vendor-id]");
    const bell=wrap?.querySelector?.(".follow-settings-btn") || document.querySelector(".follow-settings-btn[aria-expanded='true']");
    if(!menu && !bell)return;
    if(bell)bell.setAttribute("aria-expanded","false");
    if(menu){
      if(menu.__followSheetCloseTimer)clearTimeout(menu.__followSheetCloseTimer);
      menu.classList.remove("is-sheet-open");
      menu.setAttribute("aria-hidden","true");
      menu.style.transform="";
      menu.__followSheetCloseTimer=setTimeout(()=>{
        menu.classList.add("hidden");
        const owner=menu.__followSheetOwner||wrap;
        if(owner && owner.isConnected) owner.appendChild(menu);
        menu.removeAttribute("data-follow-sheet-vendor-id");
        menu.__followSheetOwner=null;
        menu.__followSheetCloseTimer=null;
      },290);
    }
    document.querySelectorAll(".follow-sheet-backdrop").forEach(b=>b.remove());
    followSheetSetBodyLock(false);
  };
  window.wireStorefrontFollowSheetGesture=function(menu,wrap){
    if(!menu||menu.dataset.gestureWired==="1")return;
    menu.dataset.gestureWired="1";
    let startY=0,lastY=0,dragging=false;
    menu.addEventListener("touchstart",e=>{
      if(e.touches.length!==1)return;
      startY=e.touches[0].clientY;
      lastY=startY;
      dragging=true;
      menu.style.transition="none";
    },{passive:true});
    menu.addEventListener("touchmove",e=>{
      if(!dragging)return;
      lastY=e.touches[0].clientY;
      const dy=Math.max(0,lastY-startY);
      if(dy>0)menu.style.transform=`translateY(${dy}px)`;
    },{passive:true});
    menu.addEventListener("touchend",()=>{
      if(!dragging)return;
      dragging=false;
      const dy=Math.max(0,lastY-startY);
      menu.style.transition="";
      menu.style.transform="";
      if(dy>70)window.closeStorefrontFollowSheet(wrap);
    },{passive:true});
  };
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    window.closeStorefrontMoreSheet?.();
    document.querySelectorAll(".storefront-follow-wrap").forEach(w=>window.closeStorefrontFollowSheet?.(w));
  });
})();
