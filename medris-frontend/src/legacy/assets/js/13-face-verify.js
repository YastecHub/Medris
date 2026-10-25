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

  // ---- selfie step: a clear photo of the person, checked for light and sharpness. Nothing is judged by AI: the admins decide. ----
  window.lvFacePreload=function(){};
  window.lvFacePrepDocs=function(){ return Promise.resolve([]); };
  // Is this frame good enough? brightness 55-215, enough detail (sharpness) in the middle of the picture.
  function frameQuality(src,w,h){
    var c=document.createElement("canvas"),k=160/Math.max(w,h); c.width=Math.max(8,Math.round(w*k)); c.height=Math.max(8,Math.round(h*k));
    var x=c.getContext("2d",{willReadFrequently:true}); x.drawImage(src,0,0,c.width,c.height);
    var d=x.getImageData(Math.round(c.width*.2),Math.round(c.height*.15),Math.round(c.width*.6),Math.round(c.height*.7)),px=d.data,W=d.width,H=d.height,g=new Float32Array(W*H),sum=0;
    for(var n=0;n<W*H;n++){ var v=.299*px[n*4]+.587*px[n*4+1]+.114*px[n*4+2]; g[n]=v; sum+=v; }
    var mean=sum/(W*H),lap=0,cnt=0;
    for(var yy=1;yy<H-1;yy++) for(var xx=1;xx<W-1;xx++){ var o=yy*W+xx,l=4*g[o]-g[o-1]-g[o+1]-g[o-W]-g[o+W]; lap+=l*l; cnt++; }
    var sharp=lap/Math.max(1,cnt);
    var issue=null;
    if(mean<55) issue="It's too dark. Move to a brighter place or face a light.";
    else if(mean>215) issue="It's too bright. Step away from the strong light.";
    else if(sharp<14) issue="The picture is blurry. Hold your phone steady and wipe the camera lens.";
    return {ok:!issue,issue:issue,mean:mean,sharp:sharp};
  }
  window.lvFrameQuality=frameQuality;
  // optional: a tiny face detector (about 1.5 MB) tells us whether a face is in the oval; if it can't load in time we simply skip that hint
  var tinyP=null;
  function loadTiny(){
    if(tinyP) return tinyP;
    tinyP=Promise.race([
      loadScript(FA_BASE+"dist/face-api.js").then(function(){ return window.faceapi.nets.tinyFaceDetector.loadFromUri(FA_BASE+"model/").then(function(){ return window.faceapi; }); }),
      new Promise(function(_,rej){ setTimeout(function(){ rej(new Error("slow")); },9000); })
    ]).catch(function(){ return null; });
    return tinyP;
  }
  // opens the camera sheet; resolves {blob,url,distance:null,match:"unchecked",liveness:false} or null when closed.
  window.lvFaceCheck=function(opts){
    return new Promise(function(resolve){
      var old=document.getElementById("lvFace"); if(old) old.remove();
      var w=document.createElement("div"); w.id="lvFace"; w.setAttribute("role","dialog"); w.setAttribute("aria-modal","true");
      w.innerHTML='<div class="lvf-top"><button type="button" class="lvf-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><b>Selfie</b><span></span></div>'
       +'<div class="lvf-stage"><video playsinline muted autoplay></video><div class="lvf-oval"></div></div>'
       +'<div class="lvf-msg"><strong class="t">Starting camera…</strong><span class="s">Allow camera access if asked.</span></div>'
       +'<div class="lvf-acts"></div><input type="file" accept="image/*" capture="user" class="hidden" id="lvfPick">';
      document.body.appendChild(w); document.documentElement.style.overflow="hidden";
      var video=w.querySelector("video"),T=w.querySelector(".t"),S=w.querySelector(".s"),acts=w.querySelector(".lvf-acts"),oval=w.querySelector(".lvf-oval"),pick=w.querySelector("#lvfPick"),stage=w.querySelector(".lvf-stage");
      var stream=null,alive=true,done=false,goodSince=0,tiny=null,hasCam=false;
      function say(t,s2){T.textContent=t;S.textContent=s2||"";}
      function buttons(list){ acts.innerHTML=list.map(function(b){return '<button type="button" class="'+(b.pri?'pri':'')+'"'+(b.dis?' disabled':'')+' data-k="'+b.k+'">'+b.t+'</button>';}).join(""); acts.classList.remove("hidden"); acts.onclick=function(e){ var k=e.target.closest("[data-k]"); if(!k||k.disabled) return; list.forEach(function(b){ if(b.k===k.dataset.k) b.fn(); }); }; }
      function stop(){ try{ if(stream) stream.getTracks().forEach(function(t){t.stop();}); }catch(_){} stream=null; }
      function finish(res){ if(done) return; done=true; alive=false; stop(); w.remove(); document.documentElement.style.overflow=""; resolve(res||null); }
      w.querySelector(".lvf-x").addEventListener("click",function(){ finish(null); });
      function review(canvas){
        // show the photo and let the person confirm it is clear (this is also what the admin will see)
        alive=false; stop();
        var q=frameQuality(canvas,canvas.width,canvas.height);
        video.style.display="none"; oval.style.display="none"; var old2=stage.querySelector(".lvf-frozen"); if(old2) old2.remove();
        var fr=document.createElement("canvas"); fr.className="lvf-frozen"; fr.width=canvas.width; fr.height=canvas.height; fr.getContext("2d").drawImage(canvas,0,0); stage.appendChild(fr);
        if(!q.ok){
          say("This photo isn't clear enough",q.issue);
          buttons([{k:"again",t:"Retake",pri:true,fn:function(){ fr.remove(); video.style.display=""; oval.style.display=""; start(); }}]); return;
        }
        say("Is your face clear and in the middle?","Your photo goes to the admins, who check it themselves.");
        buttons([{k:"use",t:"Use this photo",pri:true,fn:function(){
          canvas.toBlob(function(blob){ if(!blob){ finish(null); return; } finish({blob:blob,url:URL.createObjectURL(blob),liveness:false,distance:null,match:"unchecked"}); },"image/jpeg",.85);
        }},{k:"again",t:"Retake",fn:function(){ fr.remove(); video.style.display=""; oval.style.display=""; start(); }}]);
      }
      function snapFromVideo(){
        var vw=video.videoWidth||640,vh=video.videoHeight||640,k=Math.min(1,960/Math.max(vw,vh));
        var c=document.createElement("canvas"); c.width=Math.round(vw*k); c.height=Math.round(vh*k);
        var x=c.getContext("2d"); x.translate(c.width,0); x.scale(-1,1); x.drawImage(video,0,0,c.width,c.height);   // un-mirror so it matches the ID
        review(c);
      }
      function fromFile(file){
        var img=new Image(); img.onload=function(){ var k=Math.min(1,960/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k); c.getContext("2d").drawImage(img,0,0,c.width,c.height); review(c); };
        img.onerror=function(){ say("Couldn't read that photo","Try taking it again."); };
        img.src=URL.createObjectURL(file);
      }
      pick.addEventListener("change",function(){ var f=pick.files&&pick.files[0]; pick.value=""; if(f) fromFile(f); });
      function fallback(msg){
        alive=false; stop(); say(msg||"Take a clear selfie","Face the light, keep your face in the middle.");
        buttons([{k:"cam",t:"Open camera",pri:true,fn:function(){ pick.click(); }}]);
      }
      async function start(){
        alive=true; goodSince=0; hasCam=false; var t0=Date.now();
        say("Starting camera…","Allow camera access if asked.");
        buttons([{k:"snap",t:"Take photo",pri:true,dis:true,fn:function(){ snapFromVideo(); }}]);
        try{
          if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ fallback("Take a clear selfie"); return; }
          stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:960}},audio:false});
          if(!alive){ stop(); return; }
          video.srcObject=stream; await video.play().catch(function(){}); hasCam=true;
          loadTiny().then(function(fa){ tiny=fa||null; });
          say("Look straight at the camera","Keep your face in the oval, in good light.");
          var opt=null;
          (async function loop(){
            while(alive){
              await new Promise(function(r){ setTimeout(r,350); });
              if(!alive||!video.videoWidth) continue;
              var q=frameQuality(video,video.videoWidth,video.videoHeight),faceOk=true;
              if(tiny){
                try{ if(!opt) opt=new tiny.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:.45}); var det=await tiny.detectSingleFace(video,opt); if(!alive) break;
                  if(!det) faceOk=false; else { var b=det.box,vw=video.videoWidth,cx=(b.x+b.width/2)/vw; faceOk=b.width/vw>.25&&cx>.22&&cx<.78; } }catch(_){}
              }
              var good=q.ok&&faceOk;
              oval.classList.toggle("ok",good);
              var btn=acts.querySelector('[data-k="snap"]'); if(btn) btn.disabled=!good;
              if(!q.ok) say("Not clear yet",q.issue);
              else if(!faceOk) say("Move into the oval","Your whole face should be inside it.");
              else say("Looks good","Hold still, taking your photo…");
              if(good){ if(!goodSince) goodSince=Date.now(); if(Date.now()-goodSince>1400&&(tiny||Date.now()-t0>6000)){ snapFromVideo(); return; } } else goodSince=0;
            }
          })();
        }catch(err){
          var denied=err&&(err.name==="NotAllowedError"||err.name==="SecurityError");
          fallback(denied?"Camera access is off. You can still take the photo with your phone camera.":"Couldn't start the live camera. Use your phone camera instead.");
        }
      }
      start();
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
    return {k:"ok",i:"fa-camera",t:"Selfie provided"};
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
    var got=await Promise.all([
      sb.from("vendor_student_verification").select("*").eq("vendor_id",vendorId).maybeSingle().then(function(r){ return (window.lvSignDocs&&r&&r.data)?window.lvSignDocs(r.data).then(function(){return r;}):r; }),
      sb.from("vendors").select("business_name,logo_url,verification_status,student_verified,campus_id").eq("id",vendorId).maybeSingle()
    ]);
    var sv=got[0]&&got[0].data, vd=(got[1]&&got[1].data)||{};
    var vname=vd.business_name||name||"Vendor";
    var camp=""; try{ if(vd.campus_id&&window.lvCampusById){ var cr=window.lvCampusById(vd.campus_id); if(cr) camp=cr.name; } }catch(_){}
    var appSt=vd.verification_status||"pending";
    var head='<span class="lv-cm-handle"></span><div class="lvsr-who"><span class="lvsr-av">'+(vd.logo_url?'<img src="'+esc(vd.logo_url)+'" alt="">':esc(String(vname).slice(0,1).toUpperCase()))+'</span><div><strong>'+esc(vname)+'</strong><small>'+(camp?esc(camp)+' · ':'')+'Application: '+esc(appSt)+'</small></div></div>';
    // vendor application (approve / reject the business itself), right here with the student check
    var appActs=appSt!=="verified"?'<div class="lvsr-app"><small>Vendor application</small><div class="lvsr-acts">'+'<button type="button" class="ok" data-a="app-ok">Approve vendor</button>'+(appSt!=="rejected"?'<button type="button" class="no" data-a="app-no">Reject</button>':'')+'</div></div>':'';
    async function appAction(k,b){
      b.disabled=true;
      var res=await sb.rpc("admin_set_vendor_status",{p_vendor_id:vendorId,p_status:k==="app-ok"?"verified":"rejected"});
      if(res.error||(res.data&&res.data.success===false)){ b.disabled=false; showToast((res.error&&res.error.message)||"Couldn't save.","error"); return; }
      showToast(k==="app-ok"?"Vendor approved.":"Vendor rejected.","success"); close(); if(done) done();
    }
    if(!sv){
      card.innerHTML=head+'<p class="muted" style="text-align:center;margin:.8rem 0">No student verification submitted yet.</p>'+appActs+'<div class="lvsr-acts"><button type="button" class="st" data-a="store">View store</button></div>';
      card.addEventListener("click",function(e){ var b=e.target.closest("[data-a]"); if(!b) return; var a=b.dataset.a; if(a==="store"){ close(); try{navigate("storefront",{vendorId:vendorId});}catch(_){} } else if(a==="app-ok"||a==="app-no") appAction(a,b); });
      return;
    }
    var imgs=[["ID card",sv.id_card_url],["Biodata",sv.biodata_url],["Selfie",sv.selfie_url]].filter(function(x){return x[1];});
    window.__reqPhotoSets=window.__reqPhotoSets||[]; var k=window.__reqPhotoSets.push(imgs.filter(function(x){return !/\.pdf(\?|$)/i.test(x[1]);}).map(function(x){return x[1];}))-1;
    var st={pending:"Pending review",approved:"Approved",rejected:"Rejected"}[sv.status]||sv.status;
    var ocr=sv.ocr_checked_at?('Matric '+(sv.ocr_matric_found===true?'✓ found':sv.ocr_matric_found===false?'✗ not found':'–')+' · Name '+(sv.ocr_name_found===true?'✓ found':sv.ocr_name_found===false?'✗ not found':'–')):'<span class="muted">not read yet</span>';
    var imgIdx=0;
    card.innerHTML=head
     +'<div class="lvsr-h"><strong>Student verification</strong><span class="lvsr-st '+esc(sv.status)+'">'+esc(st)+'</span></div>'
     +(sv.not_student?'<div class="lvsr-warn" style="background:rgba(47,123,255,.12);color:inherit"><i class="fa-solid fa-store"></i> This seller says they are NOT a student. Approving gives them a Verified seller badge (not the student badge).</div>':'')
     +(sv.matric_pending&&!sv.not_student?'<div class="lvsr-warn"><i class="fa-solid fa-triangle-exclamation"></i> Matric number not yet available. You can still verify this student if you have checked their other documents; you will be asked to confirm.</div>':'')
     +'<div class="lvsr-grid"><div><small>Matric</small><b>'+(sv.matric_pending?'Not yet available':esc(sv.matric_number))+'</b></div><div><small>Level</small><b>'+esc(sv.level)+'</b></div><div><small>Faculty</small><b>'+esc(sv.faculty)+'</b></div><div><small>Department</small><b>'+esc(sv.department)+'</b></div></div>'
     +'<div class="lvsr-ai">'+(window.lvFaceStatusHtml(sv)||'<span class="lvf-chip bad"><i class="fa-solid fa-camera"></i> No selfie yet</span>')+'</div>'
     +'<div class="req-ph-row lvsr-ph">'+imgs.map(function(x){ if(/\.pdf(\?|$)/i.test(x[1])) return '<a class="req-ph-thumb lvsr-pdf" href="'+esc(x[1])+'" target="_blank" rel="noopener"><i class="fa-regular fa-file-pdf"></i><span>'+esc(x[0])+' (PDF)</span></a>'; var n=imgIdx++; return '<button type="button" class="req-ph-thumb" data-i="'+n+'"><img src="'+esc(x[1])+'" alt="'+esc(x[0])+'"><span>'+esc(x[0])+'</span></button>';}).join("")+'</div>'
     +(sv.status==="approved"?'':'<textarea id="lvsrNote" placeholder="Note to the vendor (shown if rejected)"></textarea>')
     +'<div class="lvsr-acts">'+(sv.status!=="approved"?'<button type="button" class="ok" data-a="approved"'+""+'>'+(sv.not_student?'Verify seller':'Verify student')+'</button>':'')+(sv.status!=="rejected"?'<button type="button" class="no" data-a="rejected">Reject</button>':'')+'<button type="button" class="st" data-a="store">View store</button></div>'
     +appActs;
    card.addEventListener("click",async function(e){
      var th=e.target.closest(".req-ph-thumb[data-i]"); if(th){ try{ reqPhotoOpen(k,+th.dataset.i); }catch(_){} return; }
      var b=e.target.closest("[data-a]"); if(!b) return; var a=b.dataset.a;
      if(a==="store"){ close(); try{navigate("storefront",{vendorId:vendorId});}catch(_){} return; }
      if(a==="app-ok"||a==="app-no"){ appAction(a,b); return; }
      if(a==="approved"&&sv.matric_pending&&!sv.not_student){
        var sure=await showConfirmDialog("This student has no matric number yet. Do you want to verify them anyway? Only continue if you have checked their ID card and other documents.",{title:"Verify without a matric number?",okLabel:"Yes, verify them",cancelLabel:"Go back",icon:"fa-user-check"});
        if(!sure) return;
      }
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
    var v=null; try{ v=(typeof vendor!=="undefined"&&vendor&&vendor.id)?vendor:null; }catch(_){}
    if(!v||typeof sb==="undefined") return;
    nudged=true;
    sb.from("vendor_student_verification").select("status,selfie_url,id_card_url,biodata_url,face_v,matric_number").eq("vendor_id",v.id).maybeSingle().then(function(r){
      var row=r&&r.data; if(!row||(row.face_v||0)>=2) return; if(window.lvSignDocs) window.lvSignDocs(row);
      if(document.getElementById("lvFace")||document.getElementById("lvSetup")||document.getElementById("lvCampus")){ nudged=false; return; }
      var docs=[row.id_card_url,row.biodata_url].filter(Boolean);
      window.lvFacePreload(); window.lvFacePrepDocs(docs);
      var m=document.createElement("div"); m.id="lvFaceNudge"; m.className="lv-cm";
      m.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card" role="dialog" aria-modal="true"><span class="lv-cm-handle"></span><div class="lvf-nudge-ico"><i class="fa-solid fa-camera"></i></div><strong class="lv-cm-title">Take a quick selfie</strong><p class="lvf-nudge-p">Your selfie is required to finish verification. Take it in good light, with your face clear and in the middle. Our team checks it personally.</p><button type="button" class="btn go" data-a="go">Take selfie</button></div>';
      document.body.appendChild(m);
      m.addEventListener("click",async function(e){
        var a=e.target.closest("[data-a]"); if(!a) return;
        m.remove();
        var later=function(msg){ if(msg) showToast(msg,"info"); nudged=false; setTimeout(nudgeCheck,45000); };
        var res=await window.lvFaceCheck({docs:docs});
        while(res&&res.retry){ res=await window.lvFaceCheck({docs:docs}); }
        if(!res||!res.blob){ later("Your selfie is still needed to finish verification."); return; }
        try{
          var base="vendor-logos/verification/"+v.id+"/";
          var url=await uploadToR2(res.blob,base+"face-"+Date.now()+".jpg","image/jpeg");
          var rpc=await sb.rpc("submit_face_check",{p_selfie_url:url,p_distance:res.distance,p_match:res.match,p_liveness:res.liveness});
          if(rpc.error) throw rpc.error;
          showToast("Thanks! Your selfie was sent to our team.","success");
        }catch(err){ later((err&&err.message)||"Couldn't send your selfie. We'll ask again in a moment."); }
      });
    }).catch(function(){nudged=false;});
  }
  // selfie nudge switched off: a selfie is no longer asked for
})();
