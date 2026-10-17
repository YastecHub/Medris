
(function(){ var paused=0;
  document.addEventListener("pointerdown",function(e){ if(e.target.closest&&e.target.closest(".product-gallery-varieties-list")) paused=Date.now(); },true);
  document.addEventListener("touchstart",function(e){ if(e.target.closest&&e.target.closest(".product-gallery-varieties-list")) paused=Date.now(); },{capture:true,passive:true});
  document.addEventListener("wheel",function(e){ if(e.target.closest&&e.target.closest(".product-gallery-varieties-list")) paused=Date.now(); },{capture:true,passive:true});
  setInterval(function(){
    if(document.hidden||Date.now()-paused<7000) return;
    var l=document.querySelector("#productGalleryVarieties .product-gallery-varieties-list"); if(!l) return;
    if(l.scrollWidth<=l.clientWidth+6) return;
    var r=l.getBoundingClientRect(); if(r.bottom<0||r.top>innerHeight) return;
    var first=l.firstElementChild, step=first?first.getBoundingClientRect().width+8:140;
    if(l.scrollLeft+l.clientWidth>=l.scrollWidth-4) l.scrollTo({left:0,behavior:"smooth"}); else l.scrollBy({left:step,behavior:"smooth"});
  },3200);
})();
window.__lvSetChatIcon=function(has){ var w=document.getElementById("messagesWrap"); if(w) w.classList.toggle("lv-chat-off",!has); };
window.LV_FILTER_SVG = '<svg class="lv-filter-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16"/><path d="M8 16h8"/></svg>';
window.LV_SETTINGS_SVG='<svg class="lv-svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>';
window.lvLinkRow=function(icon,label,value,onclick){
  var ic=icon.charAt(0)==="<"?icon:'<i class="fa-solid '+icon+'" aria-hidden="true"></i>';
  var inner='<span class="lv-row-ico">'+ic+'</span><span class="lv-row-label">'+label+'</span>'+(value!==""&&value!=null?'<span class="lv-row-val">'+value+'</span>':'');
  return onclick?'<button type="button" class="lv-row" onclick="'+onclick+'">'+inner+'<i class="fa-solid fa-chevron-right lv-row-chev" aria-hidden="true"></i></button>':'<div class="lv-row lv-row-static">'+inner+'</div>';
};
