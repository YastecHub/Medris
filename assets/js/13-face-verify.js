/* ---- face-verify: live selfie check (blink = liveness) + face match against the uploaded ID, plus a background OCR read of the ID ----
   Everything runs on the person's phone. The face library and its models (~8 MB) are fetched only when someone opens the
   face step, then cached by the browser. Nothing here approves anyone: admins still make the decision; they just get a
   selfie, a match score and an OCR read to look at. */
(function(){
  "use strict";
  var FA_BASE="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/";
  var OCR_SRC="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var libP=null,ocrP=null;
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function loadScript(src){
    return new Promise(function(res,rej){
      var s=document.createElement("script"); s.src=src; s.async=true; s.onload=function(){res();}; s.onerror=function(){rej(new Error("Couldn't load the face check. Check your connection."));};
      document.head.appendChild(s);
    });
  }
  // The ~8 MB of library + models is downloaded in parallel with real progress, then handed to face-api from the cache.
  var progCb=null,progVal=0;
  function setProg(v){ progVal=Math.max(progVal,Math.min(1,v)); if(progCb) progCb(progVal); }
  function warm(url,size,base){
    return fetch(url,{mode:"cors"}).then(function(r){
      if(!r.ok||!r.body||!r.body.getReader) return r.arrayBuffer().then(function(){ setProg((base.v+=size)/base.total); });
      var rd=r.body.getReader(),got=0;
      return (function pump(){ return rd.read().then(function(x){ if(x.done) return; got+=x.value.length; base.v+=x.value.length; setProg(base.v/base.total); return pump(); }); })();
    }).catch(function(){});
  }
  function loadFace(){
    if(libP) return libP;
    var base={v:0,total:8050000};
    var m=FA_BASE+"model/";
    libP=Promise.all([
      warm(FA_BASE+"dist/face-api.js",1328559,base),
      warm(m+"tiny_face_detector_model.bin",193321,base),
      warm(m+"face_landmark_68_tiny_model.bin",77224,base),
      warm(m+"face_recognition_model.bin",6444032,base)
    ]).then(function(){ return loadScript(FA_BASE+"dist/face-api.js"); }).then(function(){
      var fa=window.faceapi;
      return Promise.all([fa.nets.tinyFaceDetector.loadFromUri(m),fa.nets.faceLandmark68TinyNet.loadFromUri(m),fa.nets.faceRecognitionNet.loadFromUri(m)]).then(function(){ setProg(1); return fa; });
    }).catch(function(e){libP=null;progVal=0;throw e;});
    return libP;
  }
  window.lvFacePreload=function(){ loadFace().catch(function(){}); };

  function toImage(src){
    return new Promise(function(res,rej){
      var img=new Image(); img.crossOrigin="anonymous";
      img.onload=function(){res(img);}; img.onerror=function(){rej(new Error("image"));};
      img.src=typeof src==="string"?src:URL.createObjectURL(src);
    });
  }
  function toCanvas(img,maxSide){
    var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,k=Math.min(1,maxSide/Math.max(w,h));
    var c=document.createElement("canvas"); c.width=Math.round(w*k); c.height=Math.round(h*k); c.getContext("2d").drawImage(img,0,0,c.width,c.height); return c;
  }
  // faces on the uploaded documents are read ahead of time (while the person fills in the form) and remembered
  var docCache=new Map();
  async function docDescriptors(fa,doc){
    var out=[];
    try{
      var img=await toImage(doc);
      var passes=[[1000,512,.25],[1500,608,.2]];
      for(var k=0;k<passes.length&&!out.length;k++){
        var can=toCanvas(img,passes[k][0]);
        var faces=await fa.detectAllFaces(can,new fa.TinyFaceDetectorOptions({inputSize:passes[k][1],scoreThreshold:passes[k][2]})).withFaceLandmarks(true).withFaceDescriptors();
        faces.forEach(function(f){out.push(f.descriptor);});
      }
    }catch(_){}
    return out;
  }
  function prepDocs(fa,docs){
    return Promise.all(docs.map(function(d){
      if(!docCache.has(d)) docCache.set(d,docDescriptors(fa,d));
      return docCache.get(d);
    })).then(function(all){return [].concat.apply([],all);});
  }
  window.lvFacePrepDocs=function(docs){ return loadFace().then(function(fa){return prepDocs(fa,docs||[]);}).catch(function(){return [];}); };
  // smallest distance between the selfie and any face found on the document photos; null when no document face was readable
  window.lvFaceCompare=async function(selfie,docs){
    var fa=await loadFace();
    var docsP=prepDocs(fa,docs||[]);
    var sImg=await toImage(selfie), sCan=toCanvas(sImg,640);
    var s=await fa.detectSingleFace(sCan,new fa.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.4})).withFaceLandmarks(true).withFaceDescriptor();
    if(!s) return {noSelfieFace:true,distance:null};
    var best=null;
    (await docsP).forEach(function(desc){ var d=fa.euclideanDistance(s.descriptor,desc); if(best==null||d<best) best=d; });
    return {distance:best};
  };
  function matchLabel(d){ if(d==null) return "unchecked"; if(d<0.45) return "strong"; if(d<0.6) return "possible"; return "mismatch"; }
  window.lvFaceMatchLabel=matchLabel;

  function ear(pts,a){ // eye aspect ratio from 6 landmark points starting at index a
    function dist(p,q){return Math.hypot(p.x-q.x,p.y-q.y);}
    var p=function(i){return pts[a+i];};
    return (dist(p(1),p(5))+dist(p(2),p(4)))/(2*dist(p(0),p(3)));
  }

  var mismatches=0;
  // opens the camera sheet; resolves {blob,url,distance,match,liveness}, {retry:true} or null if closed.
  // The photo is taken automatically (after one blink) and matched against the ID straight away.
  window.lvFaceCheck=function(opts){
    opts=opts||{};
    return new Promise(function(resolve){
      var old=document.getElementById("lvFace"); if(old) old.remove();
      var w=document.createElement("div"); w.id="lvFace"; w.setAttribute("role","dialog"); w.setAttribute("aria-modal","true");
      w.innerHTML='<div class="lvf-top"><button type="button" class="lvf-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><b>Face check</b><span></span></div>'
       +'<div class="lvf-stage"><video playsinline muted autoplay></video><div class="lvf-oval"></div></div>'
       +'<div class="lvf-msg"><strong class="t">Starting camera…</strong><span class="s">Allow camera access if asked.</span></div>'
       +'<div class="lvf-bar"><i></i></div><div class="lvf-acts hidden"></div>';
      document.body.appendChild(w); document.documentElement.style.overflow="hidden";
      var video=w.querySelector("video"),T=w.querySelector(".t"),S=w.querySelector(".s"),bar=w.querySelector(".lvf-bar i"),acts=w.querySelector(".lvf-acts"),oval=w.querySelector(".lvf-oval");
      var stream=null,alive=true,done=false,loadingMsg=true;
      function say(t,s2){T.textContent=t;S.textContent=s2||"";}
      function prog(p){bar.style.width=Math.round(p*100)+"%";}
      progCb=function(v){ if(loadingMsg&&alive){ prog(v*.9); say("Getting the face check ready… "+Math.round(v*100)+"%","First time only. Hold your phone at face level."); } };
      function finish(res){
        if(done) return; done=true; alive=false; progCb=null;
        try{ if(stream) stream.getTracks().forEach(function(t){t.stop();}); }catch(_){}
        w.remove(); document.documentElement.style.overflow=""; resolve(res||null);
      }
      function buttons(list){ acts.innerHTML=list.map(function(b){return '<button type="button" class="'+(b.pri?'pri':'')+'" data-k="'+b.k+'">'+b.t+'</button>';}).join(""); acts.classList.remove("hidden"); acts.onclick=function(e){ var k=e.target.closest("[data-k]"); if(k) list.forEach(function(b){ if(b.k===k.dataset.k) b.fn(); }); }; }
      w.querySelector(".lvf-x").addEventListener("click",function(){finish(null);});
      function showResult(res){
        loadingMsg=false; prog(1);
        if(res.match==="mismatch"){
          mismatches++; oval.classList.remove("ok");
          say("That doesn't look like the person on your ID","Face the camera in good light and try again.");
          var list=[{k:"again",t:"Try again",pri:true,fn:function(){finish({retry:true});}}];
          if(mismatches>=2) list.push({k:"send",t:"Send for review anyway",fn:function(){mismatches=0;finish(res);}});
          buttons(list); return;
        }
        mismatches=0; oval.classList.add("ok");
        if(res.match==="unchecked") say("Photo captured","An admin will review it.");
        else say("Face matched ✓","Great, you're done.");
        setTimeout(function(){ finish(res); },900);
      }
      function snap(liveness){
        if(!alive) return; alive=false; loadingMsg=false;
        var c=document.createElement("canvas"),vw=video.videoWidth||640,vh=video.videoHeight||640,k=Math.min(1,640/Math.max(vw,vh));
        c.width=Math.round(vw*k); c.height=Math.round(vh*k); c.getContext("2d").drawImage(video,0,0,c.width,c.height);
        say("Checking your photo…","Just a second."); prog(1); oval.classList.add("ok");
        try{ video.style.display="none"; var fr=document.createElement("canvas"); fr.className="lvf-frozen"; fr.width=c.width; fr.height=c.height; fr.getContext("2d").drawImage(c,0,0); w.querySelector(".lvf-stage").insertBefore(fr,oval); }catch(_){}
        try{ if(stream) stream.getTracks().forEach(function(t){t.stop();}); }catch(_){}
        c.toBlob(async function(blob){
          if(!blob){ finish(null); return; }
          var res={blob:blob,url:URL.createObjectURL(blob),liveness:!!liveness,distance:null,match:"unchecked"};
          try{
            var cmp=await window.lvFaceCompare(blob,opts.docs||[]);
            if(cmp.noSelfieFace){ say("We couldn't see your face clearly","Try again in better light."); buttons([{k:"again",t:"Try again",pri:true,fn:function(){finish({retry:true});}}]); return; }
            res.distance=cmp.distance; res.match=matchLabel(cmp.distance);
          }catch(_){}
          showResult(res);
        },"image/jpeg",.8);
      }
      (async function run(){
        try{
          var faP=loadFace();
          stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:640}},audio:false});
          if(!alive){ stream.getTracks().forEach(function(t){t.stop();}); return; }
          video.srcObject=stream; await video.play().catch(function(){});
          if(progVal<1){ say("Getting the face check ready… "+Math.round(progVal*100)+"%","First time only. Hold your phone at face level."); }
          var fa=await faP; if(!alive) return;
          loadingMsg=false;
          var opt=new fa.TinyFaceDetectorOptions({inputSize:192,scoreThreshold:.5});
          var good=0,phase="align",openMax=0,low=false,blinkAt=0,start=Date.now(),phaseAt=Date.now();
          say("Look straight at the camera","Keep your face inside the oval."); prog(.12);
          while(alive){
            var det=null;
            try{ det=await fa.detectSingleFace(video,opt).withFaceLandmarks(true); }catch(_){}
            if(!alive) break;
            var vw=video.videoWidth||640,ok=false;
            if(det){ var b=det.detection.box; var cx=(b.x+b.width/2)/vw; ok=b.width/vw>.28&&cx>.25&&cx<.75; }
            oval.classList.toggle("ok",!!ok);
            if(phase==="align"){
              good=ok?good+1:0; prog(.12+Math.min(good,3)/3*.28);
              if(good>=3){ phase="blink"; phaseAt=Date.now(); openMax=0; low=false; say("Now blink once","Slowly, with your face still in the oval."); }
            } else if(phase==="blink"){
              if(ok&&det){
                var pts=det.landmarks.positions,e=(ear(pts,36)+ear(pts,42))/2;
                if(e>openMax) openMax=e;
                if(openMax>0.18){
                  if(!low&&e<openMax*.72) low=true;
                  else if(low&&e>openMax*.86){ blinkAt=Date.now(); break; }
                }
              }
              prog(.4+Math.min(1,(Date.now()-phaseAt)/6000)*.5);
              if(Date.now()-phaseAt>6500&&ok) break;     // no blink seen: take the photo anyway, the result is marked "no blink"
            }
            if(Date.now()-start>40000) break;
            await new Promise(function(r){requestAnimationFrame(function(){r();});});
          }
          if(!alive) return;
          snap(blinkAt>0);
        }catch(err){
          var denied=err&&(err.name==="NotAllowedError"||err.name==="SecurityError");
          loadingMsg=false;
          say(denied?"Camera access is off":"Couldn't start the camera",denied?"Allow the camera for this site in your phone settings, then try again.":(err&&err.message)||"Try again.");
          buttons([{k:"close",t:"Close",pri:true,fn:function(){finish(null);}}]);
        }
      })();
    });
  };

  // ---- OCR of the ID card, run quietly after submitting. Returns {matric:boolean|null,name:boolean|null,text:string} ----
  function loadOcr(){ if(ocrP) return ocrP; ocrP=loadScript(OCR_SRC).catch(function(e){ocrP=null;throw e;}); return ocrP; }
  window.lvOcrRead=async function(blobs,matric,fullName){
    try{ if(navigator.connection&&navigator.connection.saveData) return null; }catch(_){}
    await loadOcr();
    var text="";
    for(var i=0;i<blobs.length;i++){
      try{ var r=await window.Tesseract.recognize(blobs[i],"eng"); text+=" "+((r&&r.data&&r.data.text)||""); }catch(_){}
    }
    var norm=function(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");};
    var t=norm(text);
    var mf=norm(matric).length>=4?t.indexOf(norm(matric))>=0:null;
    var parts=String(fullName||"").toLowerCase().split(/\s+/).map(norm).filter(function(x){return x.length>=3;});
    var nf=parts.length?(parts.filter(function(p){return t.indexOf(p)>=0;}).length>=Math.min(2,parts.length)):null;
    return {matric:mf,name:nf,text:text.replace(/\s+/g," ").trim().slice(0,400)};
  };

  // plain-language verdict from the stored evidence (admins still make the final call)
  window.lvFaceVerdict=function(row){
    if(!row||!row.selfie_url) return null;
    var m=row.face_match||"unchecked", live=!!row.face_liveness;
    if(m==="strong"&&live) return {k:"ok",i:"fa-circle-check",t:"AI check: face matches the ID"};
    if(m==="strong") return {k:"mid",i:"fa-circle-half-stroke",t:"AI check: face matches (no blink seen)"};
    if(m==="possible") return {k:"mid",i:"fa-circle-half-stroke",t:"AI check: needs a second look"};
    if(m==="mismatch") return {k:"bad",i:"fa-triangle-exclamation",t:"AI check: face doesn't match the ID"};
    return {k:"mid",i:"fa-eye",t:"Selfie sent for review"};
  };
  window.lvFaceStatusHtml=function(row){
    var t=window.lvFaceVerdict(row); if(!t) return "";
    return '<span class="lvf-chip '+t.k+'"><i class="fa-solid '+t.i+'"></i> '+esc(t.t)+'</span>';
  };

  // ---- admin: review one vendor's student verification (documents, selfie, AI check) and approve or reject ----
  window.lvAdminSvReview=async function(vendorId,name,done){
    var old=document.getElementById("lvSvReview"); if(old) old.remove();
    var m=document.createElement("div"); m.id="lvSvReview"; m.className="lv-cm";
    m.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card lvsr" role="dialog" aria-modal="true"><span class="lv-cm-handle"></span><p class="muted" style="text-align:center;padding:1.5rem 0"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</p></div>';
    document.body.appendChild(m);
    var card=m.querySelector(".lvsr");
    function close(){ m.remove(); }
    m.querySelector(".lv-cm-back").addEventListener("click",close);
    var r=await sb.from("vendor_student_verification").select("*").eq("vendor_id",vendorId).maybeSingle();
    var sv=r&&r.data;
    if(!sv){ card.innerHTML='<span class="lv-cm-handle"></span><p class="muted" style="text-align:center">No verification submitted yet.</p>'; return; }
    var imgs=[["ID card",sv.id_card_url],["Biodata",sv.biodata_url],["Selfie",sv.selfie_url]].filter(function(x){return x[1];});
    window.__reqPhotoSets=window.__reqPhotoSets||[]; var k=window.__reqPhotoSets.push(imgs.map(function(x){return x[1];}))-1;
    var st={pending:"Pending review",approved:"Approved",rejected:"Rejected"}[sv.status]||sv.status;
    var ocr=sv.ocr_checked_at?('Matric '+(sv.ocr_matric_found===true?'✓ found':sv.ocr_matric_found===false?'✗ not found':'–')+' · Name '+(sv.ocr_name_found===true?'✓ found':sv.ocr_name_found===false?'✗ not found':'–')):'<span class="muted">not read yet</span>';
    card.innerHTML='<span class="lv-cm-handle"></span>'
     +'<div class="lvsr-h"><strong>'+esc(name||"Vendor")+'</strong><span class="lvsr-st '+esc(sv.status)+'">'+esc(st)+'</span></div>'
     +(sv.matric_pending?'<div class="lvsr-warn"><i class="fa-solid fa-triangle-exclamation"></i> Matric number not yet available. This vendor cannot be verified until they add it.</div>':'')
     +'<div class="lvsr-grid"><div><small>Matric</small><b>'+(sv.matric_pending?'Not yet available':esc(sv.matric_number))+'</b></div><div><small>Level</small><b>'+esc(sv.level)+'</b></div><div><small>Faculty</small><b>'+esc(sv.faculty)+'</b></div><div><small>Department</small><b>'+esc(sv.department)+'</b></div></div>'
     +'<div class="lvsr-ai">'+(window.lvFaceStatusHtml(sv)||'<span class="lvf-chip mid"><i class="fa-solid fa-eye"></i> No face check yet</span>')+(sv.face_distance!=null?' <small class="muted">distance '+Number(sv.face_distance).toFixed(2)+(sv.face_liveness?' · blink seen':' · no blink')+'</small>':'')+'</div>'
     +'<div class="lvsr-ocr"><small>ID text</small> '+ocr+'</div>'
     +'<div class="req-ph-row lvsr-ph">'+imgs.map(function(x,i){ if(/\.pdf(\?|$)/i.test(x[1])) return '<a class="req-ph-thumb lvsr-pdf" href="'+esc(x[1])+'" target="_blank" rel="noopener"><i class="fa-regular fa-file-pdf"></i><span>'+esc(x[0])+' (PDF)</span></a>'; return '<button type="button" class="req-ph-thumb" data-i="'+i+'"><img src="'+esc(x[1])+'" alt="'+esc(x[0])+'"><span>'+esc(x[0])+'</span></button>';}).join("")+'</div>'
     +(sv.status==="approved"?'':'<textarea id="lvsrNote" placeholder="Note to the vendor (shown if rejected)"></textarea>')
     +'<div class="lvsr-acts">'+(sv.status!=="approved"?'<button type="button" class="ok" data-a="approved"'+(sv.matric_pending?' disabled title="Waiting for the matric number"':'')+'>Approve</button>':'')+(sv.status!=="rejected"?'<button type="button" class="no" data-a="rejected">Reject</button>':'')+'<button type="button" class="st" data-a="store">View store</button></div>';
    card.addEventListener("click",async function(e){
      var th=e.target.closest(".req-ph-thumb"); if(th){ try{ reqPhotoOpen(k,+th.dataset.i); }catch(_){} return; }
      var b=e.target.closest("[data-a]"); if(!b) return; var a=b.dataset.a;
      if(a==="store"){ close(); try{navigate("storefront",{vendorId:vendorId});}catch(_){} return; }
      b.disabled=true;
      var note=(card.querySelector("#lvsrNote")||{}).value||null;
      if(a==="rejected"&&!note){ b.disabled=false; showToast("Add a short note so the vendor knows what to fix.","error"); return; }
      var res=await sb.rpc("admin_review_student_verification",{p_vendor_id:vendorId,p_status:a,p_note:note});
      if(res.error){ b.disabled=false; showToast(res.error.message||"Couldn't save.","error"); return; }
      showToast(a==="approved"?"Student verified.":"Marked as rejected.","success"); close(); if(done) done();
    });
  };

  // ---- nudge for vendors who already sent documents but haven't done the face step ----
  var nudged=false;
  function fetchBlob(u){ return fetch(u,{mode:"cors"}).then(function(r){return r.ok?r.blob():null;}).catch(function(){return null;}); }
  function nudgeCheck(){
    if(nudged) return;
    try{ if(sessionStorage.getItem("lv-face-later")) return; }catch(_){}
    var v=null; try{ v=(typeof vendor!=="undefined"&&vendor&&vendor.id)?vendor:null; }catch(_){}
    if(!v||typeof sb==="undefined") return;
    nudged=true;
    sb.from("vendor_student_verification").select("status,selfie_url,id_card_url,biodata_url,face_v,matric_number").eq("vendor_id",v.id).maybeSingle().then(function(r){
      var row=r&&r.data; if(!row||(row.face_v||0)>=2) return;
      if(document.getElementById("lvFace")||document.getElementById("lvSetup")||document.getElementById("lvCampus")){ nudged=false; return; }
      var docs=[row.id_card_url,row.biodata_url].filter(Boolean);
      window.lvFacePreload(); window.lvFacePrepDocs(docs);
      var m=document.createElement("div"); m.id="lvFaceNudge"; m.className="lv-cm";
      m.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card" role="dialog" aria-modal="true"><span class="lv-cm-handle"></span><div class="lvf-nudge-ico"><i class="fa-solid fa-face-smile"></i></div><strong class="lv-cm-title">Quick face check</strong><p class="lvf-nudge-p">'+(row.selfie_url?'We upgraded the face check. Please do it once more, it takes about 10 seconds.':'A quick selfie and a blink confirms the ID is yours. It takes about 10 seconds and helps us approve you faster.')+'</p><button type="button" class="btn go" data-a="go">Start</button><button type="button" class="lvf-later" data-a="later">Maybe later</button></div>';
      document.body.appendChild(m);
      m.addEventListener("click",async function(e){
        var a=e.target.closest("[data-a]"); if(!a) return;
        m.remove();
        var later=function(msg){ try{sessionStorage.setItem("lv-face-later","1");}catch(_){} if(msg) showToast(msg,"info"); };
        if(a.dataset.a==="later"){ later(); return; }
        var res=await window.lvFaceCheck({docs:docs});
        while(res&&res.retry){ res=await window.lvFaceCheck({docs:docs}); }
        if(!res||!res.blob){ later("No problem. You can do the face check any time from your profile."); return; }
        try{
          var base="vendor-logos/verification/"+v.id+"/";
          var url=await uploadToR2(res.blob,base+"face-"+Date.now()+".jpg","image/jpeg");
          var rpc=await sb.rpc("submit_face_check",{p_selfie_url:url,p_distance:res.distance,p_match:res.match,p_liveness:res.liveness});
          if(rpc.error) throw rpc.error;
          showToast(res.match==="strong"?"Your face matches your ID. Sent to the admins.":"Thanks! Your face check was sent for review.","success");
          // read the ID text in the background if the document photos can be fetched
          if(window.lvOcrRead&&!(navigator.connection&&navigator.connection.saveData)){
            Promise.all(docs.map(fetchBlob)).then(function(bl){ bl=bl.filter(Boolean); if(!bl.length) return; return window.lvOcrRead(bl,row.matric_number||"",(typeof profile!=="undefined"&&profile&&profile.name)||""); }).then(function(o){
              if(!o) return; return sb.rpc("submit_face_check",{p_selfie_url:null,p_distance:res.distance,p_match:res.match,p_liveness:res.liveness,p_ocr_matric:o.matric,p_ocr_name:o.name,p_ocr_text:o.text});
            }).catch(function(){});
          }
        }catch(err){ later((err&&err.message)||"Couldn't send your face check. Try again later from your profile."); }
      });
    }).catch(function(){nudged=false;});
  }
  setInterval(nudgeCheck,6000);
})();
