/* ---- levromart-final-qa-20260909-js ---- */
(function(){
  "use strict";

  /* ---------------------------------------------------------------
     MAP ROUTE, continuous accent-coloured animated trace.
     --------------------------------------------------------------- */
  const oldTrace = window.traceVendorRoute;
  if(typeof oldTrace === "function" && !window.__levroAnimatedRouteFinal){
    window.__levroAnimatedRouteFinal = true;
    window.traceVendorRoute = async function(vendor){
      await oldTrace.apply(this, arguments);
      try{
        setTimeout(()=>{
          document.querySelectorAll('#vendorsMap .leaflet-overlay-pane path').forEach(path=>path.classList.add('levro-vendor-route-path'));
        },60);
      }catch(_){}
    };
  }

  /* ---------------------------------------------------------------
     CHAT SWIPE, one clean recogniser only. The older layered wrappers were
     able to attach multiple pointer handlers to one bubble, which is exactly
     the kind of competing gesture handling that makes a WhatsApp-style drag
     feel sticky. Replace the interaction dispatcher so only this recogniser
     is attached to fresh message DOM.
     --------------------------------------------------------------- */
  window.setupMessageSwipeReply = function(root){
    const scope=root||document;
    const REPLY_THRESHOLD=54;
    scope.querySelectorAll?.('.chat-bubble-wrap[data-msg-wrap-id]').forEach(wrap=>{
      const bubble=wrap.querySelector('.chat-bubble[data-msg-id]');
      if(!bubble || bubble.classList.contains('deleted') || bubble.dataset.finalSwipeBound==='1') return;
      bubble.dataset.finalSwipeBound='1';
      const mine=bubble.classList.contains('mine');
      let tracking=false,horizontal=false,sx=0,sy=0,dx=0,dy=0,pointerId=null,armed=false;
      const reset=()=>{
        tracking=false;horizontal=false;armed=false;pointerId=null;dx=dy=0;
        wrap.classList.remove('chat-swipe-active');
        wrap.style.removeProperty('--swipe-progress');
        bubble.style.transform='';
      };
      bubble.addEventListener('pointerdown',e=>{
        if(chatSelectionMode || (e.pointerType==='mouse' && e.button!==0)) return;
        sx=e.clientX;sy=e.clientY;dx=dy=0;tracking=true;horizontal=false;pointerId=e.pointerId;
        try{bubble.setPointerCapture(e.pointerId);}catch(_){}
      },{passive:true});
      bubble.addEventListener('pointermove',e=>{
        if(!tracking || (pointerId!==null && e.pointerId!==pointerId)) return;
        dx=e.clientX-sx;dy=e.clientY-sy;
        if(!horizontal){
          const adx=Math.abs(dx),ady=Math.abs(dy);
          // Wait for a real touch-slop distance before deciding anything --
          // deciding off the first 1-2px sample (which is often pure noise,
          // dy=0 or dx=0 by chance) was locking the gesture into "horizontal"
          // on pure jitter, which then called preventDefault and broke
          // ordinary vertical scrolling over messages entirely.
          if(adx<4 && ady<4)return;
          // Only reject a drag that's unmistakably vertical (a real scroll
          // attempt); anything even roughly sideways commits to the swipe
          // immediately, same as Telegram/WhatsApp -- no decisive first
          // sample or held pause required.
          if(ady>adx*1.6)return;
          horizontal=true;wrap.classList.add('chat-swipe-active');
        }
        const allowed=mine?dx<0:dx>0;
        if(!allowed){bubble.style.transform='translate3d(0,0,0)';wrap.style.setProperty('--swipe-progress','0');return;}
        e.preventDefault();
        const clamped=mine?Math.max(-100,dx):Math.min(100,dx);
        // Track the finger 1:1 up to the reply threshold, then ease off so
        // it still feels attached to the drag without traveling forever.
        const extra=Math.abs(clamped)-REPLY_THRESHOLD;
        const magnitude=extra>0?REPLY_THRESHOLD+extra*.35:Math.abs(clamped);
        const shift=mine?-magnitude:magnitude;
        bubble.style.transform=`translate3d(${shift}px,0,0)`;
        const progress=Math.min(1,Math.abs(clamped)/REPLY_THRESHOLD);
        wrap.style.setProperty('--swipe-progress',String(progress));
        if(progress>=1 && !armed){armed=true; if(navigator.vibrate)navigator.vibrate(10);}
        else if(progress<1 && armed){armed=false;}
      },{passive:false});
      const finish=()=>{
        if(!tracking)return;
        const allowed=mine?dx<0:dx>0;
        const shouldReply=horizontal&&allowed&&Math.abs(dx)>=REPLY_THRESHOLD;
        const msgId=bubble.dataset.msgId;
        try{if(pointerId!==null)bubble.releasePointerCapture(pointerId);}catch(_){}
        reset();
        if(shouldReply&&msgId){
          wrap.classList.add('chat-swipe-reply');
          setChatReplyTarget(msgId);
          setTimeout(()=>wrap.classList.remove('chat-swipe-reply'),220);
          requestAnimationFrame(()=>{try{byId('chatInput')?.focus({preventScroll:true});}catch(_){} });
        }
      };
      bubble.addEventListener('pointerup',finish,{passive:true});
      bubble.addEventListener('pointercancel',reset,{passive:true});
      bubble.addEventListener('lostpointercapture',finish,{passive:true});
    });
  };

  window.setupMessageInteractions=function(root){
    const scope=root||document;
    if(typeof setupMessageLongPress==='function') setupMessageLongPress(scope);
    if(typeof setupMessageDoubleTap==='function') setupMessageDoubleTap(scope);
    window.setupMessageSwipeReply(scope);
    scope.querySelectorAll?.('.chat-image-attachment img').forEach(img=>{
      if(img.dataset.imageMenuBound==='1')return;
      img.dataset.imageMenuBound='1';
      img.addEventListener('contextmenu',e=>e.preventDefault(),{capture:true});
      img.addEventListener('dragstart',e=>e.preventDefault(),{capture:true});
    });
  };

  /* Keep the keyboard behaviour deliberately unchanged: sending clears the
     composer but does not refocus it. Swiping to reply is the only gesture
     here that explicitly focuses the composer. */
  const originalSend=window.sendChatMessage;
  if(typeof originalSend==='function' && !window.__levroSendKeyboardFinal){
    window.__levroSendKeyboardFinal=true;
    window.sendChatMessage=async function(){ return originalSend.apply(this,arguments); };
  }

  /* ---------------------------------------------------------------
     LEVI, generic fallback becomes a useful clarification instead of a
     canned identity response. Try live products/vendors first, then ask a
     concrete "did you mean" question.
     --------------------------------------------------------------- */
  const oldSpecificFallback=typeof window.leviSpecificFallback==='function'?window.leviSpecificFallback:null;
  async function smartLeviClarification(text){
    const q=String(text||'').trim();
    if(!q) return null;
    try{
      const clean=q.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
      const tokens=clean.split(' ').filter(w=>w.length>=2).slice(0,5);
      const {data:products}=await sb.from('products').select('id,name,description,vendor:vendors!inner(id,business_name,verification_status,is_active)').eq('status','active').eq('vendor.verification_status','verified').eq('vendor.is_active',true).limit(500);
      const editDistance=(a,b)=>{
        const aa=String(a||''),bb=String(b||'');
        if(!aa||!bb)return 999;
        const prev=Array.from({length:bb.length+1},(_,i)=>i);
        for(let i=1;i<=aa.length;i++){
          const cur=[i];
          for(let j=1;j<=bb.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(aa[i-1]===bb[j-1]?0:1));
          for(let j=0;j<cur.length;j++) prev[j]=cur[j];
        }
        return prev[bb.length];
      };
      const score=(p)=>{
        const name=String(p.name||'').toLowerCase();
        const desc=String(p.description||'').toLowerCase();
        const nameTokens=name.split(/\s+/).filter(Boolean);
        let n=0;
        for(const t of tokens){
          if(name===t)n+=10;
          else if(name.includes(t))n+=6;
          else if(nameTokens.some(nt=>nt.includes(t)))n+=4;
          else if(nameTokens.some(nt=>t.length>=4 && editDistance(t,nt)<=2))n+=3;
          else if(desc.includes(t))n+=1;
        }
        return n;
      };
      const matches=(products||[]).map(p=>({p,s:score(p)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,3);
      if(matches.length){
        const opts=matches.map(x=>`“${x.p.name}” from ${x.p.vendor?.business_name||'a verified vendor'}`).join(', ');
        return `I couldn't match “${q}” exactly. Did you mean ${opts}?`;
      }
      const {data:vendors}=await sb.from('vendors').select('business_name,city').eq('verification_status','verified').eq('is_active',true).limit(100);
      const vm=(vendors||[]).find(v=>String(v.business_name||'').toLowerCase().includes(clean));
      if(vm)return `I found a vendor called “${vm.business_name}”${vm.city?` in ${vm.city}`:''}. Is that the one you meant?`;
    }catch(e){console.warn('[Levromart] Levi clarification lookup failed:',e);}
    return `I’m not sure what you mean by “${q}”. Did you mean a product, a vendor, an order, or something else on Levromart?`;
  }

  const originalFetch=window.fetchLeviReply;
  if(typeof originalFetch==='function'&&!window.__levroLeviClarificationFinal){
    window.__levroLeviClarificationFinal=true;
    window.fetchLeviReply=async function(payload){
      const first=await originalFetch.apply(this,arguments);
      const reply=String(first?.reply||'').trim();
      const generic=/\b(?:i['’]?m|hi[,!]?\s+i['’]?m)\s+levi\b/i.test(reply) || /^(?:i can help with|try asking me|i couldn't get a useful answer)/i.test(reply);
      if(!generic)return first;
      try{
        const latest=[...(payload?.messages||[])].reverse().find(m=>m?.role==='user')?.content||'';
        const specific=oldSpecificFallback?oldSpecificFallback(latest):null;
        if(specific)return {...first,reply:specific};
        const clarification=await smartLeviClarification(latest);
        if(clarification)return {...first,reply:clarification};
      }catch(e){console.warn('[Levromart] Levi final clarification failed:',e);}
      return {...first,reply:'I couldn’t get a useful answer yet. Tell me what you’re looking for and I’ll help narrow it down.'};
    };
  }

  /* ---------------------------------------------------------------
     COMMISSION DEADLINE, vendor heartbeat. The DB function is authoritative;
     this heartbeat makes the one-week rule take effect while the vendor is
     using the app, without waiting for a navigation/reload.
     --------------------------------------------------------------- */
  let commissionHeartbeat=null;
  let commissionModalOpen=false;
  function showCommissionOverdueModal(){
    if(commissionModalOpen||!vendor?.id)return;
    commissionModalOpen=true;
    byId('commissionOverdueModal')?.remove();
    const modal=document.createElement('div');
    modal.id='commissionOverdueModal';modal.className='modal open';
    modal.style.zIndex='2500';
    modal.innerHTML=`<div class="modal-content" style="max-width:430px;"><div class="flex" style="justify-content:space-between;align-items:center;gap:.6rem;"><h3 style="margin:0;"><i class="fa-solid fa-lock"></i> Storefront paused</h3></div><p style="margin:.7rem 0;">Your storefront and vendor tools are paused until your outstanding commission is settled.</p><div id="commissionOverdueAmount" class="card" style="margin:.65rem 0;padding:.8rem;">Loading amount owed…</div><button type="button" class="btn" style="width:100%;justify-content:center;" onclick="commissionOverduePayNow()"><i class="fa-solid fa-credit-card"></i> Pay commission owed</button></div>`;
    document.body.appendChild(modal);
    loadCommissionOverdueAmount();
  }
  async function loadCommissionOverdueAmount(){
    try{
      const {data}=await sb.rpc('get_vendor_commission_owed',{p_vendor_id:vendor.id});
      const el=byId('commissionOverdueAmount');if(el)el.innerHTML=`<strong>${naira(Number(data||0))}</strong> commission owed`;
    }catch(e){console.warn('[Levromart] commission amount lookup failed',e);}
  }
  window.commissionOverduePayNow=async function(){
    const modal=byId('commissionOverdueModal');
    modal?.remove();commissionModalOpen=false;
    await payCommission();
  };
  async function checkCommissionDeadline(){
    if(!session||profile?.role!=='vendor'||!vendor?.id)return;
    try{
      await sb.rpc('enforce_commission_deadlines',{p_vendor_id:vendor.id});
      // Hour-level heads-up (10h/5h/1h before pause) inside the final day.
      // Cheap and self-deduping server-side, so just fire-and-forget each tick.
      sb.rpc('process_vendor_commission_hour_reminders',{p_vendor_id:vendor.id}).catch(()=>{});
      const {data:deadline}=await sb.rpc('get_vendor_commission_deadline',{p_vendor_id:vendor.id});
      const dueAt=deadline?.[0]?.earliest_due_at||null;
      const {data:owed}=await sb.rpc('get_vendor_commission_owed',{p_vendor_id:vendor.id});
      // Paystack won't transfer under ₦100, so pausing over a smaller balance
      // than that just locks a vendor out for nothing collectible yet.
      const hasOverdue=vendor.commission_pause_reason!=='admin_override' && !!dueAt && new Date(dueAt).getTime()<=Date.now() && Number(owed||0)>=100;
      if(hasOverdue){
        vendor.is_active=false;vendor.commission_paused=true;vendor.commission_pause_reason='commission_overdue';
        showCommissionOverdueModal();
        return;
      }
      if(Number(owed||0)<=0 && vendor.commission_paused){
        vendor.is_active=true;vendor.commission_paused=false;vendor.commission_pause_reason=null;
        byId('commissionOverdueModal')?.remove();commissionModalOpen=false;
        showToast('Commission settled. Your storefront is active again.','success');
      } else if(!hasOverdue && vendor.commission_paused && ['commission_owed','commission_overdue'].includes(vendor.commission_pause_reason||'')) {
        // Repair any stale in-memory lock from the previous immediate-pause logic.
        vendor.is_active=true;vendor.commission_paused=false;vendor.commission_pause_reason=null;
        byId('commissionOverdueModal')?.remove();commissionModalOpen=false;
      }
    }catch(e){console.warn('[Levromart] commission deadline check failed:',e);}
  }
  // The server enforces the deadline on its own, so this only needs to look when the
  // vendor opens the app, comes back to it, and every 10 minutes while it stays open
  // (it used to run four requests every minute).
  let commissionLastCheck=0;
  function startCommissionHeartbeat(){
    if(commissionHeartbeat)clearInterval(commissionHeartbeat);
    commissionLastCheck=Date.now();
    checkCommissionDeadline();
    commissionHeartbeat=setInterval(()=>{ if(document.hidden)return; commissionLastCheck=Date.now(); checkCommissionDeadline(); },10*60000);
    if(!window.__commissionVisBound){
      window.__commissionVisBound=true;
      document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&Date.now()-commissionLastCheck>5*60000){ commissionLastCheck=Date.now(); checkCommissionDeadline(); } },{passive:true});
    }
  }
  function stopCommissionHeartbeat(){if(commissionHeartbeat){clearInterval(commissionHeartbeat);commissionHeartbeat=null;}}
  setTimeout(()=>{
    if(session&&profile?.role==='vendor'&&vendor?.id)startCommissionHeartbeat();
  },1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkCommissionDeadline();},{passive:true});
})();

/* ---- levromart-user-fixes-2026-09-10-request-handler ---- */
(function(){
  "use strict";
  /* Capture the tap at document level because the request page is rendered dynamically. */
  document.addEventListener("click",function(e){
    const btn=e.target?.closest?.("#postEquipmentRequestBtn");
    if(!btn || btn.dataset.levroHandled==="1") return;
    btn.dataset.levroHandled="1";
    e.preventDefault();
    e.stopPropagation();
    try{
      const result=window.submitEquipmentRequest?.();
      if(result?.finally) result.finally(()=>{try{delete btn.dataset.levroHandled;}catch(_){}});
      else setTimeout(()=>{try{delete btn.dataset.levroHandled;}catch(_){}},500);
    }catch(err){
      try{delete btn.dataset.levroHandled;}catch(_){}
      console.error("[Levromart] Post request click failed:",err);
    }
  },true);
  window.__levroEnsureVendorRequestsLabel=function(){
    document.querySelectorAll("#profilePanel .profile-nav-link").forEach(function(link){
      const text=(link.querySelector(".profile-nav-text")?.textContent||"").trim().toLowerCase();
      if(text==="customer requests"){
        const span=link.querySelector(".profile-nav-text");
        if(span) span.textContent="Requests";
        link.setAttribute("data-profile-label","Requests");
      }
    });
  };
  setTimeout(window.__levroEnsureVendorRequestsLabel,100);
  setTimeout(window.__levroEnsureVendorRequestsLabel,600);
})();

/* ---- levromart-20260910-chat-media-editor-runtime ---- */
(function(){
  'use strict';

  const GROUP_PREFIX='__LM_CHAT_GROUP__';
  function mediaGroupToken(name){
    const raw=String(name||'');
    const m=raw.match(/^__LM_CHAT_GROUP__([a-zA-Z0-9_-]+)__\|([\s\S]*)$/);
    return m?{id:m[1],name:m[2]}:null;
  }
  window.__levroChatMediaGroupToken=mediaGroupToken;

  /* Show the real filename, not the internal grouping marker. */
  const originalAttachmentHtml=window.attachmentHtml;
  window.attachmentHtml=function(m){
    if(!m?.attachment_url) return '';
    const isImage=(m.attachment_type||'').startsWith('image/');
    const parsed=mediaGroupToken(m.attachment_name);
    const displayName=parsed?.name || m.attachment_name || '';
    if(isImage) return `<button type="button" class="msg-attachment chat-image-attachment" data-attachment-path="${esc(m.attachment_url)}" onclick="scheduleChatImageTap(this)" aria-label="Open image"><img class="msg-attachment-img" alt="${esc(displayName)}" /></button>`;
    return originalAttachmentHtml ? originalAttachmentHtml({...m,attachment_name:displayName}) : '';
  };

  const originalChatBubbleHtml=window.chatBubbleHtml;
  window.chatBubbleHtml=function(m){
    const html=originalChatBubbleHtml ? originalChatBubbleHtml(m) : '';
    const token=mediaGroupToken(m?.attachment_name);
    if(!token || !html) return html;
    return html.replace(/class="chat-bubble-wrap /,`class="chat-bubble-wrap chat-media-group-item `).replace(/data-msg-wrap-id="([^"]+)"/,`data-msg-wrap-id="$1" data-media-group="${esc(token.id)}"`);
  };

  function groupChatMediaMessages(root){
    if(!root) return;
    /* Ungroup only wrappers we created; this makes the routine safe to rerun after realtime inserts. */
    root.querySelectorAll('.chat-media-group').forEach(group=>{
      const parent=group.parentNode;
      [...group.children].forEach(ch=>parent.insertBefore(ch,group));
      group.remove();
    });
    const children=[...root.children];
    let i=0;
    while(i<children.length){
      const first=children[i];
      const id=first?.dataset?.mediaGroup;
      if(!id){i++;continue;}
      const items=[first];
      let j=i+1;
      while(j<children.length && children[j]?.dataset?.mediaGroup===id){items.push(children[j]);j++;}
      if(items.length>1){
        const group=document.createElement('div');
        group.className='chat-media-group';
        group.dataset.mediaGroup=id;
        group.classList.add(items[0].classList.contains('mine')?'mine':'theirs');
        items[0].parentNode.insertBefore(group,items[0]);
        items.forEach(item=>group.appendChild(item));
      }
      i=j;
    }
  }
  window.groupChatMediaMessages=groupChatMediaMessages;

  const oldResolve=window.resolveVisibleAttachments;
  if(typeof oldResolve==='function'){
    /* The original resolver remains authoritative; grouping is visual only. */
    window.resolveVisibleAttachments=async function(root){
      const result=await oldResolve(root);
      groupChatMediaMessages(root||byId('chatMessages'));
      return result;
    };
  }

  let editorState=null;
  let thumbUrls=[];

  function editor(){return byId('chatAttachmentEditorModal');}
  function currentItem(){return editorState?.items?.[editorState.index]||null;}
  function revokeThumbs(){thumbUrls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});thumbUrls=[];}

  function ensureEditor(){
    if(editor()) return editor();
    const modal=document.createElement('div');
    modal.id='chatAttachmentEditorModal';
    modal.className='modal hidden chat-attachment-editor-modal';
    modal.innerHTML=`<div class="modal-content chat-attachment-editor-content" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div class="chat-media-editor-head">
        <div class="media-editor-title"><i class="fa-solid fa-image"></i><h3>Edit photo</h3></div>
        <button type="button" class="chat-media-editor-close" onclick="closeChatAttachmentEditor(false)" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="chat-media-editor-tools" role="toolbar" aria-label="Photo editing tools">
        <button type="button" class="chat-media-tool active" data-editor-tool="draw" onclick="setChatImageEditorTool('draw',this)" title="Draw" aria-label="Draw"><i class="fa-solid fa-pencil"></i></button>
        <button type="button" class="chat-media-tool" data-editor-tool="highlight" onclick="setChatImageEditorTool('highlight',this)" title="Highlight" aria-label="Highlight"><i class="fa-solid fa-highlighter"></i></button>
        <button type="button" class="chat-media-tool" data-editor-tool="crop" onclick="setChatImageEditorTool('crop',this)" title="Crop" aria-label="Crop"><i class="fa-solid fa-crop-simple"></i></button>
        <button type="button" class="chat-media-tool" onclick="rotateChatImageEditor()" title="Rotate" aria-label="Rotate"><i class="fa-solid fa-rotate-right"></i></button>
        <button type="button" class="chat-media-tool" onclick="resetChatImageEditor()" title="Reset current photo" aria-label="Reset current photo"><i class="fa-solid fa-arrow-rotate-left"></i></button>
      </div>
      <div class="chat-media-editor-stage">
        <div class="chat-attachment-canvas-wrap">
          <canvas id="chatAttachmentEditorCanvas"></canvas>
          <div class="chat-media-nav"><button type="button" onclick="changeChatEditorImage(-1)" aria-label="Previous photo"><i class="fa-solid fa-chevron-left"></i></button><button type="button" onclick="changeChatEditorImage(1)" aria-label="Next photo"><i class="fa-solid fa-chevron-right"></i></button></div>
          <span class="chat-media-count" id="chatAttachmentEditorCount"></span>
        </div>
        <div class="chat-media-thumbs" id="chatAttachmentEditorThumbs" aria-label="Selected photos"></div>
      </div>
      <label class="chat-media-caption"><span>Caption</span><textarea id="chatAttachmentCaption" rows="2" maxlength="500" placeholder="Add a caption…"></textarea></label>
      <div class="chat-media-editor-footer"><span id="chatAttachmentEditorStatus" class="muted"></span><div class="media-editor-actions"><button type="button" class="btn btn-sm btn-outline" onclick="closeChatAttachmentEditor(false)">Cancel</button><button type="button" class="btn btn-sm" onclick="saveChatAttachmentEditor()"><i class="fa-solid fa-check"></i> Use photo</button></div></div>
    </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function loadSource(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        try{
          const max=2400, scale=Math.min(1,max/img.width,max/img.height);
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          URL.revokeObjectURL(url); resolve({file,sourceCanvas:c,strokes:[],crop:null,previewUrl:URL.createObjectURL(file)});
        }catch(e){URL.revokeObjectURL(url);reject(e)}
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(`Could not open ${file.name}.`));};
      img.src=url;
    });
  }

  function fitCanvas(){
    const st=editorState, item=currentItem(), canvas=byId('chatAttachmentEditorCanvas');
    if(!st||!item||!canvas)return;
    const wrap=canvas.parentElement;
    const maxW=Math.max(240,Math.min(760,(wrap?.clientWidth||760)-4));
    const maxH=Math.max(210,Math.min(620,window.innerHeight*.52));
    const scale=Math.min(1,maxW/item.sourceCanvas.width,maxH/item.sourceCanvas.height);
    canvas.width=Math.max(1,Math.round(item.sourceCanvas.width*scale));
    canvas.height=Math.max(1,Math.round(item.sourceCanvas.height*scale));
    canvas.style.width=canvas.width+'px'; canvas.style.height=canvas.height+'px';
    st.renderScale=scale;
  }

  function renderEditor(){
    const st=editorState,item=currentItem(),canvas=byId('chatAttachmentEditorCanvas'); if(!st||!item||!canvas)return;
    fitCanvas();
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(item.sourceCanvas,0,0,canvas.width,canvas.height);
    item.strokes.forEach(s=>{ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.globalAlpha=s.alpha||1;ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();});
    if(st.tool==='crop' && !(item.crop?.w>1 && item.crop?.h>1)){
      const guide=Math.max(40,Math.min(canvas.width,canvas.height)*.78);
      const gx=(canvas.width-guide)/2, gy=(canvas.height-guide)/2;
      ctx.save();
      ctx.fillStyle='rgba(0,0,0,.32)';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.clearRect(gx,gy,guide,guide);ctx.drawImage(item.sourceCanvas,0,0,canvas.width,canvas.height);
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(gx,gy,guide,guide);
      ctx.setLineDash([]);ctx.fillStyle='#fff';
      [[gx,gy],[gx+guide,gy],[gx,gy+guide],[gx+guide,gy+guide]].forEach(([x,y])=>ctx.fillRect(x-4,y-4,8,8));
      ctx.restore();
    }
    if(item.crop?.w>1 && item.crop?.h>1){
      const c=item.crop;
      ctx.save();ctx.fillStyle='rgba(0,0,0,.48)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.clearRect(c.x,c.y,c.w,c.h);ctx.drawImage(item.sourceCanvas,0,0,canvas.width,canvas.height);
      item.strokes.forEach(s=>{ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.globalAlpha=s.alpha||1;ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();});
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(c.x,c.y,c.w,c.h);ctx.restore();
    }
    const count=byId('chatAttachmentEditorCount'); if(count)count.textContent=st.items.length>1?`${st.index+1} / ${st.items.length}`:'';
    const status=byId('chatAttachmentEditorStatus'); if(status)status.textContent=st.items.length>1?'Swipe or tap a thumbnail to edit another photo.':'';
    const thumbs=byId('chatAttachmentEditorThumbs');
    if(thumbs){thumbs.innerHTML=st.items.map((it,i)=>`<button type="button" class="chat-media-thumb ${i===st.index?'active':''}" onclick="setChatEditorImage(${i})" aria-label="Photo ${i+1}"><img src="${esc(it.previewUrl)}" alt="Photo ${i+1}"></button>`).join('');}
    document.querySelectorAll('#chatAttachmentEditorModal [data-editor-tool]').forEach(b=>b.classList.toggle('active',b.dataset.editorTool===st.tool));
    if(thumbs){const active=thumbs.querySelector('.active');active?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});}
  }

  function setChatEditorImage(index){
    if(!editorState?.items?.length)return;
    editorState.index=(index+editorState.items.length)%editorState.items.length;
    editorState.tool='draw';
    renderEditor();
  }
  window.setChatEditorImage=setChatEditorImage;
  window.changeChatEditorImage=function(delta){setChatEditorImage((editorState?.index||0)+delta)};

  window.ensureChatAttachmentEditor=ensureEditor;
  window.openChatAttachmentEditor=function(files,index,total,done){
    const modal=ensureEditor();
    const list=Array.isArray(files)?files:[files];
    Promise.all(list.map(loadSource)).then(items=>{
      revokeThumbs(); editorState={items,index:Math.max(0,Math.min(Number(index)||0,items.length-1)),tool:'draw'};
      byId('chatAttachmentCaption').value=''; modal.classList.remove('hidden');
      requestAnimationFrame(renderEditor);
      editorState.done=done;
    }).catch(err=>{showToast(err?.message||'Could not open the selected photos.','error');done?.(null)});
  };

  window.setChatImageEditorTool=function(tool,btn){
    if(!editorState)return; editorState.tool=tool;
    document.querySelectorAll('#chatAttachmentEditorModal [data-editor-tool]').forEach(b=>b.classList.toggle('active',b===btn||b.dataset.editorTool===tool));
    const canvas=byId('chatAttachmentEditorCanvas'); if(canvas)canvas.style.cursor=tool==='crop'?'crosshair':'crosshair';
  };

  window.rotateChatImageEditor=function(){
    const item=currentItem(); if(!item)return;
    const src=item.sourceCanvas,out=document.createElement('canvas'); out.width=src.height;out.height=src.width;
    const c=out.getContext('2d');c.translate(out.width/2,out.height/2);c.rotate(Math.PI/2);c.drawImage(src,-src.width/2,-src.height/2);
    item.sourceCanvas=out;item.strokes=[];item.crop=null;renderEditor();
  };
  window.resetChatImageEditor=function(){const item=currentItem();if(!item)return;item.strokes=[];item.crop=null;renderEditor()};

  window.saveChatAttachmentEditor=async function(){
    const st=editorState;if(!st?.items?.length)return;
    const caption=byId('chatAttachmentCaption')?.value?.trim()||'';
    const results=[];
    try{
      for(const item of st.items){
        const src=item.sourceCanvas, canvas=document.createElement('canvas');
        let sx=0,sy=0,sw=src.width,sh=src.height;
        /* Crop is stored in displayed-canvas coordinates, so convert back to source coordinates. */
        const scale=canvasDisplayScale(src); const crop=item.crop;
        if(crop?.w>1&&crop?.h>1){sx=Math.max(0,Math.round(crop.x/scale));sy=Math.max(0,Math.round(crop.y/scale));sw=Math.max(1,Math.min(src.width-sx,Math.round(crop.w/scale)));sh=Math.max(1,Math.min(src.height-sy,Math.round(crop.h/scale)));}
        canvas.width=sw;canvas.height=sh;
        const ctx=canvas.getContext('2d');ctx.drawImage(src,sx,sy,sw,sh,0,0,sw,sh);
        /* Repaint annotations into the same crop in source coordinates. */
        item.strokes.forEach(stroke=>{
          if(!stroke.points.length)return;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width/scale;ctx.globalAlpha=stroke.alpha||1;ctx.beginPath();stroke.points.forEach((p,i)=>{const x=p.x/scale-sx,y=p.y/scale-sy;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore();
        });
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare the photo.')),'image/jpeg',.92));
        results.push({blob,caption,name:item.file.name,type:'image/jpeg'});
      }
      const done=st.done; closeChatAttachmentEditor(true); done?.(results);
    }catch(err){showToast(err?.message||'Could not prepare the selected photos.','error');}
  };
  function canvasDisplayScale(src){
    const canvas=byId('chatAttachmentEditorCanvas');
    if(!canvas||!src)return 1;
    return canvas.width/src.width||1;
  }
  window.closeChatAttachmentEditor=function(keep){
    const modal=editor();if(modal)modal.classList.add('hidden');
    if(!keep){const done=editorState?.done;editorState=null;revokeThumbs();if(done)done(null)}
    else{editorState=null;revokeThumbs()}
  };

  /* Fresh pointer binding: draw/highlight work directly on the stable canvas and crop is always square. */
  function bindPointer(){
    const canvas=byId('chatAttachmentEditorCanvas'); if(!canvas||canvas.dataset.mediaEditorBound==='1')return;
    canvas.dataset.mediaEditorBound='1'; let drawing=false,points=[],start=null;
    const pos=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)}};
    canvas.addEventListener('pointerdown',e=>{const st=editorState;if(!st)return;e.preventDefault();canvas.setPointerCapture?.(e.pointerId);const p=pos(e);const item=currentItem();
      if(st.tool==='crop'){start=p;item.crop={x:p.x,y:p.y,w:0,h:0};}
      else{drawing=true;points=[p];item.strokes.push({color:st.tool==='highlight'?'#ffe04a':'#ff3040',width:st.tool==='highlight'?22:4,alpha:st.tool==='highlight'?.42:1,points});}
      renderEditor();
    });
    canvas.addEventListener('pointermove',e=>{const st=editorState;if(!st)return;const item=currentItem(),p=pos(e);
      if(st.tool==='crop'&&start){const dx=p.x-start.x,dy=p.y-start.y;const size=Math.min(Math.abs(dx),Math.abs(dy));const sx=dx<0?-1:1,sy=dy<0?-1:1;item.crop={x:sx<0?start.x-size:start.x,y:sy<0?start.y-size:start.y,w:size,h:size};renderEditor();}
      else if(drawing){points.push(p);renderEditor();}
    });
    const end=()=>{drawing=false;points=[];start=null};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('pointerleave',()=>{if(drawing){} });
  }
  const oldEnsure=window.ensureChatAttachmentEditor;
  window.ensureChatAttachmentEditor=function(){const m=oldEnsure();setTimeout(bindPointer,0);return m};
  window.addEventListener('resize',()=>{if(editorState)renderEditor()},{passive:true});

  window.handleChatFileSelected=function(evt,conversationId){
    const files=[...(evt.target.files||[])];evt.target.value='';if(!files.length)return;
    const valid=files.filter(f=>String(f.type||'').startsWith('image/')&&f.size<=MAX_ATTACHMENT_BYTES);
    if(!valid.length){showToast('Choose one or more images up to 10MB each.','error');return;}
    if(valid.length<files.length)showToast('Some files were skipped because they are not images or are over 10MB.','info');
    const finish=(results)=>{
      if(!results?.length)return;
      (async()=>{try{
        const input=byId('chatInput');clearTimeout(typingStopTimer);publishChatTyping(false);const replyToId=chatReplyTarget?.id||null;const snap=chatReplyTarget?{...chatReplyTarget}:null;resetChatInput(input);
        const groupId=results.length>1?`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`:null;
        for(const item of results) await sendPreparedChatImage(conversationId,item,replyToId,snap,groupId);
        chatReplyTarget=null;renderChatReplyPreview();scrollChatToBottom();const root=byId('chatMessages');resolveVisibleAttachments(root);groupChatMediaMessages(root);setupMessageInteractions(root);showToast(`${results.length} photo${results.length===1?'':'s'} sent.`,'success');
      }catch(err){showToast(err?.message||'Could not send those photos.','error')}})();
    };
    ensureEditor();openChatAttachmentEditor(valid,0,valid.length,finish);setTimeout(bindPointer,0);
  };
  // Snapshot this version (array-based, grouped multi-photo send) so it can
  // be restored later even if something further down the file reassigns
  // window.handleChatFileSelected again -- see the restoration at the end
  // of the file, which pairs with this rather than the older single-file
  // handleChatFileSelected()/openChatAttachmentEditor() from earlier in the
  // file (that pairing is no longer compatible with the array-based
  // window.openChatAttachmentEditor defined in this same block).
  window.__handleChatFileSelectedGrouped = window.handleChatFileSelected;

  const originalSendPrepared=window.sendPreparedChatImage;
  window.sendPreparedChatImage=async function(conversationId,prepared,replyToId,replyTargetSnapshot,groupId){
    if(!groupId)return originalSendPrepared(conversationId,prepared,replyToId,replyTargetSnapshot);
    const path=`conv/${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${sanitizeFilename(prepared.name||'photo.jpg')}`;
    let uploadBlob=prepared.blob;
    try{if(typeof window.compressImage==="function")uploadBlob=await window.compressImage(prepared.blob,{maxWidth:1600,maxHeight:1600});}catch(_){}
    const {error:upErr}=await sb.storage.from('chat-attachments').upload(path,uploadBlob,{contentType:uploadBlob.type||'image/jpeg',upsert:false,cacheControl:"31536000"});if(upErr)throw upErr;
    const markedName=`${GROUP_PREFIX}${groupId}__|${prepared.name||'photo.jpg'}`;
    const {data,error}=await sb.from('messages').insert({conversation_id:conversationId,sender_id:session.user.id,body:prepared.caption||'',reply_to_id:replyToId,attachment_url:path,attachment_name:markedName,attachment_type:uploadBlob.type||'image/jpeg',attachment_size:uploadBlob.size}).select('*').single();if(error)throw error;
    if(replyTargetSnapshot)data.reply_to={id:replyTargetSnapshot.id,body:replyTargetSnapshot.body,attachment_name:replyTargetSnapshot.attachment,sender_id:document.querySelector(`.chat-bubble[data-msg-id="${replyTargetSnapshot.id}"]`)?.classList.contains('mine')?session.user.id:''};
    byId('chatMessages')?.insertAdjacentHTML('beforeend',chatBubbleHtml(data));
  };

  /* Existing chats and realtime inserts can contain grouped markers. */
  const patchGrouping=()=>groupChatMediaMessages(byId('chatMessages'));
  window.addEventListener('load',()=>setTimeout(patchGrouping,80),{once:true});
})();

/* ---- levromart-final-source-of-truth-20260911 ---- */
(function(){
  'use strict';
  const SEARCH_KEY='levromart-search-history-v1', MAX_SEARCHES=8;
  const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const readHistory=()=>{try{const x=JSON.parse(localStorage.getItem(SEARCH_KEY)||'[]');return Array.isArray(x)?x.map(String).map(x=>x.trim()).filter(Boolean).slice(0,MAX_SEARCHES):[]}catch(_){return[]}};
  const writeHistory=q=>{q=String(q||'').trim();if(!q)return;try{localStorage.setItem(SEARCH_KEY,JSON.stringify([q,...readHistory().filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,MAX_SEARCHES)))}catch(_){} };
  const removeHistory=q=>{try{localStorage.setItem(SEARCH_KEY,JSON.stringify(readHistory().filter(x=>x.toLowerCase()!==String(q).toLowerCase())))}catch(_){} };
  const clearHistory=()=>{try{localStorage.removeItem(SEARCH_KEY)}catch(_){} };
  function bindTopButton(){
    const b=document.getElementById('levromartHeaderSearchButton');
    if(b) b.onclick=window.__levroTopSearch;
  }

  // Follow/unfollow is instant; no confirmation dialog.
  async function followState(vendorId){try{const r=await sb.rpc('get_vendor_follow_state',{p_vendor_id:vendorId});return r.error?null:r.data?.[0]||null}catch(_){return null}}
  // Fetching the current state, awaiting the toggle RPC, then fetching the
  // new state again (three sequential round trips) before the button ever
  // visibly changed meant a tap did nothing for a beat -- long enough that
  // a second tap landed before the first had rendered, flipping it right
  // back. Flip the UI immediately from what's already on screen (which the
  // button itself already knows via aria-pressed), and only touch the
  // network for the actual toggle -- reverting just that optimistic update
  // if the RPC fails.
  function applyFollowUiState(wrap,following){
    const btn=wrap.querySelector('.follow-btn');
    if(btn){btn.classList.toggle('btn-outline',!following);btn.setAttribute('aria-pressed',following?'true':'false');btn.innerHTML='<i class="fa-solid '+(following?'fa-check':'fa-user-plus')+'"></i>';btn.title=following?'Following, tap to unfollow':'Follow vendor';}
    const bell=wrap.querySelector('.follow-settings-btn');
    if(bell){bell.disabled=!following;bell.title=following?'Notification preferences':'Follow this vendor to manage notifications';}
  }
  function bumpFollowCount(delta){
    const count=document.querySelector('[data-follow-count]');
    if(!count)return;
    const strongEl=count.querySelector('strong');
    const current=Number(String(strongEl?.textContent||'0').replace(/[^0-9]/g,''))||0;
    const next=Math.max(0,current+delta);
    count.innerHTML='<strong>'+next.toLocaleString()+'</strong> follower'+(next===1?'':'s');
  }
  async function toggleFollow(vendorId,ev){
    ev?.preventDefault?.();ev?.stopPropagation?.();
    if(!session){showLogin?.();return}
    const wrap=document.querySelector('.storefront-follow-wrap[data-follow-vendor-id="'+CSS.escape(String(vendorId))+'"]');
    if(!wrap)return;
    const btn=wrap.querySelector('.follow-btn');
    if(!btn||btn.disabled)return;
    const wasFollowing=btn.getAttribute('aria-pressed')==='true';
    const next=!wasFollowing;
    btn.disabled=true;
    applyFollowUiState(wrap,next);
    bumpFollowCount(next?1:-1);
    // A storefront's own background refresh can still be mid-flight from
    // before this tap, carrying a pre-click follow-state snapshot that
    // would otherwise land moments later and silently flip this back --
    // the exact "twitching"/needs-two-taps bug. Recording the action here
    // lets that in-flight hydration defer to it instead of overwriting it.
    window.__followRecentAction={vendorId:String(vendorId),following:next,at:Date.now()};
    window.rememberVendorFollow?.(vendorId,next);
    try{
      const r=await levroData.follows.set(vendorId,next);
      if(r.error)throw r.error;
      /* New follows use LevroMart's recommended notification level by default. */
      if(next) await saveFollowPrefsFromWrap(wrap,'none','relevant',true);
      /* follow/unfollow: no toast, the button already shows the state */
    }catch(e){
      window.__followRecentAction=null;
      window.rememberVendorFollow?.(vendorId,wasFollowing);
      applyFollowUiState(wrap,wasFollowing);
      bumpFollowCount(wasFollowing?1:-1);
      showToast?.(e.message||'Could not update your following list.','error')
    }finally{btn.disabled=false}
  }
  async function refreshFollow(vendorId){const wrap=document.querySelector('.storefront-follow-wrap[data-follow-vendor-id="'+CSS.escape(String(vendorId))+'"]');if(!wrap)return;let st=await followState(vendorId);if(st)window.rememberVendorFollow?.(vendorId,!!st.following);else st={following:!!window.followedVendorSet?.().has(String(vendorId)),mute_mode:'none'};const following=!!st.following;const btn=wrap.querySelector('.follow-btn'),bell=wrap.querySelector('.follow-settings-btn');if(btn){btn.classList.toggle('btn-outline',!following);btn.setAttribute('aria-pressed',following?'true':'false');btn.innerHTML='<i class="fa-solid '+(following?'fa-check':'fa-user-plus')+'"></i><span class="follow-btn-label">'+(following?'Following':'Follow')+'</span>';btn.title=following?'Following, tap to unfollow':'Follow vendor'}if(bell){bell.disabled=!following;bell.title=following?'Notification preferences':'Follow this vendor to manage notifications'}const mode=storefrontFollowNotificationMode(st);document.querySelectorAll('.follow-mode-row[data-notify-mode]').forEach(b=>{const active=b.closest('.follow-menu')?.dataset.followSheetVendorId===String(vendorId) && b.dataset.notifyMode===mode;if(b.closest('.follow-menu')?.dataset.followSheetVendorId===String(vendorId))b.setAttribute('aria-pressed',active?'true':'false')});const count=document.querySelector('[data-follow-count]');if(count&&st.follower_count!=null){const n=Number(st.follower_count||0);count.innerHTML='<strong>'+n.toLocaleString()+'</strong> follower'+(n===1?'':'s')}}
  async function toggleFollowBell(vendorId,ev){
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    const selector='.storefront-follow-wrap[data-follow-vendor-id="'+CSS.escape(String(vendorId))+'"]';
    const wrap=document.querySelector(selector);
    const bell=wrap?.querySelector('.follow-settings-btn');
    if(!bell || bell.disabled || !wrap)return;
    const menu=wrap.querySelector('.follow-menu');
    if(!menu)return;
    const alreadyOpen=menu.classList.contains('is-sheet-open');
    document.querySelectorAll('.storefront-follow-wrap').forEach(w=>{
      if(w!==wrap)window.closeStorefrontFollowSheet?.(w);
    });
    if(alreadyOpen){
      window.closeStorefrontFollowSheet(wrap);
      return;
    }

    let backdrop=document.querySelector('.follow-sheet-backdrop');
    if(backdrop)backdrop.remove();
    backdrop=document.createElement('div');
    backdrop.className='follow-sheet-backdrop';
    backdrop.setAttribute('aria-hidden','true');
    backdrop.addEventListener('click',()=>window.closeStorefrontFollowSheet(wrap));
    document.body.appendChild(backdrop);

    if(menu.__followSheetCloseTimer)clearTimeout(menu.__followSheetCloseTimer);
    menu.__followSheetCloseTimer=null;
    menu.__followSheetOwner=wrap;
    menu.dataset.followSheetVendorId=String(vendorId);
    document.body.appendChild(menu);
    menu.classList.remove('hidden');
    menu.classList.add('is-sheet-open');
    menu.setAttribute('aria-hidden','false');
    menu.scrollTop=0;
    bell.setAttribute('aria-expanded','true');
    followSheetSetBodyLock(true);
    wireStorefrontFollowSheetGesture(menu,wrap);

    await refreshFollow(vendorId);
  }
  window.toggleLevromartVendorFollow=toggleFollow;window.toggleLevromartFollowNotifications=toggleFollowBell;
  async function saveFollowPrefsFromWrap(wrap,muteModeOverride,modeOverride,silent){const id=wrap?.dataset.followVendorId;if(!id)return;const menu=wrap?.querySelector('.follow-menu[data-follow-sheet-vendor-id="'+CSS.escape(String(id))+'"]') || document.querySelector('.follow-menu[data-follow-sheet-vendor-id="'+CSS.escape(String(id))+'"]') || wrap?.querySelector('.follow-menu'); const mode=modeOverride||menu?.querySelector('.follow-mode-row[aria-pressed="true"]')?.dataset.notifyMode||'relevant';const prefs={all:{notify_new_listing:true,notify_new_service:true,notify_new_package:true,notify_new_variety:true,notify_price_change:true,notify_discount:true,mute:'none'},relevant:{notify_new_listing:true,notify_new_service:true,notify_new_package:true,notify_new_variety:false,notify_price_change:false,notify_discount:false,mute:'none'},off:{notify_new_listing:false,notify_new_service:false,notify_new_package:false,notify_new_variety:false,notify_price_change:false,notify_discount:false,mute:'always'}}[mode]||null;if(!prefs)return;const muteMode=muteModeOverride||prefs.mute;try{const r=await sb.rpc('set_vendor_follow_preferences',{p_vendor_id:id,p_mute_mode:muteMode,p_notify_new_listing:prefs.notify_new_listing,p_notify_new_service:prefs.notify_new_service,p_notify_new_package:prefs.notify_new_package,p_notify_new_variety:prefs.notify_new_variety,p_notify_price_change:prefs.notify_price_change,p_notify_discount:prefs.notify_discount});if(r.error)throw r.error;menu?.querySelectorAll('.follow-mode-row').forEach(b=>b.setAttribute('aria-pressed',b.dataset.notifyMode===mode?'true':'false'));if(!silent)showToast?.(mode==='all'?'All vendor notifications are on.':mode==='off'?'Vendor notifications are off.':'Most relevant vendor notifications are on.','success');}catch(e){showToast?.(e.message||'Could not update vendor notifications.','error')}}
document.addEventListener('click',e=>{const b=e.target?.closest?.('.follow-mode-row[data-notify-mode]');if(!b)return;e.preventDefault();e.stopPropagation();const menu=b.closest('.follow-menu');const vendorId=menu?.dataset.followSheetVendorId;const wrap=vendorId?document.querySelector('.storefront-follow-wrap[data-follow-vendor-id="'+CSS.escape(String(vendorId))+'"]'):null;if(!wrap)return;saveFollowPrefsFromWrap(wrap,null,b.dataset.notifyMode,false);},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('.storefront-follow-wrap') || e.target.closest?.('.follow-menu') || e.target.closest?.('.follow-sheet-backdrop'))return;document.querySelectorAll('.storefront-follow-wrap').forEach(w=>closeStorefrontFollowSheet(w));},true);

  // Follower list for the shop owner.
  window.showVendorFollowers=async function(vendorId){if(!session)return;navigate('vendorFollowers');return;let modal=document.getElementById('vendorFollowersModal');if(!modal){modal=document.createElement('div');modal.id='vendorFollowersModal';modal.className='modal hidden';document.body.appendChild(modal)}modal.innerHTML='<div class="modal-content" style="max-width:480px"><div class="flex" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Followers</h3><button class="icon-btn" type="button" aria-label="Close" onclick="document.getElementById(\'vendorFollowersModal\').classList.add(\'hidden\')"><i class="fa-solid fa-xmark"></i></button></div><div class="followers-modal-list"><p class="muted">Loading followers…</p></div></div>';modal.classList.remove('hidden');try{const r=await sb.rpc('get_vendor_followers',{p_vendor_id:vendorId});if(r.error)throw r.error;const list=r.data||[];modal.querySelector('.followers-modal-list').innerHTML=list.length?list.map(x=>'<div class="follower-row">'+(x.avatar_url?'<img src="'+escHtml(x.avatar_url)+'" alt="">':'<div class="follower-avatar avatar-circle">'+escHtml((x.name||'U').charAt(0).toUpperCase())+'</div>')+'<div class="follower-copy"><strong>'+escHtml(x.name||'Levromart user')+'</strong><small>Following since '+new Date(x.followed_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+'</small></div></div>').join(''):'<p class="muted">No followers yet.</p>'}catch(e){modal.querySelector('.followers-modal-list').innerHTML='<p class="muted">Could not load followers.</p>'}}
  function makeFollowerStatClickable(){const stat=document.querySelector('[data-follow-count]');const wrap=document.querySelector('.storefront-follow-wrap');const own=document.querySelector('.storefront-profile')?.dataset.ownStorefront==='1';if(!stat||(!wrap&&!own))return;const id=wrap?.dataset.followVendorId||currentViewParams?.vendorId;if(!id)return;if(own){stat.classList.add('storefront-follow-count-button');stat.setAttribute('role','button');stat.setAttribute('tabindex','0');stat.setAttribute('aria-label','View followers');stat.title='View your followers';stat.onclick=()=>showVendorFollowers(id);stat.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showVendorFollowers(id)}}}else{stat.classList.remove('storefront-follow-count-button');stat.onclick=null;stat.onkeydown=null}}

  // Commission deadline/countdown: vendors may pay at any time during the 7-day window.
  async function loadCommissionDeadline(){if(!vendor?.id||typeof sb==='undefined')return null;try{const r=await sb.rpc('get_vendor_commission_deadline',{p_vendor_id:vendor.id});if(!r.error&&r.data?.[0])return r.data[0]}catch(_){}try{const r=await sb.from('commission_charges').select('amount,due_at').eq('vendor_id',vendor.id).eq('status','owed').order('due_at',{ascending:true});if(r.error)return null;const rows=r.data||[];return {total_owed:rows.reduce((s,x)=>s+Number(x.amount||0),0),earliest_due_at:rows[0]?.due_at||null}}catch(_){return null}}
  function renderCountdown(el,due){if(!el)return;const t=new Date(due).getTime()-Date.now();if(t<=0){el.textContent='Due now';return}const d=Math.floor(t/86400000),h=Math.floor((t%86400000)/3600000),m=Math.floor((t%3600000)/60000);el.textContent=d?d+'d '+h+'h left':h?h+'h '+m+'m left':m+'m left'}
  async function decorateCommissionBoxes(){
    const data=await loadCommissionDeadline();
    document.querySelectorAll('.banner').forEach(box=>{
      const h=box.querySelector('h3');if(!h||!/^\s*Commission owed:/i.test(h.textContent||''))return;
      if(!box.querySelector('.levro-commission-deadline')){
        const info=document.createElement('button');info.type='button';info.className='vendor-commission-info';info.title='About commission';info.setAttribute('aria-label','About commission');info.innerHTML='<i class="fa-solid fa-info"></i>';info.onclick=window.levroCommissionInfo;
        h.appendChild(info);
        const p=box.querySelector('p');if(p)p.innerHTML='<strong>Pay anytime within 7 days.</strong> Levromart takes the platform commission only from commission-based listings.';
        const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin:.2rem 0 .65rem;font-size:.76rem';row.innerHTML='<span><i class="fa-regular fa-clock"></i> Payment window</span><span class="vendor-commission-countdown levro-commission-deadline">Calculating…</span>';h.parentElement.insertBefore(row,p?.nextSibling||null);
      }
    });
    if(data?.earliest_due_at){clearInterval(window.__levroCommissionTimer);const tick=()=>document.querySelectorAll('.levro-commission-deadline').forEach(el=>renderCountdown(el,data.earliest_due_at));tick();window.__levroCommissionTimer=setInterval(tick,30000)}
  }
  window.levroCommissionInfo=function(){showToast?.('Commission is charged only on commission-based listings and is due within 7 days of the offline sale. You can pay it at any time before the deadline.','info')}

  // Unified My Shop listings page: products, services and packages in one screen.
  window.payListingDraft=async function(draftId){if(!session?.access_token)return false;try{const r=await fetch('/api/vendor-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare-listing-payment',draftId,accessToken:session.access_token})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.authorization_url)throw new Error(d.error||'Could not start the ₦999 payment.');window.location.assign(d.authorization_url);return true}catch(e){showToast?.(e.message||'Could not start payment.','error');return false}}
  window.saveListingDraftServer=async function(draft){if(!session?.access_token)return null;try{const r=await fetch('/api/vendor-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save-listing-draft',kind:draft.kind,draft,accessToken:session.access_token})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not save draft.');return d}catch(e){showToast?.(e.message||'Could not save draft.','error');return null}}
  window.deleteListingDraft=async function(id){if(!session?.access_token)return;try{const r=await fetch('/api/vendor-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete-listing-draft',draftId:id,accessToken:session.access_token})});if(!r.ok)throw new Error((await r.json()).error||'Could not delete draft.');navigate('vendorProducts',{},false)}catch(e){showToast?.(e.message,'error')}}
  window.saveProductAsDraft=async function(){if(!byId('prodIsService')||byId('prodIsService').checked||byId('prodBillingModel')?.value!=='monthly'){showToast?.('Drafts are available for monthly product listings.','info');return}const btn=byId('saveProductDraftBtn');if(btn)btn.disabled=true;try{const name=byId('prodName').value.trim();if(!name)throw new Error('Product name is required.');const newFiles=[...(window.__newProductPhotoFiles||[])];const urls=[];for(const file of newFiles){const ext=(file.name.split('.').pop()||'jpg').toLowerCase(),path='product-photos/'+vendor.id+'/'+crypto.randomUUID()+'.'+ext;let uploadBlob=file;try{if(typeof window.compressImage==="function")uploadBlob=await window.compressImage(file,{maxWidth:1600,maxHeight:1600});}catch(_){}urls.push(await uploadToR2(uploadBlob,path,uploadBlob.type||file.type))}const draft={kind:'product',vendor_id:vendor.id,fields:{name,description:stripProductVariantMeta(byId('prodDesc').value.trim())||null,category_id:byId('prodCategory').value||null,condition:byId('prodCondition').value,listing_type:byId('prodListingType').value,is_service:false,service_price_unit:null,sale_price:byId('prodSalePrice').value?Number(byId('prodSalePrice').value):null,discount_price:byId('prodDiscountPrice').value?Number(byId('prodDiscountPrice').value):null,delivery_fee_mode:byId('prodDeliveryMode').value||'free',delivery_fee:Number(byId('prodDeliveryFee').value)||0,delivery_fee_per_km:Number(byId('prodDeliveryPerKm').value)||0,payment_timing:byId('prodPaymentTiming')?.value==='pay_after'?'pay_after':'pay_before',payment_deposit_percent:Math.max(1,Math.min(99,Number(byId('prodPaymentDepositPercent')?.value||20))),rental_rate:byId('prodRentalRate').value?Number(byId('prodRentalRate').value):null,rental_rate_unit:byId('prodRateUnit').value,deposit_amount:byId('prodDeposit').value?Number(byId('prodDeposit').value):null,quantity_total:parseInt(byId('prodQtyTotal').value)||1,billing_model:'monthly'},photos:[...(window.__existingPhotos||[]),...urls],variantDrafts:collectProductVariantDrafts([...(window.__existingPhotos||[]),...urls])};const saved=await saveListingDraftServer(draft);if(!saved?.id)throw new Error(saved?.error||'Could not save draft.');showToast?.('Draft saved. You can pay the ₦999 activation fee later from My Shop.','success');closeProductModal?.();navigate('vendorProducts',{},false)}catch(e){byId('productError').textContent=e.message;byId('productError').classList.remove('hidden')}finally{if(btn)btn.disabled=false}}
  async function renderUnifiedEnhancements(){
    const heading=document.querySelector('.vl-head');
    if(!heading)return;
    if(!document.querySelector('.vl-tabs')){
      const rail=document.createElement('div');rail.className='vendor-products-unified-tabs';
      rail.innerHTML='<button data-tab="all" onclick="switchVendorListingTab(\'all\')">All listings</button><button data-tab="products" onclick="switchVendorListingTab(\'products\')">Products</button><button data-tab="services" onclick="switchVendorListingTab(\'services\')">Services</button><button data-tab="packages" onclick="switchVendorListingTab(\'packages\')">Packages</button>';
      heading.insertAdjacentElement('afterend',rail);
    }
    const host=heading.parentElement;
    if(host&&!document.querySelector('.vendor-drafts-panel')&&session?.access_token){
      try{
        const r=await fetch('/api/vendor-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list-listing-drafts',accessToken:session.access_token})});
        const d=await r.json().catch(()=>({}));const drafts=d.drafts||[];
        if(drafts.length){
          const panel=document.createElement('div');panel.className='vendor-drafts-panel';
          panel.innerHTML='<div class="vendor-drafts-head"><strong><i class="fa-solid fa-file-lines"></i> Drafts ('+drafts.length+')</strong><span class="muted" style="font-size:.72rem">Unpaid monthly listings</span></div>'+drafts.map(x=>'<div class="vendor-draft-card"><div class="vendor-draft-copy"><strong>'+escHtml(x.draft_data?.fields?.name||'Untitled listing')+'</strong><small>₦999 activation · saved '+new Date(x.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</small></div><div class="vendor-draft-actions"><button class="btn btn-sm" onclick="payListingDraft(\''+escHtml(x.id)+'\')">Pay ₦999</button><button class="btn btn-sm btn-outline" onclick="deleteListingDraft(\''+escHtml(x.id)+'\')" aria-label="Delete draft"><i class="fa-solid fa-trash"></i></button></div></div>').join('');
          heading.insertAdjacentElement('afterend',panel);
        }
      }catch(_){ }
    }
    // Tag every product/service card and its grid so the unified rail can filter cleanly.
    document.querySelectorAll('.vl-grid .vl-card').forEach(card=>{
      if(card.dataset.vendorListingKind)return;
      card.dataset.vendorListingKind=card.dataset.vpKind||'products';
    });
    document.querySelectorAll('.vl-grid').forEach(g=>{delete g.dataset.vendorListingSection;});
    // Package state is loaded by the route renderer.
    const remembered=(()=>{try{return localStorage.getItem('levromart-vendor-listing-tab')||'products'}catch(_){return'all'}})();
    window.switchVendorListingTab(remembered);
    decorateCommissionBoxes();
  }

  function patchVendorProductsMarkup(){const btn=byId('saveProductDraftBtn'),sel=byId('prodBillingModel'),service=byId('prodIsService');if(btn){const show=false;btn.classList.toggle('hidden',true)} }
  document.addEventListener('change',e=>{if(e.target?.id==='prodBillingModel'||e.target?.id==='prodIsService')patchVendorProductsMarkup()},true);
  const observer=new MutationObserver(()=>{clearTimeout(window.__levroFinalUxTimer2);window.__levroFinalUxTimer2=setTimeout(()=>{bindTopButton();patchVendorProductsMarkup();renderUnifiedEnhancements()},120)});observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>{bindTopButton();patchVendorProductsMarkup();renderUnifiedEnhancements()},350);

  async function autoWarmBuyerLocation(){
    if(!navigator.geolocation||!locationSharingEnabled)return;
    try{const perm=await getBrowserLocationPermission();if(perm==='granted'&&!buyerLocation)await getCustomerLocation(true)}catch(_){ }
  }
  setTimeout(autoWarmBuyerLocation,500);

  // Add a Locate Me button to the vendor profile map.
  function addVendorMapLocate(){const map=byId('veLocationMap');if(!map||map.querySelector('.vendor-map-locate-control'))return;const b=document.createElement('button');b.type='button';b.className='vendor-map-locate-control';b.title='Use my current location';b.setAttribute('aria-label','Use my current location');b.innerHTML='<i class="fa-solid fa-location-crosshairs"></i>';b.onclick=()=>locateVendorMapOnly?.();map.appendChild(b)}
  new MutationObserver(addVendorMapLocate).observe(document.body,{childList:true,subtree:true});setTimeout(addVendorMapLocate,500);
})();

/* ---- levromart-phase1-commission-countdown-runtime ---- */
(function(){
  let lastVendorId="", refreshTimer=0, countdownTimer=0, running=false;
  function updateText(due){document.querySelectorAll('.levro-commission-deadline').forEach(el=>{if(!due){el.textContent='No active deadline';return;}const ms=new Date(due).getTime()-Date.now();if(ms<=0){el.textContent='Due now';return;}const days=Math.floor(ms/86400000),hours=Math.floor((ms%86400000)/3600000);el.textContent=days?days+'d '+hours+'h left':hours?hours+'h left':'Less than 1h left';});}
  async function refresh(){
    if(running||typeof sb==='undefined'||typeof vendor==='undefined'||!vendor?.id)return;
    const els=[...document.querySelectorAll('.levro-commission-deadline')]; if(!els.length)return;
    running=true; const id=String(vendor.id); lastVendorId=id;
    try{
      let data=null;
      try{const r=await sb.rpc('get_vendor_commission_deadline',{p_vendor_id:vendor.id});if(!r.error&&r.data?.[0])data=r.data[0]}catch(_){}
      if(!data?.earliest_due_at){
        try{const r=await sb.from('commission_charges').select('due_at').eq('vendor_id',vendor.id).eq('status','owed').not('due_at','is',null).order('due_at',{ascending:true}).limit(1);if(!r.error&&r.data?.[0])data={earliest_due_at:r.data[0].due_at}}catch(_){}
      }
      updateText(data?.earliest_due_at||null);
      clearInterval(countdownTimer); countdownTimer=setInterval(()=>updateText(data?.earliest_due_at||null),30000);
    }finally{running=false}
  }
  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,120);}
  const app=document.getElementById('app');
  if(app)new MutationObserver(records=>{if(records.some(r=>{const t=r.target;return !(t instanceof Element)||!t.closest?.('.levro-commission-deadline')}))schedule()}).observe(app,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);
  setTimeout(schedule,400);setTimeout(schedule,1200);setTimeout(schedule,2500);
  window.__levroRefreshCommissionCountdowns=refresh;
})();

/* ---- levromart-variety-indicator-browse-sync-20260913 ---- */
(function(){
  let queued=false;
  function sync(){
    queued=false;
    try{ if(typeof hydrateProductVariantIndicatorsInView==='function') hydrateProductVariantIndicatorsInView(); }catch(_){}
  }
  function queue(){if(queued)return;queued=true;requestAnimationFrame(sync)}
  document.addEventListener('levromart:view-rendered',queue);
  const root=document.getElementById('app');
  if(root)new MutationObserver(queue).observe(root,{childList:true,subtree:true});
  window.addEventListener('load',queue,{once:true});
})();

/* ---- levromart-review-prompt-20260917 ---- */
(function(){
  "use strict";
  let promptBusy=false;
  window.__reviewPromptDismissedOrderId=null;
  const REVIEW_DISMISS_KEY='levromart_review_prompt_dismissed_v1';
  const REVIEW_COMPLETED_KEY='levromart_review_completed_v1';
  function dismissed(orderId){try{return JSON.parse(localStorage.getItem(REVIEW_DISMISS_KEY)||'[]').includes(String(orderId));}catch(_){return false;}}
  function reviewCompletedLocally(orderId){try{return JSON.parse(localStorage.getItem(REVIEW_COMPLETED_KEY)||'[]').includes(String(orderId));}catch(_){return false;}}
  function rememberDismissed(orderId){try{const a=JSON.parse(localStorage.getItem(REVIEW_DISMISS_KEY)||'[]');const id=String(orderId);if(!a.includes(id)){a.push(id);localStorage.setItem(REVIEW_DISMISS_KEY,JSON.stringify(a.slice(-100)));}}catch(_){} }
  function rememberReviewCompleted(orderId){try{const a=JSON.parse(localStorage.getItem(REVIEW_COMPLETED_KEY)||'[]');const id=String(orderId);if(!a.includes(id)){a.push(id);localStorage.setItem(REVIEW_COMPLETED_KEY,JSON.stringify(a.slice(-250)));}}catch(_){} }
  function closePrompt(){document.getElementById('levroReviewPromptModal')?.remove();}
  window.__closeLevromartReviewPrompt=closePrompt;
  const SNOOZE_KEY='levromart_review_snooze_v2';
  const SNOOZE_MS=12*3600*1000, MAX_SNOOZES=3, RECENT_MS=14*24*3600*1000;
  function snoozeMap(){try{return JSON.parse(localStorage.getItem(SNOOZE_KEY)||'{}')||{};}catch(_){return {};}}
  function snoozed(orderId){const s=snoozeMap()[String(orderId)];return !!s&&(s.n>=MAX_SNOOZES||Date.now()-s.at<SNOOZE_MS);}
  function snooze(orderId){try{const m=snoozeMap(),id=String(orderId);m[id]={at:Date.now(),n:(m[id]?.n||0)+1};const keys=Object.keys(m);if(keys.length>100)delete m[keys[0]];localStorage.setItem(SNOOZE_KEY,JSON.stringify(m));}catch(_){} }
  // One review per completed order: every delivery gets its own prompt until it has a review.
  async function findEligibleReview(){
    if(!session?.user?.id || profile?.role==='admin') return null;
    const {data:orders,error}=await sb.from('orders').select('id,vendor_id,completed_at,status_changed_at,created_at,order_type,vendor:vendors(id,business_name,logo_url),items:order_items(product:products(name,photos)),payments(payment_type,status)').eq('buyer_id',session.user.id).eq('status','completed').order('created_at',{ascending:false}).limit(15);
    if(error||!orders?.length)return null;
    const when=(o)=>new Date(o.completed_at||o.status_changed_at||o.created_at||0).getTime();
    const candidates=orders.filter(o=>{const fee=o.order_type==='rental'?'rental_fee':'sale_price';return Date.now()-when(o)<RECENT_MS;}).filter(o=>!reviewCompletedLocally(o.id)&&!dismissed(o.id)&&!snoozed(o.id)).sort((a,b)=>when(b)-when(a));
    if(!candidates.length)return null;
    const {data:reviews,error:reviewsError}=await sb.from('reviews').select('order_id').eq('buyer_id',session.user.id).in('order_id',candidates.map(o=>o.id));
    if(reviewsError)return null;
    const reviewed=new Set((reviews||[]).map(r=>String(r.order_id)));
    candidates.filter(o=>reviewed.has(String(o.id))).forEach(o=>rememberReviewCompleted(o.id));
    return candidates.find(o=>!reviewed.has(String(o.id)))||null;
  }
  function showPrompt(order){
    if(!order||document.getElementById('levroReviewPromptModal')||window.__reviewPromptDismissedOrderId===String(order.id)||snoozed(order.id)||currentView==='leaveReview')return;
    const modal=document.createElement('div');modal.id='levroReviewPromptModal';modal.className='levro-review-prompt-backdrop';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','lrpTitle');
    const v=order.vendor||{},name=v.business_name||'this vendor';
    const item=(order.items||[]).map(i=>i.product?.name).filter(Boolean)[0]||'';
    const logo=v.logo_url?`<img class="lrp-logo" src="${esc(v.logo_url)}" alt="" decoding="async">`:avatarFallbackHtml(name,'3.6rem','lrp-logo',name);
    modal.innerHTML=`<div class="levro-review-prompt-card lrp-card">${logo}<div class="lrp-copy"><h2 id="lrpTitle">How was ${esc(name)}?</h2><p>Your order${item?` (${esc(item)})`:''} is complete. Tap a star to rate this delivery.</p></div>
      <div class="lrp-stars" role="radiogroup" aria-label="Rating">${[1,2,3,4,5].map(n=>`<button type="button" class="lrp-star" role="radio" aria-checked="false" aria-label="${n} star${n>1?'s':''}" data-star="${n}"><i class="fa-solid fa-star"></i></button>`).join('')}</div>
      <textarea class="lrp-comment hidden" id="lrpComment" rows="2" maxlength="500" placeholder="Add a comment (optional)"></textarea>
      <div class="lrp-error hidden" id="lrpError" role="alert"></div>
      <div class="levro-review-prompt-actions"><button type="button" class="btn btn-sm btn-outline" id="levroReviewPromptLater">Not now</button><button type="button" class="btn btn-sm" id="levroReviewPromptNow" disabled><i class="fa-solid fa-paper-plane"></i> Submit review</button></div></div>`;
    document.body.appendChild(modal);
    let rating=0;
    const later=()=>{window.__reviewPromptDismissedOrderId=String(order.id);snooze(order.id);closePrompt();};
    modal.querySelectorAll('.lrp-star').forEach(b=>b.addEventListener('click',()=>{rating=Number(b.dataset.star);modal.querySelectorAll('.lrp-star').forEach(x=>{const on=Number(x.dataset.star)<=rating;x.classList.toggle('on',on);x.setAttribute('aria-checked',String(Number(x.dataset.star)===rating));});modal.querySelector('#lrpComment').classList.remove('hidden');modal.querySelector('#levroReviewPromptNow').disabled=false;try{playSound('click');}catch(_){}}));
    modal.querySelector('#levroReviewPromptLater')?.addEventListener('click',later);
    modal.addEventListener('click',e=>{if(e.target===modal)later();});
    modal.querySelector('#levroReviewPromptNow')?.addEventListener('click',async(e)=>{
      const btn=e.currentTarget;if(!rating||btn.disabled)return;btn.disabled=true;
      const err=modal.querySelector('#lrpError');err.classList.add('hidden');
      const {error}=await sb.from('reviews').insert({order_id:order.id,buyer_id:session.user.id,vendor_id:order.vendor_id,rating,comment:(modal.querySelector('#lrpComment').value||'').trim()||null});
      if(error){err.textContent=error.message||'Could not save your review.';err.classList.remove('hidden');btn.disabled=false;return;}
      rememberReviewCompleted(order.id);try{forgetOrderPageCaches(order.id);}catch(_){}window.__reviewPromptDismissedOrderId=String(order.id);closePrompt();
      showToast?.('Thanks for your review!','success');
      try{invalidateMarketplaceState?.();}catch(_){}
      setTimeout(()=>window.maybePromptLevromartReview?.(true),600);
    });
  }
  let lastReviewCheck=0;
  window.maybePromptLevromartReview=async function(force){
    if(promptBusy||!session?.user?.id||profile?.role==='admin'||currentView==='leaveReview')return;
    // The check reads a handful of recent orders; outside a forced check (a completion
    // notification just arrived) run it at most every 3 minutes.
    if(force!==true&&Date.now()-lastReviewCheck<180000)return;
    lastReviewCheck=Date.now();
    promptBusy=true;
    try{const order=await findEligibleReview();if(order)showPrompt(order);}catch(e){console.warn('[Levromart] Review prompt check failed:',e);}finally{promptBusy=false;}
  };
  const run=()=>setTimeout(()=>window.maybePromptLevromartReview?.(),700);
  document.addEventListener('levromart:view-rendered',run);
  // refreshAuthStateOnce is the single entry point for session restoration in this build.
  if(typeof refreshAuthStateOnce==='function'&&!window.__reviewPromptAuthWrapped){
    const original=refreshAuthStateOnce;
    window.__reviewPromptAuthWrapped=true;
    refreshAuthStateOnce=function(...args){return Promise.resolve(original.apply(this,args)).finally(run);};
  }
})();
