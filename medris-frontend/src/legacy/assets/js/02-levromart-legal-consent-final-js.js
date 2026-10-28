/* ---- levromart-legal-consent-final-js ---- */
(function(){
  const CURRENT_LEGAL_VERSION="2026-10-02"; let gate=null,busy=false;
  function bodyFor(view){return view==="privacy"?renderPrivacy():view==="refundPolicy"?renderRefundPolicy():renderTerms();}
  function showGate(view="terms"){if(!session?.user?.id)return;if(!gate){gate=document.createElement("div");gate.className="levromart-legal-consent-backdrop";gate.setAttribute("role","dialog");gate.setAttribute("aria-modal","true");gate.innerHTML=`<div class="levromart-legal-consent-card"><div class="levromart-legal-consent-head"><h2>Before you continue</h2><p class="muted" style="margin:0;font-size:.82rem;">Please review Levromart's current Terms of Service, Privacy Policy, and Refund &amp; Cancellation Policy. You need to accept the current agreement to continue using your account.</p><div class="levromart-legal-consent-links"><button type="button" data-legal="terms">Terms of Service</button><button type="button" data-legal="privacy">Privacy Policy</button><button type="button" data-legal="refundPolicy">Refund &amp; Cancellation Policy</button></div></div><div id="levroLegalGateBody" class="levromart-legal-consent-body"></div><div class="levromart-legal-consent-foot"><div id="levroLegalGateError" class="error-text hidden"></div><button type="button" id="levroLegalGateAgree" class="btn"><i class="fa-solid fa-check"></i> Agree &amp; Continue</button></div></div>`;document.body.appendChild(gate);gate.querySelectorAll("[data-legal]").forEach(b=>b.addEventListener("click",()=>showGate(b.dataset.legal)));gate.querySelector("#levroLegalGateAgree").addEventListener("click",accept);}
    gate.querySelector("#levroLegalGateBody").innerHTML=bodyFor(view);gate.classList.remove("hidden");document.documentElement.classList.add("levromart-legal-gated");}
  async function accept(){if(busy)return;busy=true;const b=gate?.querySelector("#levroLegalGateAgree"),e=gate?.querySelector("#levroLegalGateError");if(b)b.disabled=true;if(e)e.classList.add("hidden");try{const {data,error}=await sb.rpc("accept_legal_terms");if(error)throw error;if(!data?.accepted)throw new Error("The legal agreement could not be recorded.");if(profile){profile.legal_terms_version=CURRENT_LEGAL_VERSION;profile.legal_terms_accepted_at=data.accepted_at||new Date().toISOString();}gate.remove();gate=null;document.documentElement.classList.remove("levromart-legal-gated");}catch(err){console.error("[Levromart] Legal consent failed:",err);if(e){e.textContent=err?.message||"Could not record your acceptance. Please try again.";e.classList.remove("hidden");}}finally{busy=false;if(b)b.disabled=false;}}
  window.__levroCheckLegalConsent=async function(){if(!session?.user?.id)return true;let __lk="";try{__lk="levro_legal_ok_"+session.user.id;if(sessionStorage.getItem(__lk)==="1")return true;}catch(_){ __lk="";}try{const {data,error}=await sb.rpc("get_legal_terms_consent");if(error)throw error;if(data?.accepted===true){try{if(__lk)sessionStorage.setItem(__lk,"1");}catch(_){ }return true;}showGate();return false;}catch(err){
    // A network blip on this one check must never lock an already-agreed
    // user out of the app they were already using -- that's what "pops up
    // every time" turned out to mean. Fail open: skip silently and let the
    // next successful check (next app open, or a retry) verify for real,
    // instead of showing the gate on every connectivity hiccup.
    console.warn("[Levromart] Legal consent check failed (network?), skipping gate this time:",err);
    return true;
  }};
  // This script is intentionally loaded after the main init bundle. Run the
  // account-based check after that bundle has restored the session, and again
  // when a later sign-in occurs. No localStorage-only consent is accepted.
  setTimeout(()=>{if(session?.user?.id) window.__levroCheckLegalConsent();},0);
  sb.auth.onAuthStateChange((event)=>{if(event==="SIGNED_IN"&&window.__levroSignInIsNew())setTimeout(()=>window.__levroCheckLegalConsent(),0);});
})();

/* ---- levromart-payout-setup-gate-js ---- */
(function(){
  let gate=null;
  function closeGate(){gate?.remove();gate=null;}
  window.__levroCheckPayoutSetup=function(){
    if(!session?.user?.id||!vendor?.id||vendor.paystack_subaccount_code)return;
    if(gate)return;
    gate=document.createElement("div");
    gate.className="levromart-payout-gate-backdrop";
    gate.setAttribute("role","dialog");
    gate.setAttribute("aria-modal","true");
    gate.innerHTML=`<div class="levromart-payout-gate-card">
      <div class="levromart-payout-gate-icon"><i class="fa-solid fa-money-bill-transfer"></i></div>
      <h3 style="margin:.2rem 0 .5rem;">Set up your payout account</h3>
      <p class="muted" style="margin:.4rem 0 0;font-size:.85rem;">Add your bank details so Levromart can pay you directly for every order, as soon as it's confirmed. This takes under a minute.</p>
      <div class="levromart-payout-gate-actions">
        <button type="button" class="btn" id="levroPayoutGateSetupBtn"><i class="fa-solid fa-building-columns"></i> Set up payout</button>
        <button type="button" class="btn btn-outline" id="levroPayoutGateLaterBtn">Later</button>
      </div>
    </div>`;
    document.body.appendChild(gate);
    gate.querySelector("#levroPayoutGateSetupBtn").addEventListener("click",()=>{closeGate();window.openVendorPayoutSetup?.();});
    gate.querySelector("#levroPayoutGateLaterBtn").addEventListener("click",closeGate);
    gate.addEventListener("click",(e)=>{if(e.target===gate)closeGate();});
  };
  sb.auth.onAuthStateChange((event)=>{if(event==="SIGNED_IN"&&window.__levroSignInIsNew())setTimeout(()=>window.__levroCheckPayoutSetup?.(),400);});
})();

/* ---- levromart-commission-due-reminder-js ---- */
(function(){
  // Gentle, dismissible heads-up before a commission charge is due -- separate
  // from levroCommissionGate's hard paywall, which only kicks in once a charge
  // is actually overdue. This just nudges a vendor 3 days out, 1 day out, and
  // on the due day itself, at most once per day so it never spams.
  window.__levroCheckCommissionDueReminder = async function(){
    return;   // commission comes off each payout automatically; no reminders
    if(!session?.user?.id||!vendor?.id||profile?.role!=="vendor"||vendor.commission_paused)return;
    try{
      const {data:deadline}=await sb.rpc("get_vendor_commission_deadline",{p_vendor_id:vendor.id});
      const dueAt=deadline?.[0]?.earliest_due_at;
      if(!dueAt)return;
      const dueDate=new Date(dueAt);
      if(Number.isNaN(dueDate.getTime()))return;
      const daysLeft=Math.ceil((dueDate.getTime()-Date.now())/86400000);
      if(daysLeft<0||daysLeft>3)return;
      const {data:owed}=await sb.rpc("get_vendor_commission_owed",{p_vendor_id:vendor.id});
      if(!(Number(owed||0)>0))return;
      const todayKey=new Date().toISOString().slice(0,10);
      const seenKey=`levromart-commission-reminder-seen:${vendor.id}`;
      let seen={};
      try{seen=JSON.parse(localStorage.getItem(seenKey)||"{}");}catch(_){}
      if(seen[todayKey])return;
      try{localStorage.setItem(seenKey,JSON.stringify({[todayKey]:true}));}catch(_){}
      const when=daysLeft<=0?"today":daysLeft===1?"tomorrow":`in ${daysLeft} days`;
      showToast(`Commission of ${naira(Number(owed))} is due ${when}. Pay early to keep your storefront running.`,"info");
    }catch(_){}
  };
  sb.auth.onAuthStateChange((event)=>{if(event==="SIGNED_IN"&&window.__levroSignInIsNew())setTimeout(()=>window.__levroCheckCommissionDueReminder?.(),1200);});
})();
