/* LevroMart form autosave: vendor application + student verification.
   Text fields -> localStorage; ID/biodata/selfie files -> IndexedDB. Cleared on successful submit. */
(function(){
  "use strict";
  var KEY="lv-draft-v1", SKIP_IDS=/^(vaDoc)$/;
  var FIELDS=["vaSector","vaOtherSector","vaBusinessName","vaAddress","vaCity","vaPhone","vaWhatsapp","vaBankCode","vaAccountNumber","vaAccountName","vaCac","vaBio","vaHoursPreset","svMatric","svFaculty","svDept","svLevel","svNoMatric"];
  var LABELS=["vaBankPickerLabel"];
  function uid(){ try{ return (typeof session!=="undefined"&&session&&session.user&&session.user.id)||"anon"; }catch(_){ return "anon"; } }
  function all(){ try{ return JSON.parse(localStorage.getItem(KEY)||"{}")||{}; }catch(_){ return {}; } }
  function mine(){ return all()[uid()]||{}; }
  function put(o){ try{ var a=all(); a[uid()]=o; localStorage.setItem(KEY,JSON.stringify(a)); }catch(_){} }
  function set(id,val){ var o=mine(); o[id]=val; put(o); }
  function isField(el){ return el&&el.id&&FIELDS.indexOf(el.id)>=0&&el.type!=="password"&&el.type!=="file"; }
  function save(el){ if(!isField(el)) return; set(el.id, el.type==="checkbox"?!!el.checked:el.value); if(el.id==="vaBankCode"){ var l=document.getElementById("vaBankPickerLabel"); if(l) set("vaBankPickerLabel",l.textContent); } }
  ["input","change"].forEach(function(ev){ document.addEventListener(ev,function(e){ save(e.target); },true); });
  // bank/sector pickers change values from script; catch those on a slow tick too
  setInterval(function(){ FIELDS.forEach(function(id){ var el=document.getElementById(id); if(el&&el.dataset.lvdr==="1") save(el); }); },1500);

  var done=new WeakSet();
  function restore(){
    var d=mine(); if(!Object.keys(d).length) return;
    FIELDS.forEach(function(id){
      var el=document.getElementById(id); if(!el||done.has(el)||!(id in d)) return;
      var v=d[id], changed=false;
      if(el.type==="checkbox"){ if(el.checked!==!!v){ el.checked=!!v; changed=true; } }
      else if(el.tagName==="SELECT"){
        if(v&&!Array.from(el.options).some(function(o){return String(o.value)===String(v)||o.text===v;})) return; // options still loading, retry next pass
        if(el.value!==v){ el.value=v; changed=true; }
      } else if(el.value===""||el.value===el.defaultValue){ if(v!==""&&el.value!==v){ el.value=v; changed=true; } }
      done.add(el); el.dataset.lvdr="1";
      if(changed){ try{ el.dispatchEvent(new Event("change",{bubbles:true})); el.dispatchEvent(new Event("input",{bubbles:true})); }catch(_){} }
    });
    LABELS.forEach(function(id){ var el=document.getElementById(id); if(el&&d[id]&&d.vaBankCode&&document.getElementById("vaBankCode")&&document.getElementById("vaBankCode").value===d.vaBankCode) el.textContent=d[id]; });
  }
  var t=null; function soon(){ clearTimeout(t); t=setTimeout(restore,60); }
  new MutationObserver(soon).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(restore,1200); // covers select options that arrive late

  window.lvDraftClear=function(){ var a=all(); delete a[uid()]; try{ localStorage.setItem(KEY,JSON.stringify(a)); }catch(_){} try{ window.lvDraftFiles.clear("sv"); }catch(_){} };

  // forget the draft once the vendor application really went through
  function wrap(){
    var orig=window.submitVendorApply; if(typeof orig!=="function"||orig.__lvd) return;
    var w=async function(){
      var r=await orig.apply(this,arguments);
      setTimeout(function(){ var e=document.getElementById("vendorApplyError"); if(!e||e.classList.contains("hidden")||!e.textContent.trim()) window.lvDraftClear(); },800);
      return r;
    };
    w.__lvd=1; window.submitVendorApply=w;
  }
  wrap(); setInterval(wrap,2000);

  // ---- files (IndexedDB)
  function db(){ return new Promise(function(res,rej){ try{ var q=indexedDB.open("lv-drafts",1); q.onupgradeneeded=function(){ q.result.createObjectStore("f"); }; q.onsuccess=function(){res(q.result);}; q.onerror=function(){rej(q.error);}; }catch(e){ rej(e); } }); }
  function tx(mode,fn){ return db().then(function(d){ return new Promise(function(res,rej){ var r=fn(d.transaction("f",mode).objectStore("f")); r.onsuccess=function(){res(r.result);}; r.onerror=function(){rej(r.error);}; }); }); }
  window.lvDraftFiles={
    save:function(k,o){ return tx("readwrite",function(s){ return s.put(o,k+":"+uid()); }).catch(function(){}); },
    load:function(k){ return tx("readonly",function(s){ return s.get(k+":"+uid()); }).catch(function(){ return null; }); },
    clear:function(k){ return tx("readwrite",function(s){ return s.delete(k+":"+uid()); }).catch(function(){}); }
  };
})();
