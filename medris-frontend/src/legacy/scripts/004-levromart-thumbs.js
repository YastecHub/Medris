
(function(){
  "use strict";
  /* Small, cached copies of product photos for cards, search and cart (the full photo is still used on the product page).
     Any thumbnail that fails to load falls back to the original photo; after 3 failures thumbnails switch off for the visit.
     Switch off manually: localStorage.setItem("lv-no-thumbs","1") */
  var BASE="https://wsrv.nl/", fails=0, off=false;
  try{ off=localStorage.getItem("lv-no-thumbs")==="1"; }catch(e){}
  window.lvThumb=function(u,w){
    try{
      if(off||typeof u!=="string"||!/^https?:\/\//i.test(u)||u.indexOf("/product-photos/")<0||/\.(svg|gif)(\?|$)/i.test(u)) return u;
      var d=Math.min(window.devicePixelRatio||1,2), px=Math.max(80,Math.round((w||300)*d));
      return BASE+"?url="+encodeURIComponent(u.replace(/^https?:\/\//i,""))+"&w="+px+"&q=75&output=webp&we=1";
    }catch(e){ return u; }
  };
  window.addEventListener("error",function(ev){
    var t=ev.target; if(!t||t.tagName!=="IMG") return;
    var src=t.getAttribute("src")||""; if(src.indexOf(BASE+"?url=")!==0) return;
    try{
      var m=/[?&]url=([^&]+)/.exec(src); if(!m) return;
      ev.stopImmediatePropagation();
      if(++fails>=3) off=true;
      t.src="https://"+decodeURIComponent(m[1]);
    }catch(e){}
  },true);
})();
