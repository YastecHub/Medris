/* ---- app-like motion: pages slide/fade in, and a re-render that changes nothing no longer wipes and redraws the screen ---- */
(function(){
  "use strict";
  var app=document.getElementById("app"); if(!app) return;
  var desc=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML"); if(!desc||!desc.set) return;
  var reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(_){}
  var TABS={home:1,vendors:1,search:1,notifications:1,vendorOrders:1,buyerOrders:1,buyerProfile:1,vendorDashboard:1,requestEquipment:1,vendorRequests:1,cart:1,wishlist:1,messages:1};
  var last={html:null,gen:-1,view:null}, goingBack=false, animTimer=null;
  window.addEventListener("popstate",function(){ goingBack=true; });
  function gen(){ try{ return navigationGeneration; }catch(_){ return -1; } }
  function view(){ try{ return currentView; }catch(_){ return ""; } }
  function animate(el,frames,ms){
    var root=document.documentElement; root.classList.add("lv-anim"); clearTimeout(animTimer); animTimer=setTimeout(function(){root.classList.remove("lv-anim");},ms+60);
    try{ el.animate(frames,{duration:ms,easing:"cubic-bezier(.22,.8,.24,1)"}); }catch(_){}
  }
  Object.defineProperty(app,"innerHTML",{configurable:true,
    get:function(){ return desc.get.call(this); },
    set:function(v){
      var g=gen(), vw=view(), html=String(v);
      var sameNav=(g===last.gen&&vw===last.view);
      // the cached page and the freshly loaded page are identical: leave the screen exactly as it is
      if(sameNav&&html===last.html) return;
      var prevView=last.view;
      desc.set.call(this,v);
      last={html:html,gen:g,view:vw};
      if(reduce||!this.animate) return;
      if(sameNav){ animate(this,[{opacity:.6},{opacity:1}],150); return; }
      var chat=document.body&&document.body.classList.contains("chat-full-page");
      var tabSwitch=!!(TABS[prevView]&&TABS[vw]);
      if(chat) animate(this,[{opacity:0},{opacity:1}],180);
      else if(tabSwitch&&!goingBack) animate(this,[{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}],210);
      else if(goingBack) animate(this,[{opacity:0,transform:"translateX(-24px)"},{opacity:1,transform:"none"}],220);
      else animate(this,[{opacity:0,transform:"translateX(30px)"},{opacity:1,transform:"none"}],230);
      goingBack=false;
    }
  });
})();
