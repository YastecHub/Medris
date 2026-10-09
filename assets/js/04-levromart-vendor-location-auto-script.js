/* ---- levromart-vendor-location-auto-script ---- */
(function(){
  "use strict";

  /*
   * IMPORTANT:
   * A web app cannot ask the ADMIN'S phone for a vendor's location — that would
   * incorrectly put the admin on the vendor's map pin. The correct flow is:
   *   1. Capture the applicant's own current browser location when they apply.
   *   2. Store it on that vendor record as lat/lng.
   *   3. When an admin approves them, atomically set verification_status=verified
   *      AND is_active=true. The public map already reads verified+active vendors.
   *   4. When an approved vendor later opens/returns to Levromart, silently refresh
   *      their current location without requiring Business Profile to be opened.
   * This gives newly approved vendors an immediate map pin whenever their
   * application has a location, while also keeping their pin fresh thereafter.
   */

  async function captureVendorCurrentLocationForApplication(){
    try{
      if(!navigator.geolocation) return null;
      return await getCurrentPositionOnce();
    }catch(err){
      console.warn("[Levromart] Applicant location unavailable:", err);
      return null;
    }
  }

  function setVendorApplyLocationStatus(text, state){
    const el=byId("vendorApplyLocationStatus");
    if(!el) return;
    el.className=state ? state : "";
    el.innerHTML = state === "is-ok"
      ? `<i class="fa-solid fa-location-dot"></i><span>${esc(text)}</span>`
      : state === "is-error"
        ? `<i class="fa-solid fa-triangle-exclamation"></i><span>${esc(text)}</span>`
        : `<i class="fa-solid fa-location-crosshairs"></i><span>${esc(text)}</span>`;
  }

  /* ---------------------------------------------------------------
     APPLICATION: capture the applicant's location before the row is created.
     We do not block the application if the browser refuses location; the vendor
     can still be approved, and the automatic vendor-session refresh below will
     capture it later. We never invent coordinates.
     --------------------------------------------------------------- */
  const oldRenderVendorApply = window.renderVendorApply;
  if(typeof oldRenderVendorApply === "function"){
    window.renderVendorApply = async function(){
      const html=await oldRenderVendorApply.apply(this,arguments);
      const str=String(html||"");
      if(!str.includes('id="vendorApplySubmitBtn"') || str.includes('id="vendorApplyLocationStatus"')) return str;
      return str.replace(
        /(<label>City<\/label>\s*<input[^>]*id="vaCity"[^>]*\/>)/i,
        `$1\n        <div id="vendorApplyLocationStatus"><i class="fa-solid fa-location-crosshairs"></i><span>Your current location will be used as your initial shop location on the Levromart map. You won't need to enter it manually.</span></div>`
      );
    };
  }

  /* ---------------------------------------------------------------
     APPLICATION: replace the latest submit handler with the same existing
     validation/upload flow plus location capture. It intentionally keeps all
     existing fields and behavior.
     --------------------------------------------------------------- */
  let vendorLocationApplyBusy=false;
  window.submitVendorApply = async function(){
    if(typeof vendorApplyBusy !== "undefined" && vendorApplyBusy) return;
    if(vendorLocationApplyBusy) return;

    const errorEl=byId("vendorApplyError");
    const button=byId("vendorApplySubmitBtn");
    if(!errorEl || !button) return;

    errorEl.classList.add("hidden");
    errorEl.textContent="";

    const business_name=String(byId("vaBusinessName")?.value||"").trim();
    const address=String(byId("vaAddress")?.value||"").trim();
    const phone=String(byId("vaPhone")?.value||"").trim();

    if(!business_name || !phone){
      errorEl.textContent="Business name and phone are required.";
      errorEl.classList.remove("hidden");
      return;
    }

    vendorLocationApplyBusy=true;
    button.classList.add("is-busy");
    button.disabled=true;
    const originalButton=button.innerHTML;

    try{
      let verification_docs=[];
      const file=byId("vaDoc")?.files?.[0];

      if(file){
        const ext=(file.name.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").toLowerCase()||"bin";
        const path=String(session.user.id)+"/"+String(Date.now())+"."+ext;
        const {error:upErr}=await sb.storage.from("vendor-docs").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
        if(upErr) throw new Error(`Document upload failed: ${upErr.message}`);
        verification_docs=[path];
      }

      setVendorApplyLocationStatus("Getting your current location…", "");
      button.innerHTML='<i class="fa-solid fa-location-dot fa-beat-fade"></i> Getting location…';

      const loc=await captureVendorCurrentLocationForApplication();

      if(loc){
        setVendorApplyLocationStatus("Location captured. It will become your map location when your vendor application is approved.","is-ok");
      }else{
        setVendorApplyLocationStatus("We couldn't access your current location. Your application can still be submitted, but your map pin will be added automatically when Levromart can obtain your location later.","is-error");
      }

      button.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submitting…';

      const {error}=await sb.from("vendors").insert({
        user_id:session.user.id,
        sector_id:byId("vaSector")?.value||null,
        business_name,
        address:address||null,
        city:String(byId("vaCity")?.value||"").trim()||null,
        phone,
        whatsapp_number:String(byId("vaWhatsapp")?.value||"").trim()||null,
        cac_number:String(byId("vaCac")?.value||"").trim()||null,
        bio:String(byId("vaBio")?.value||"").trim()||null,
        verification_docs,
        lat:loc?.lat ?? null,
        lng:loc?.lng ?? null,
        is_active:false
      });

      if(error) throw new Error(error.message);

      showToast(
        loc
          ? "Application submitted. Your current location is saved and will appear on the map when you're approved."
          : "Application submitted successfully. We'll add your map location automatically when your device makes it available.",
        "success"
      );

      await refreshAuthState();
      navigate("vendorDashboard");

    }catch(err){
      console.error("[Levromart] Vendor application/location failed:",err);
      errorEl.textContent=/network|fetch|failed to fetch|timeout/i.test(String(err?.message||""))
        ? "We couldn't reach Levromart. Check your connection and try again."
        : (err?.message||"We couldn't submit your application. Please try again.");
      errorEl.classList.remove("hidden");
    }finally{
      vendorLocationApplyBusy=false;
      button.classList.remove("is-busy");
      button.disabled=false;
      button.innerHTML=originalButton;
    }
  };

  /* ---------------------------------------------------------------
     APPROVED VENDOR SESSION AUTO-LOCATION.
     This runs on vendor login/return and never requires opening Business Profile.
     It only updates the logged-in vendor's own row.
     --------------------------------------------------------------- */
  let vendorAutoLocationInFlight=false;
  let vendorAutoLocationLastRun=0;

  async function refreshOwnVendorLocationSilently(force){
    if(vendorAutoLocationInFlight) return null;
    if(!session || profile?.role !== "vendor") return null;
    if(!navigator.geolocation) return null;

    const now=Date.now();
    if(!force && now-vendorAutoLocationLastRun < 5*60*1000) return null;
    vendorAutoLocationLastRun=now;
    vendorAutoLocationInFlight=true;

    try{
      const {data:ownVendor,error:vendorError}=await sb
        .from("vendors")
        .select("id,verification_status,is_active,lat,lng")
        .eq("user_id",session.user.id)
        .maybeSingle();

      if(vendorError || !ownVendor || ownVendor.verification_status !== "verified" || !ownVendor.is_active) return null;

      const loc=await getCurrentPositionOnce();
      const {error}=await sb.from("vendors").update({lat:loc.lat,lng:loc.lng}).eq("id",ownVendor.id);
      if(error){
        console.warn("[Levromart] Automatic vendor location update failed:",error.message);
        return null;
      }

      return loc;
    }catch(err){
      console.warn("[Levromart] Automatic vendor location unavailable:",err?.message||err);
      return null;
    }finally{
      vendorAutoLocationInFlight=false;
    }
  }

  window.refreshOwnVendorLocationSilently=refreshOwnVendorLocationSilently;

  /* Give the approved vendor a location as soon as their session is ready. */
  setTimeout(()=>refreshOwnVendorLocationSilently(false),1800);
  window.addEventListener("focus",()=>setTimeout(()=>refreshOwnVendorLocationSilently(false),300));
  window.addEventListener("pageshow",()=>setTimeout(()=>refreshOwnVendorLocationSilently(false),500));
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState === "visible") setTimeout(()=>refreshOwnVendorLocationSilently(false),500);
  });

})();

/* ---- levromart-admin-action-delegation-fix ---- */
(function(){
  if(window.__levroAdminActionDelegationReady) return;
  window.__levroAdminActionDelegationReady=true;

  // ONE delegated handler for all vendor admin buttons. Do not add a
  // second document click/keydown listener for .vendor-admin-action
  // anywhere else in this file — the row is re-rendered on every
  // refresh, so delegation (rather than a per-button listener) is what
  // keeps this working after re-renders.
  async function dispatch(btn){
    if(!btn || btn.disabled) return;
    const id=btn.dataset.vendorId, status=btn.dataset.status, filter=btn.dataset.filterStatus;
    if(!id || !status) return;

    // Visual busy state only — the real re-entrancy guard lives in
    // adminVendorActionBusy inside setVendorStatus/adminDeleteVendor,
    // so this can never get permanently stuck even if the row's DOM
    // node is replaced mid-request.
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    try {
      if(status === "delete") {
        if(typeof window.adminDeleteVendor === "function") await window.adminDeleteVendor(id, filter);
      } else if(typeof window.setVendorStatus === "function") {
        await window.setVendorStatus(id, status, filter);
      }
    } finally {
      // The button/row may already have been replaced by a successful
      // refresh (navigate() re-renders #app) — only touch it if
      // it's still actually in the document.
      if(document.contains(btn)) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
  }

  document.addEventListener("click", function(e){
    const btn=e.target?.closest?.("#app .vendor-admin-action");
    if(!btn) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(btn);
  }, true);

  // Keyboard activation (Enter / Space) for accessibility parity with click.
  document.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    const btn=e.target?.closest?.("#app .vendor-admin-action");
    if(!btn) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(btn);
  }, true);
})();
