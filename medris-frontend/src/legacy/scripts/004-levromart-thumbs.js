(function(){
  "use strict";
  /* Every stored picture (product photos, profile pictures, shop logos, banners, carousel slides) is delivered by Cloudinary:
     resized for cards, search and cart, full size on the product page, and in the best format the phone supports (WebP/AVIF).
     Pictures uploaded before the move still live in Supabase Storage or R2; Cloudinary fetches each one once and keeps its copy,
     so the old storage is barely read any more. Pictures uploaded since the move are already on Cloudinary.
     Any picture Cloudinary cannot deliver falls back to the original; after 3 failures Cloudinary is skipped for the visit.
     Needs Cloudinary: Settings > Security > "Fetched URL" allowed. Switch off manually: localStorage.setItem("lv-no-thumbs","1") */
  var CLOUD="dx1gckzxg", BASE="https://res.cloudinary.com/"+CLOUD+"/image/", fails=0, off=false, made=new Map();
  try{ off=localStorage.getItem("lv-no-thumbs")==="1"; }catch(e){}
  /* a few fixed widths, so the same picture is not resized into dozens of slightly different copies */
  var WIDTHS=[120,160,240,320,480,640,800,1080];
  function bucket(px){ for(var i=0;i<WIDTHS.length;i++){ if(WIDTHS[i]>=px) return WIDTHS[i]; } return WIDTHS[WIDTHS.length-1]; }
  function stored(u){
    return /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//i.test(u) ||
      /^https:\/\/[a-z0-9-]+\.r2\.dev\//i.test(u) ||
      u.indexOf(BASE+"upload/")===0;
  }
  /* the original address of a picture this script rewrote (or the address itself) */
  window.lvOriginalImg=function(u){ return (typeof u==="string"&&made.get(u))||u; };
  /* w: the width it is shown at in CSS pixels; 0 or nothing = full size */
  window.lvThumb=function(u,w){
    try{
      if(off||typeof u!=="string"||!stored(u)||/\.(svg|gif)(\?|$)/i.test(u)||made.has(u)) return u;
      var t="f_auto,q_auto";
      if(w){ var d=Math.min(window.devicePixelRatio||1,2); t+=",c_limit,w_"+bucket(Math.max(80,Math.round(w*d))); }
      var out;
      if(u.indexOf(BASE+"upload/")===0){
        if(!w) return u; /* already delivered by Cloudinary at full size */
        out=BASE+"upload/"+t.replace("f_auto,q_auto,","")+"/"+u.slice((BASE+"upload/").length); /* its own address already asks for f_auto,q_auto */
      }else{
        out=BASE+"fetch/"+t+"/"+encodeURIComponent(u);
      }
      if(made.size>5000) made.clear();
      made.set(out,u);
      return out;
    }catch(e){ return u; }
  };
  window.addEventListener("error",function(ev){
    var t=ev.target; if(!t||t.tagName!=="IMG") return;
    var src=t.getAttribute("src")||"", orig=made.get(src); if(!orig) return;
    ev.stopImmediatePropagation();
    if(++fails>=3) off=true;
    t.src=orig;
  },true);
})();
