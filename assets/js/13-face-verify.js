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
  function loadFace(){
    if(libP) return libP;
    libP=loadScript(FA_BASE+"dist/face-api.js").then(function(){
      var fa=window.faceapi;
      return Promise.all([fa.nets.tinyFaceDetector.loadFromUri(FA_BASE+"model"),fa.nets.faceLandmark68TinyNet.loadFromUri(FA_BASE+"model"),fa.nets.faceRecognitionNet.loadFromUri(FA_BASE+"model")]).then(function(){return fa;});
    }).catch(function(e){libP=null;throw e;});
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
  // best (smallest) distance between the selfie and any face found on the document photos; null when no document face was readable
  window.lvFaceCompare=async function(selfie,docs){
    var fa=await loadFace();
    var sImg=await toImage(selfie), sCan=toCanvas(sImg,720);
    var s=await fa.detectSingleFace(sCan,new fa.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.4})).withFaceLandmarks(true).withFaceDescriptor();
    if(!s) return {noSelfieFace:true,distance:null};
    var best=null;
    for(var i=0;i<docs.length;i++){
      try{
        var img=await toImage(docs[i]);
        var sizes=[1400,900];
        for(var k=0;k<sizes.length;k++){
          var can=toCanvas(img,sizes[k]);
          var faces=await fa.detectAllFaces(can,new fa.TinyFaceDetectorOptions({inputSize:608,scoreThreshold:.25})).withFaceLandmarks(true).withFaceDescriptors();
          faces.forEach(function(f){ var d=fa.euclideanDistance(s.descriptor,f.descriptor); if(best==null||d<best) best=d; });
          if(faces.length) break;
        }
      }catch(_){}
    }
    return {distance:best};
  };
  function matchLabel(d){ if(d==null) return "unchecked"; if(d<0.45) return "strong"; if(d<0.6) return "possible"; return "mismatch"; }
  window.lvFaceMatchLabel=matchLabel;

  function ear(pts,a){ // eye aspect ratio from 6 landmark points starting at index a
    function dist(p,q){return Math.hypot(p.x-q.x,p.y-q.y);}
    var p=function(i){return pts[a+i];};
    return (dist(p(1),p(5))+dist(p(2),p(4)))/(2*dist(p(0),p(3)));
  }

  // opens the camera sheet; resolves {blob,url,distance,match,liveness} or null if cancelled
  window.lvFaceCheck=function(opts){
    opts=opts||{};
    return new Promise(function(resolve){
      var old=document.getElementById("lvFace"); if(old) old.remove();
      var w=document.createElement("div"); w.id="lvFace"; w.setAttribute("role","dialog"); w.setAttribute("aria-modal","true");
      w.innerHTML='<div class="lvf-top"><button type="button" class="lvf-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><b>Face check</b><span></span></div>'
       +'<div class="lvf-stage"><video playsinline muted autoplay></video><div class="lvf-oval"></div></div>'
       +'<div class="lvf-msg"><strong class="t">Getting ready…</strong><span class="s">Allow camera access when asked.</span></div>'
       +'<div class="lvf-bar"><i></i></div><button type="button" class="lvf-manual hidden">Take photo now</button>';
      document.body.appendChild(w); document.documentElement.style.overflow="hidden";
      var video=w.querySelector("video"),T=w.querySelector(".t"),S=w.querySelector(".s"),bar=w.querySelector(".lvf-bar i"),manual=w.querySelector(".lvf-manual"),oval=w.querySelector(".lvf-oval");
      var stream=null,alive=true,fa=null,done=false;
      function say(t,s2){T.textContent=t;S.textContent=s2||"";}
      function prog(p){bar.style.width=Math.round(p*100)+"%";}
      function finish(res){
        if(done) return; done=true; alive=false;
        try{ if(stream) stream.getTracks().forEach(function(t){t.stop();}); }catch(_){}
        w.remove(); document.documentElement.style.overflow=""; resolve(res||null);
      }
      w.querySelector(".lvf-x").addEventListener("click",function(){finish(null);});
      function snap(liveness){
        var c=document.createElement("canvas"),vw=video.videoWidth||640,vh=video.videoHeight||640,k=Math.min(1,720/Math.max(vw,vh));
        c.width=Math.round(vw*k); c.height=Math.round(vh*k); c.getContext("2d").drawImage(video,0,0,c.width,c.height);
        say("Checking your photo…","This only takes a moment."); prog(1); oval.classList.add("ok"); manual.classList.add("hidden");
        c.toBlob(async function(blob){
          if(!blob){ finish(null); return; }
          var res={blob:blob,url:URL.createObjectURL(blob),liveness:!!liveness,distance:null,match:"unchecked"};
          try{
            var cmp=await window.lvFaceCompare(blob,opts.docs||[]);
            if(cmp.noSelfieFace){ say("We couldn't see your face clearly","Try again in better light, facing the camera."); alive=false; setTimeout(function(){ if(!done){ finish({retry:true}); } },1600); return; }
            res.distance=cmp.distance; res.match=matchLabel(cmp.distance);
          }catch(_){}
          finish(res);
        },"image/jpeg",.88);
      }
      (async function run(){
        try{
          var faP=loadFace();
          stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:720}},audio:false});
          if(!alive){ stream.getTracks().forEach(function(t){t.stop();}); return; }
          video.srcObject=stream; await video.play().catch(function(){});
          say("Loading the face check…","One moment, first time only."); prog(.08);
          fa=await faP; if(!alive) return;
          var opt=new fa.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:.5});
          var good=0,phase="align",openMax=0,low=false,blinkAt=0,start=Date.now(),phaseAt=Date.now();
          say("Look straight at the camera","Keep your face inside the oval.");
          while(alive){
            var det=null;
            try{ det=await fa.detectSingleFace(video,opt).withFaceLandmarks(true); }catch(_){}
            if(!alive) break;
            var vw=video.videoWidth||640,ok=false;
            if(det){ var b=det.detection.box; var cx=(b.x+b.width/2)/vw; ok=b.width/vw>.28&&cx>.25&&cx<.75; }
            oval.classList.toggle("ok",!!ok);
            if(phase==="align"){
              good=ok?good+1:0; prog(.15+Math.min(good,6)/6*.25);
              if(good>=6){ phase="blink"; phaseAt=Date.now(); openMax=0; low=false; say("Now blink once","Slowly, with your face still in the oval."); }
            } else if(phase==="blink"){
              if(ok&&det){
                var pts=det.landmarks.positions,e=(ear(pts,36)+ear(pts,42))/2;
                if(e>openMax) openMax=e;
                if(openMax>0.18){
                  if(!low&&e<openMax*.72) low=true;
                  else if(low&&e>openMax*.86){ blinkAt=Date.now(); break; }
                }
              }
              prog(.45+Math.min(1,(Date.now()-phaseAt)/8000)*.4);
              if(Date.now()-phaseAt>9000) manual.classList.remove("hidden");
            }
            if(Date.now()-start>45000){ break; }
            await new Promise(function(r){setTimeout(r,60);});
          }
          if(!alive) return;
          snap(blinkAt>0);
        }catch(err){
          var denied=err&&(err.name==="NotAllowedError"||err.name==="SecurityError");
          say(denied?"Camera access is off":"Couldn't start the camera",denied?"Allow the camera for this site in your phone settings, then try again.":(err&&err.message)||"Try again.");
          manual.textContent="Close"; manual.classList.remove("hidden");
          manual.onclick=function(){finish(null);};
          return;
        }
      })();
      manual.addEventListener("click",function(){ if(manual.textContent==="Take photo now") snap(false); });
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

  window.lvFaceStatusHtml=function(row){
    if(!row||!row.selfie_url) return "";
    var m=row.face_match||"unchecked";
    var map={strong:["ok","fa-circle-check","Face matches the ID"],possible:["mid","fa-circle-half-stroke","Face partly matches the ID"],mismatch:["bad","fa-triangle-exclamation","Face doesn't match the ID"],unchecked:["mid","fa-eye","Selfie sent for review"]};
    var t=map[m]||map.unchecked; return '<span class="lvf-chip '+t[0]+'"><i class="fa-solid '+t[1]+'"></i> '+t[2]+'</span>';
  };

  // ---- nudge for vendors who already sent documents but haven't done the face step ----
  var nudged=false;
  function nudgeCheck(){
    if(nudged) return;
    var v=null; try{ v=(typeof vendor!=="undefined"&&vendor&&vendor.id)?vendor:null; }catch(_){}
    if(!v||typeof sb==="undefined") return;
    nudged=true;
    try{ if(sessionStorage.getItem("lv-face-nudged")) return; }catch(_){}
    sb.from("vendor_student_verification").select("status,selfie_url,id_card_url,biodata_url").eq("vendor_id",v.id).maybeSingle().then(function(r){
      var row=r&&r.data; if(!row||row.selfie_url||row.status!=="pending") return;
      if(document.getElementById("lvFace")||document.getElementById("lvSetup")||document.getElementById("lvCampus")){ nudged=false; return; }
      try{ sessionStorage.setItem("lv-face-nudged","1"); }catch(_){}
      var m=document.createElement("div"); m.id="lvFaceNudge"; m.className="lv-cm";
      m.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card" role="dialog" aria-modal="true"><span class="lv-cm-handle"></span><div class="lvf-nudge-ico"><i class="fa-solid fa-face-smile"></i></div><strong class="lv-cm-title">One last step: verify your face</strong><p class="lvf-nudge-p">A quick selfie with a blink confirms the ID is yours, so your student badge is approved faster.</p><button type="button" class="btn go" data-a="go">Verify my face</button><button type="button" class="lvf-later" data-a="later">Later</button></div>';
      document.body.appendChild(m);
      m.addEventListener("click",async function(e){
        var a=e.target.closest("[data-a]"); if(!a&&!e.target.classList.contains("lv-cm-back")) return;
        var act=a&&a.dataset.a; m.remove(); if(act!=="go") return;
        var docs=[row.id_card_url,row.biodata_url].filter(Boolean);
        var res=await window.lvFaceCheck({docs:docs});
        while(res&&res.retry){ res=await window.lvFaceCheck({docs:docs}); }
        if(!res||!res.blob) return;
        try{
          var base="vendor-logos/verification/"+v.id+"/";
          var url=await uploadToR2(res.blob,base+"face-"+Date.now()+".jpg","image/jpeg");
          var up=await sb.from("vendor_student_verification").update({selfie_url:url,face_distance:res.distance,face_match:res.match,face_liveness:res.liveness,face_checked_at:new Date().toISOString(),status:"pending"}).eq("vendor_id",v.id);
          if(up.error) throw up.error;
          showToast("Thanks! Your face check was sent for review.","success");
        }catch(err){ showToast((err&&err.message)||"Couldn't send your face check.","error"); }
      });
    }).catch(function(){nudged=false;});
  }
  setInterval(nudgeCheck,6000);
})();
