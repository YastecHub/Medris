
(function(){
  "use strict";
  /* Friendly backend errors. Raw infrastructure messages (quota / egress limits, paused project, gateway or
     server trouble) are never shown to people. They see one calm line with an icon; the real details go to the
     console and to window.__levroErrorLog so you can still debug. */
  var OUTAGE_TEXT="We're experiencing high traffic right now. Please try again in a few moments.";
  var OUTAGE_ICON="fa-hourglass-half";
  var log=window.__levroErrorLog=window.__levroErrorLog||[];
  var lastNote="";
  function note(kind,detail){
    try{
      var d=String(detail==null?"":detail).slice(0,600), key=kind+"|"+d;
      if(key===lastNote) return; lastNote=key;
      log.push({t:Date.now(),kind:kind,detail:d}); if(log.length>50) log.shift();
      console.error("[Levromart backend]",kind,d);
    }catch(e){}
  }
  var INFRA=/restricted due to|exceed_[a-z_]*quota|egress|over[_ ]?quota|quota (exceeded|reached)|project (is )?paused|service (is )?unavailable|bad gateway|gateway time-?out|upstream (connect|request|error)|server (is )?overloaded|statement timeout|connection (refused|terminated)|too many connections|internal server error|database (is )?(unavailable|error)|fair use policy|spend cap/i;
  window.__levroClassifyBackendError=function(raw){
    raw=String(raw==null?"":raw);
    if(raw===OUTAGE_TEXT) return {kind:"outage",icon:OUTAGE_ICON,text:OUTAGE_TEXT};
    if(raw && INFRA.test(raw)){ note("outage",raw); return {kind:"outage",icon:OUTAGE_ICON,text:OUTAGE_TEXT}; }
    return null;
  };
  /* Used as supabase-js's fetch: when the backend answers with a quota / paused / gateway failure, hand the
     app a clean message instead of the raw one, so every error.message in the app is already friendly. */
  var rawSafe=async function(input,init){
    var res=await fetch(input,init);
    try{
      if(res.ok) return res;
      var url=typeof input==="string"?input:(input&&input.url)||"";
      if(!/\.supabase\.(co|in)\//.test(url)||/\/functions\/v1\//.test(url)) return res;
      var st=res.status, body="";
      try{ body=await res.clone().text(); }catch(e){}
      if(!(INFRA.test(body)||st===402||st===502||st===503||st===504||(st>=520&&st<=546))) return res;
      note("http "+st+" "+url.split("?")[0],body);
      var payload=JSON.stringify({message:OUTAGE_TEXT,msg:OUTAGE_TEXT,error:OUTAGE_TEXT,error_description:OUTAGE_TEXT,code:"service_busy",hint:null,details:null});
      return new Response(payload,{status:st,statusText:res.statusText,headers:{"Content-Type":"application/json"}});
    }catch(e){ return res; }
  };
  /* Read cache + request merging. Identical reads of slow-changing tables are answered from memory for a short time
     (and shared when several parts of the app ask at once), so the same rows are not downloaded again and again.
     Any write clears it; if the backend is down/over quota the last good copy is served instead of an error. */
  var CACHE=new Map(), FLIGHT=new Map(), STALE_MS=3600000, MAX_ENTRIES=160, MAX_BYTES=600000;
  var TTL={sectors:600000,categories:600000,points_rules:600000,homepage_carousel_slides:300000,
    products:25000,vendor_packages:25000,vendors:25000,package_items:25000,product_variants:25000,
    product_rating_stats:40000,product_engagement_settings:60000,package_engagement_settings:60000};
  var stats=window.__levroCacheStats={hit:0,miss:0,merged:0,stale:0};
  function hkey(h){
    try{ var o=[]; (h instanceof Headers?h:new Headers(h||{})).forEach(function(v,k){ if(k==="x-client-info"||k==="x-supabase-api-version") return; o.push(k+":"+v); }); return o.sort().join("|"); }catch(e){ return ""; }
  }
  function tableTtl(input,init){
    if(typeof input!=="string"||!init||init.signal||(init.method&&String(init.method).toUpperCase()!=="GET")) return 0;
    var m=/^https:\/\/[^/]+\.supabase\.(?:co|in)\/rest\/v1\/([a-z_]+)(?:\?|$)/.exec(input);
    return m&&TTL[m[1]]||0;
  }
  function rebuild(e){ return new Response(e.body,{status:e.status,headers:e.headers}); }
  window.__levroClearReadCache=function(){ CACHE.clear(); };
  window.__levroSafeFetch=function(input,init){
    try{
      var url=typeof input==="string"?input:(input&&input.url)||"";
      var method=String((init&&init.method)||(input&&input.method)||"GET").toUpperCase();
      if(method!=="GET"&&method!=="HEAD"&&/(\.supabase\.(co|in)\/(rest|functions)\/v1\/|\/rest\/v1\/|\/api\/v1\/)/.test(url)) CACHE.clear();
      var ttl=tableTtl(input,init);
      if(!ttl) return rawSafe(input,init);
      var key=url+"#"+hkey(init.headers), now=Date.now(), hit=CACHE.get(key);
      if(hit&&now-hit.t<ttl){ stats.hit++; return Promise.resolve(rebuild(hit)); }
      if(FLIGHT.has(key)){ stats.merged++; return FLIGHT.get(key).then(rebuild); }
      stats.miss++;
      var p=rawSafe(input,init).then(async function(res){
        if(res.ok){
          var body=await res.clone().text();
          if(body.length<=MAX_BYTES){
            var ct=res.headers.get("content-type"), cr=res.headers.get("content-range"), hd={};
            if(ct) hd["content-type"]=ct; if(cr) hd["content-range"]=cr;
            CACHE.set(key,{t:Date.now(),body:body,status:res.status,headers:hd});
            if(CACHE.size>MAX_ENTRIES){ var k0=CACHE.keys().next().value; CACHE.delete(k0); }
          }
          return CACHE.get(key)||{body:body,status:res.status,headers:{"content-type":ct||"application/json"}};
        }
        if(hit&&now-hit.t<STALE_MS){ stats.stale++; return hit; }
        var b2=await res.text();
        return {body:b2,status:res.status,headers:{"content-type":res.headers.get("content-type")||"application/json"}};
      },function(err){
        if(hit&&now-hit.t<STALE_MS){ stats.stale++; return hit; }
        throw err;
      });
      FLIGHT.set(key,p);
      var done=function(){ FLIGHT.delete(key); }; p.then(done,done);
      return p.then(rebuild);
    }catch(e){ return rawSafe(input,init); }
  };
  /* Safety net for any message that reaches the screen another way (inline error boxes, empty states). */
  function sweep(el){
    if(!el||el.nodeType!==1||el.getAttribute("data-lv-friendly")) return;
    var isErr=el.classList.contains("error-text"), isEmpty=el.classList.contains("empty-state");
    if(!isErr&&!isEmpty) return;
    if(el.children.length>1||(el.children.length===1&&el.children[0].tagName!=="I")) return;
    var txt=(el.textContent||"").trim(); if(!txt||txt.length>700) return;
    var c=window.__levroClassifyBackendError(txt); if(!c) return;
    el.setAttribute("data-lv-friendly","1");
    var ic=document.createElement("i"); ic.className="fa-solid "+c.icon;
    if(isEmpty){ ic.style.cssText="font-size:1.6rem;display:block;margin-bottom:.6rem"; } else { ic.style.marginRight=".4rem"; }
    var span=document.createElement("span"); span.textContent=c.text;
    el.replaceChildren(ic,span);
  }
  function start(){
    var busy=false;
    new MutationObserver(function(muts){
      if(busy) return; busy=true;
      try{
        muts.forEach(function(m){
          var t=m.target&&(m.target.nodeType===1?m.target:m.target.parentElement);
          if(t&&t.closest){ var h=t.closest(".error-text,.empty-state"); if(h){ h.removeAttribute("data-lv-friendly"); sweep(h); } }
          m.addedNodes&&m.addedNodes.forEach(function(n){
            if(n.nodeType!==1) return; sweep(n);
            if(n.querySelectorAll) n.querySelectorAll(".error-text,.empty-state").forEach(sweep);
          });
        });
      }finally{ busy=false; }
    }).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start); else start();
})();
