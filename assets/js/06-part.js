/* ---- script ---- */
(function(){
  if(window.__levroFastVendorLoader)return;
  window.__levroFastVendorLoader=true;
  window.loadVendorsDirectory=async function(){
    const started=performance.now();
    const vendorPromise=sb.from('vendors').select('id,business_name,city,avg_rating,review_count,sector_id,logo_url,cover_url,lat,lng').eq('verification_status','verified').eq('is_active',true).order('business_name').limit(300);
    const sectorPromise=sectors.length?Promise.resolve({data:sectors}):sb.from('sectors').select('*').order('sort_order');
    /* Capability data is part of the directory's critical path. The Buy/Rent/
       Buy & Rent tabs depend on listing_type, so do not first paint every
       vendor with false capabilities and hope a later enrichment query fixes
       them. A failed optional category/search enrichment must never make a
       valid Buy tab look empty. */
    const capabilityPromise=sb.from('products').select('vendor_id,listing_type').eq('status','active').limit(5000);
    const [{data:vendors,error:vendorErr},{data:sectorsData},{data:capabilityRows,error:capabilityErr}]=await Promise.all([vendorPromise,sectorPromise,capabilityPromise]);
    if(vendorErr)throw vendorErr;
    if(!sectors.length)sectors=sectorsData||[];
    if(capabilityErr) console.warn('[Levromart] Vendor capability hydration failed:',capabilityErr);
    const capabilitiesByVendor=new Map();
    (capabilityRows||[]).forEach(p=>{
      const id=String(p.vendor_id);
      const cap=capabilitiesByVendor.get(id)||{canBuy:false,canRent:false};
      if(['sale','both'].includes(p.listing_type)) cap.canBuy=true;
      if(['rent','both'].includes(p.listing_type)) cap.canRent=true;
      capabilitiesByVendor.set(id,cap);
    });
    window.__allVendors=(vendors||[]).map(v=>{
      const cap=capabilitiesByVendor.get(String(v.id))||{canBuy:false,canRent:false};
      return {...v,categories:[],canBuy:cap.canBuy,canRent:cap.canRent,searchText:[v.business_name,v.city].filter(Boolean).join(' ').toLowerCase()};
    });
    window.__filteredVendors=[...window.__allVendors];
    const sectorSel=byId('vendorSectorFilter');
    if(sectorSel)sectorSel.innerHTML='<option value="">All sectors</option>'+sectors.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    const citySel=byId('vendorCityFilter');
    if(citySel){const cities=[...new Set((vendors||[]).map(v=>v.city).filter(Boolean))].sort();citySel.innerHTML='<option value="">All cities</option>'+cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');}
    filterVendorsDirectory();
    enhanceSelectsIn(byId('app'));

    /* Hydrate search/category metadata without blocking first paint. */
    Promise.all([
      sb.from('products').select('vendor_id,name,description,listing_type,category:categories(name)').eq('status','active').limit(5000),
      sb.from('vendor_packages').select('vendor_id,name,description').eq('status','active').limit(2000)
    ]).then(([pr,pk])=>{
      const byIdMap=new Map((window.__allVendors||[]).map(v=>[String(v.id),v]));
      const cats=new Map(); const text=new Map(); const caps=new Map();
      (pr.data||[]).forEach(p=>{const id=String(p.vendor_id);if(!byIdMap.has(id))return; const cap=caps.get(id)||{canBuy:false,canRent:false}; if(["sale","both"].includes(p.listing_type)) cap.canBuy=true; if(["rent","both"].includes(p.listing_type)) cap.canRent=true; caps.set(id,cap); const name=p.category?.name;if(name){if(!cats.has(id))cats.set(id,new Set());cats.get(id).add(name);}if(!text.has(id))text.set(id,[]);text.get(id).push(p.name,p.description,name);});
      (pk.data||[]).forEach(p=>{const id=String(p.vendor_id);if(!byIdMap.has(id))return;if(!text.has(id))text.set(id,[]);text.get(id).push(p.name,p.description,'package','bundle');});
      (window.__allVendors||[]).forEach(v=>{const cap=caps.get(String(v.id))||{canBuy:false,canRent:false};v.canBuy=!!cap.canBuy;v.canRent=!!cap.canRent;v.categories=[...(cats.get(String(v.id))||[])];v.searchText=[v.business_name,v.city,...(text.get(String(v.id))||[])].filter(Boolean).join(' ').toLowerCase();});
      const catSel=byId('vendorCategoryFilter');
      if(catSel){const allCats=[...new Set((window.__allVendors||[]).flatMap(v=>v.categories||[]))].sort();catSel.innerHTML='<option value="">Known for: anything</option>'+allCats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');}
      filterVendorsDirectory();
    }).catch(e=>console.warn('[Levromart] Vendor metadata hydration failed:',e));
    console.info('[Levromart] Vendors first paint:',Math.round(performance.now()-started),'ms');
    return window.__allVendors;
  };
})();

/* ---- levromart-final-2026-09-09 ---- */
(function(){
  "use strict";
  window.openVendorDirectPayment = async function(orderId){
    if(!session || !orderId){showLogin();return;}
    const {data:order,error}=await sb.from("orders").select("id,total_amount,delivery_fee,deposit_amount,buyer_id,vendor_id,order_type,delivery_method,payment_timing,payment_deposit_percent,vendor:vendors(id,business_name,bank_code,bank_name,account_number,account_name,phone,whatsapp_number),payments:payments(payment_type,amount,status,created_at)").eq("id",orderId).maybeSingle();
    if(error||!order){showToast(error?.message||"Order not found.","error");return;}
    if(String(order.buyer_id)!==String(session.user.id)){showToast("You can only pay for your own order.","error");return;}
    // The vendor relationship can be filtered by RLS on older/paused vendor rows.
    // Refresh the payment details directly from the vendor row as a second source.
    if(order.vendor_id){
      const {data:freshVendor}=await sb.from("vendors").select("id,business_name,bank_code,bank_name,account_number,account_name,phone,whatsapp_number").eq("id",order.vendor_id).maybeSingle();
      if(freshVendor) order.vendor={...(order.vendor||{}),...freshVendor};
    }
    const feeType=order.order_type==="rental"?"rental_fee":"sale_price";
    const paymentRows=order.payments||[];
    const isDeliveryOrder=order.delivery_method==="delivery";
    const isPayAfterDelivery=isDeliveryOrder && order.payment_timing==="pay_after";
    const paidFee=Number(paymentRows.filter(p=>p.payment_type===feeType&&p.status==="paid").reduce((sum,p)=>sum+Number(p.amount||0),0));
    const deliveryDepositPaid=Number(paymentRows.filter(p=>p.payment_type==="delivery_deposit_20"&&p.status==="paid").reduce((sum,p)=>sum+Number(p.amount||0),0));
    const pendingFee=paymentRows.find(p=>p.payment_type===feeType&&p.status==="pending");
    const pendingDeliveryDeposit=paymentRows.find(p=>p.payment_type==="delivery_deposit_20"&&p.status==="pending");
    const deliveryDepositReported=!!pendingDeliveryDeposit;
    const pendingDeposit=paymentRows.find(p=>p.payment_type==="deposit"&&p.status==="pending");
    const baseAmount=Math.max(0,Number(order.total_amount||0)-Number(order.delivery_fee||0));
    const deliveryDepositPercent=Math.max(1,Math.min(99,Number(order.payment_deposit_percent??20)||20));
    const deliveryDepositAmount=Math.round(baseAmount*deliveryDepositPercent/100*100)/100;
    let amount=0; let paymentLabel=order.order_type==="rental"?"rental fee":"sale price";
    if(isPayAfterDelivery&&!deliveryDepositPaid&&!deliveryDepositReported){amount=Number(pendingDeliveryDeposit?.amount||deliveryDepositAmount);paymentLabel=`${deliveryDepositPercent}% delivery deposit`;}
    else if(isPayAfterDelivery&&!paidFee){amount=Number(pendingFee?.amount||Math.max(0,Number(order.total_amount||0)-deliveryDepositPaid-(deliveryDepositReported ? Number(pendingDeliveryDeposit?.amount||0) : 0)));paymentLabel="remaining balance";}
    else if(!isDeliveryOrder&&!paidFee){amount=Number(pendingFee?.amount||order.total_amount||0);}
    else if(isDeliveryOrder&&!isPayAfterDelivery&&!paidFee){amount=Number(pendingFee?.amount||order.total_amount||0);paymentLabel="full payment before delivery";}
    else if(!isDeliveryOrder&&Number(order.deposit_amount||0)>0&&!paymentRows.some(p=>p.payment_type==="deposit"&&p.status==="paid")){amount=Number(pendingDeposit?.amount||order.deposit_amount||0);paymentLabel="refundable deposit";}
    else {showToast("There is no outstanding payment on this order.","info");return;}
    byId("manualVendorPaymentModal")?.remove();
    const modal=document.createElement("div"); modal.id="manualVendorPaymentModal"; modal.className="modal manual-payment-modal";
    const bankName = getBankDisplayName(order.vendor?.bank_code, order.vendor?.bank_name);
    const hasAccount = !!(order.vendor?.account_name || order.vendor?.account_number || order.vendor?.bank_code || order.vendor?.bank_name);
    modal.innerHTML=`<div class="modal-content"><div class="flex" style="justify-content:space-between;align-items:center;gap:.6rem;"><h3 style="margin:0;"><i class="fa-solid fa-building-columns"></i> ${isPayAfterDelivery ? (paymentLabel === `${deliveryDepositPercent}% delivery deposit` ? `Pay ${deliveryDepositPercent}% deposit to confirm your order` : "Complete your payment") : isDeliveryOrder ? "Pay before delivery" : "Make your payment"}</h3><button type="button" class="drawer-close-btn" onclick="byId('manualVendorPaymentModal')?.remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
      <p class="muted" style="margin:.5rem 0 1rem;">Transfer <strong>${naira(amount)}</strong> for the <strong>${esc(paymentLabel)}</strong> to the account below (${esc(order.vendor?.business_name||"the vendor")}'s bank account). Use your bank app, then tap “I’ve paid” here.</p>
      <div class="manual-payment-account">
        <div class="manual-payment-account-row"><span class="muted">Bank</span><strong>${esc(bankName)}</strong>${order.vendor?.bank_name||order.vendor?.bank_code?`<button type="button" class="icon-btn manual-payment-copy-btn" title="Copy bank name" aria-label="Copy bank name" onclick="navigator.clipboard?.writeText('${esc(bankName)}').then(()=>showToast('Bank name copied.','success')).catch(()=>showToast('Copy failed. Please copy it manually.','info'))"><i class="fa-regular fa-copy"></i></button>`:""}</div>
        <div class="manual-payment-account-row"><span class="muted">Account name</span><strong>${esc(order.vendor?.account_name||"Not provided")}</strong>${order.vendor?.account_name?`<button type="button" class="icon-btn manual-payment-copy-btn" title="Copy account name" aria-label="Copy account name" onclick="navigator.clipboard?.writeText('${esc(order.vendor.account_name)}').then(()=>showToast('Account name copied.','success')).catch(()=>showToast('Copy failed. Please copy it manually.','info'))"><i class="fa-regular fa-copy"></i></button>`:""}</div>
        <div class="manual-payment-account-row"><span class="muted">Account number</span><strong>${esc(order.vendor?.account_number||"Not provided")}</strong>${order.vendor?.account_number?`<button type="button" class="icon-btn manual-payment-copy-btn" title="Copy account number" aria-label="Copy account number" onclick="navigator.clipboard?.writeText('${esc(order.vendor.account_number)}').then(()=>showToast('Account number copied.','success')).catch(()=>showToast('Copy failed. Please copy it manually.','info'))"><i class="fa-regular fa-copy"></i></button>`:""}</div>
      </div>
      ${!hasAccount ? `<div class="banner banner-warning" style="margin-top:.7rem;"><strong>Vendor payment details are not saved yet.</strong> Please contact the vendor before transferring.</div>` : ""}
      <div class="flex" style="gap:.55rem;margin-top:.8rem;flex-wrap:wrap;">${hasAccount?`<button type="button" class="btn btn-sm btn-outline" onclick="navigator.clipboard?.writeText('${esc(bankName)}\\n${esc(order.vendor?.account_name||"")}\\n${esc(order.vendor?.account_number||"")}').then(()=>showToast('Account details copied.','success')).catch(()=>showToast('Copy failed. Please copy it manually.','info'))"><i class="fa-regular fa-copy"></i> Copy all details</button>`:""}<button type="button" class="btn btn-sm btn-outline" onclick="byId('manualVendorPaymentModal')?.remove();startConversationWithVendor('${order.vendor_id}')"><i class="fa-solid fa-message"></i> Message vendor</button></div>
      <p class="muted" style="font-size:.78rem;margin-top:.9rem;"><strong>Once you’ve made the transfer, tap “I’ve made the payment”.</strong> This lets the vendor know your payment is on the way so they can start preparing your order.</p><div id="directPaymentError" class="error-text hidden"></div><button type="button" class="btn" id="directPaymentReportedBtn" style="width:100%;justify-content:center;margin-top:.45rem;" onclick="reportDirectVendorPayment('${order.id}',${amount},'${esc(paymentLabel)}')"><i class="fa-solid fa-check"></i> I’ve made the payment</button></div>`;
    document.body.appendChild(modal); modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();}); requestAnimationFrame(()=>modal.classList.add("open"));
  };
  window.reportDirectVendorPayment = async function(orderId,amount,paymentStage=""){
    const err=byId("directPaymentError"),btn=byId("directPaymentReportedBtn"); if(!err||!btn)return; err.classList.add("hidden"); btn.disabled=true;
    try{
      const {data,error}=await sb.rpc("buyer_report_manual_payment",{p_order_id:orderId,p_amount:Number(amount)});
      if(error)throw error;
      byId("manualVendorPaymentModal")?.remove();

      // The stage selected by the payment modal is authoritative for the UI:
      // the first delivery deposit can NEVER open the review screen. Only the
      // final sale/rental balance (or a completed full payment) can do that.
      const stage=String(paymentStage||"").trim().toLowerCase();
      const isDepositStage=stage.includes("deposit") || stage.includes("delivery") && stage.includes("%");
      const isFinalStage=!isDepositStage && (stage.includes("sale price") || stage.includes("rental fee") || stage.includes("remaining balance") || stage.includes("full payment"));

      if(isFinalStage){
        showToast("Payment reported. Waiting for the vendor to confirm receipt.","success");
        await navigate("orderDetail",{orderId});
      }else{
        showToast(data?.message||"20% payment reported. Complete the remaining payment before leaving a review.","success");
        await navigate("orderDetail",{orderId});
      }
    }
    catch(e){err.textContent=e?.message||"Could not report the payment.";err.classList.remove("hidden");btn.disabled=false;}
  };
  /* Final vendor application form: make WhatsApp and bank details mandatory. */
  const baseApply=window.renderVendorApply;
  if(typeof baseApply==='function') window.renderVendorApply=async function(){
    const out=String(await baseApply.apply(this,arguments)||""); if(!out.includes('id="vendorApplySubmitBtn"'))return out;
    const banks=typeof NIGERIAN_BANKS!=="undefined"?NIGERIAN_BANKS:[];
    return out.replace(/<label>WhatsApp number<\/label>/i,'<label>WhatsApp number *</label>')
      .replace(/(<input id="vaWhatsapp"[^>]*)(>)/i,'$1 required$2')
      .replace(/<label>CAC number<\/label>/i,`<label>Bank details *</label><div class="grid" style="grid-template-columns:1fr 1fr;gap:.55rem;"><div><label style="font-size:.78rem;">Bank *</label><select id="vaBankCode" required>${banks.map(b=>`<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("")}</select></div><div><label style="font-size:.78rem;">Account number *</label><input id="vaAccountNumber" inputmode="numeric" maxlength="10" required placeholder="10-digit account number" /></div></div><label>Account name <span class="muted">(optional)</span></label><input id="vaAccountName" required placeholder="Name on bank account" /><label>CAC number</label>`);
  };
  async function getApplicantLocation(){
    if(!navigator.geolocation)return null;
    return await new Promise(resolve=>{
      navigator.geolocation.getCurrentPosition(pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude}),()=>resolve(null),{enableHighAccuracy:true,timeout:8000,maximumAge:300000});
    });
  }
  window.submitVendorApply=async function(){
    if(window.__vApplyFinalBusy)return;
    window.__vApplyFinalBusy=true;
    const e=byId("vendorApplyError"),b=byId("vendorApplySubmitBtn");
    let createdVendorId=null;
    try{
      const business_name=String(byId("vaBusinessName")?.value||"").trim();
      const address=String(byId("vaAddress")?.value||"").trim();
      const phone=String(byId("vaPhone")?.value||"").trim();
      const whatsapp_number=String(byId("vaWhatsapp")?.value||"").trim();
      const bankCode=String(byId("vaBankCode")?.value||"").trim();
      const accountNumber=String(byId("vaAccountNumber")?.value||"").trim();
      const accountName=String(byId("vaAccountName")?.value||"").trim();

      if(!business_name||!phone||!whatsapp_number||!bankCode||!accountName||!/^\d{10}$/.test(accountNumber)){
        throw new Error("Business name, phone, WhatsApp, bank, account number and account name are required.");
      }

      if(e){e.classList.add("hidden");e.textContent="";}
      if(b)b.disabled=true;

      const applicantLocation=await getApplicantLocation();

      let verification_docs=[];
      const file=byId("vaDoc")?.files?.[0];
      if(file){
        const ext=(file.name.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").toLowerCase()||"bin";
        const path=String(session.user.id)+"/"+String(Date.now())+"."+ext;
        const {error:upErr}=await sb.storage.from("vendor-docs").upload(
          path,file,
          {contentType:file.type||"application/octet-stream",upsert:false}
        );
        if(upErr)throw new Error(`Document upload failed: ${upErr.message}`);
        verification_docs=[path];
      }

      const bankName=(typeof NIGERIAN_BANKS!=="undefined"
        ? NIGERIAN_BANKS.find(x=>String(x.code)===bankCode)?.name
        : "")||bankCode;

      /*
       * IMPORTANT:
       * The bank details entered during vendor application are the vendor's
       * payout details. Save them directly on the vendor record AND create
       * the Paystack subaccount immediately. This removes the old requirement
       * for the vendor to visit Settings and set up payouts again.
       */
      const {data:createdVendor,error}=await sb.from("vendors").insert({
        user_id:session.user.id,
        sector_id:byId("vaSector")?.value||null,
        business_name,
        address:address||null,
        city:String(byId("vaCity")?.value||"").trim()||null,
        phone,
        whatsapp_number,
        cac_number:String(byId("vaCac")?.value||"").trim()||null,
        bio:String(byId("vaBio")?.value||"").trim()||null,
        verification_docs,
        bank_code:bankCode,
        bank_name:bankName,
        account_number:accountNumber,
        account_name:accountName,
        logo_url:profile?.avatar_url||null,
        lat:applicantLocation?.lat??null,
        lng:applicantLocation?.lng??null,
        is_active:false
      }).select("id").single();

      if(error)throw new Error(error.message);
      createdVendorId=createdVendor?.id||null;
      if(!createdVendorId)throw new Error("Your application was not created.");

      // Create the Paystack subaccount using the exact bank/account details
      // supplied in this application.
      const payoutRes=await fetch("/api/vendor-payments",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"create-subaccount",
          accessToken:session.access_token,
          bankCode,
          accountNumber
        })
      });

      let payoutJson={};
      try{ payoutJson=await payoutRes.json(); }catch(_){}

      if(!payoutRes.ok){
        // Do not leave an application that looks payout-ready when Paystack
        // could not create/verify its payout account.
        try{
          await sb.from("vendors")
            .delete()
            .eq("id",createdVendorId)
            .eq("user_id",session.user.id);
        }catch(_){}
        createdVendorId=null;
        throw new Error(payoutJson.error||"We couldn't activate your payout account. Please check the bank details and try again.");
      }

      const subaccountCode=
        payoutJson.subaccount_code ||
        payoutJson.subaccount?.subaccount_code ||
        null;

      if(!subaccountCode){
        try{
          await sb.from("vendors")
            .delete()
            .eq("id",createdVendorId)
            .eq("user_id",session.user.id);
        }catch(_){}
        createdVendorId=null;
        throw new Error("Your bank account was verified, but the payout account could not be activated. Please try again.");
      }

      // Persist the Paystack subaccount alongside the exact application
      // details. These same fields are then used by the existing customer
      // payment/payout flow and displayed in Edit Business Profile.
      const {error:payoutSaveError}=await sb.from("vendors").update({
        bank_code:bankCode,
        bank_name:bankName,
        account_name:accountName||payoutJson.account_name||null,
        account_number:accountNumber,
        paystack_subaccount_code:subaccountCode
      }).eq("id",createdVendorId).eq("user_id",session.user.id);

      if(payoutSaveError){
        try{
          await sb.from("vendors")
            .delete()
            .eq("id",createdVendorId)
            .eq("user_id",session.user.id);
        }catch(_){}
        createdVendorId=null;
        throw new Error("Your application was saved, but the payout account could not be linked. Please try again.");
      }

      showToast("Vendor application submitted successfully. Your payout account is already set up.","success");
      await refreshAuthState();
      navigate("vendorDashboard");
    }catch(x){
      if(e){
        e.textContent=x?.message||"Could not submit your application.";
        e.classList.remove("hidden");
      }
    }finally{
      window.__vApplyFinalBusy=false;
      if(b)b.disabled=false;
    }
  };

})();

/* ---- levromart-final-2026-09-09-ui-polish-v2-js ---- */
(function(){
  "use strict";

  /* ---------------------------------------------------------------
     Uniform vendor avatars/cards. Vendor imagery follows the user's actual
     account avatar (synced server-side) and initials use the same large circle.
     --------------------------------------------------------------- */
  const oldVendorCardHtml = window.vendorCardHtml;
  window.vendorCardHtml = function(v){
    const avatar = v?.logo_url || v?.user_avatar_url || "";
    const name = v?.business_name || "Vendor";
    const avatarHtml = avatar
      ? `<img src="${esc(avatar)}" alt="" class="vendor-directory-logo" loading="lazy" draggable="false" onerror="this.replaceWith(document.createRange().createContextualFragment(avatarFallbackHtml('${esc(name)}','3.1rem','vendor-directory-logo','${esc(name)}')))" />`
      : avatarFallbackHtml(name, '3.1rem', 'vendor-directory-logo', name);
    const sectorName = (Array.isArray(sectors) ? sectors : []).find(sec => String(sec.id) === String(v?.sector_id))?.name || "";
    const knownLine = `<p class="muted vendor-directory-categories"><i class="fa-solid fa-layer-group"></i> ${esc(sectorName || "Sector not listed")}</p>`;
    const followerCount=Number(v?.follower_count||0);
    return `<div class="vendor-card homepage-vendor-card" data-vendor-id="${esc(v?.id || '')}" onclick="navigate('storefront',{vendorId:'${esc(v?.id || '')}'})" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('storefront',{vendorId:'${esc(v?.id || '')}'});}">
      ${avatarHtml}
      <div class="vendor-directory-copy" style="min-width:0;flex:1 1 auto;overflow:hidden;">
        <strong class="vendor-directory-name">${esc(name)} <i class="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor" title="Verified vendor"></i></strong>
        <p class="muted vendor-directory-city" style="margin:.15rem 0;">${esc(v?.city || 'Lagos')}</p>
        ${knownLine}
        <div class="vendor-card-footer">
          <span class="badge ${ratingBadgeClass(Number(v?.avg_rating ?? 0))}"><i class="fa-solid fa-star"></i> ${Number(v?.avg_rating ?? 0).toFixed(1)} (${Number(v?.review_count ?? 0)})</span>
          <span class="badge vendor-follower-badge"><i class="fa-solid fa-user-group"></i> <span class="vendor-follower-count">${followerCount.toLocaleString()}</span> follower${followerCount === 1 ? "" : "s"}</span>
          <span class="badge" style="margin-left:auto;"><i class="fa-solid fa-store"></i> View storefront</span>
        </div>
      </div>
    </div>`;
  };

  /* ---------------------------------------------------------------
     Vendor rail: clicking the card opens the storefront; only the action
     button focuses/traces the vendor on the map.
     --------------------------------------------------------------- */
  function vendorRailHtmlV2(){
    const all=Array.isArray(window.__filteredVendors)?window.__filteredVendors:[];
    if(!all.length) return `<div class="vendors-map-vendor-rail-head"><strong>Vendors</strong></div><div class="muted" style="padding:.2rem 0 .7rem;font-size:.8rem;">${Array.isArray(window.__allVendors) ? "No vendors match these filters." : "Loading vendors…"}</div>`;
    const chips=all.map(v=>{
      const avatar=v?.logo_url
        ? `<img class="vendor-directory-logo" src="${esc(v.logo_url)}" alt="" loading="lazy" draggable="false" onerror="this.replaceWith(document.createRange().createContextualFragment(avatarFallbackHtml('${esc(v.business_name||'Vendor')}','2.9rem','vendor-directory-logo','${esc(v.business_name||'Vendor')}')))">`
        : avatarFallbackHtml(v.business_name || 'Vendor', '2.9rem', 'vendor-directory-logo', v.business_name || 'Vendor');
      const dist=(buyerLocation&&v.lat!=null&&v.lng!=null)?formatDistanceKm(haversineKm(buyerLocation.lat,buyerLocation.lng,v.lat,v.lng)):'';
      const count=Number(v?.follower_count||0);
      return `<div class="vendors-map-vendor-chip" data-vendor-id="${esc(v.id)}" role="button" tabindex="0" aria-label="Show ${esc(v.business_name||'Vendor')} on map" onclick="focusVendorOnMap('${esc(v.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();focusVendorOnMap('${esc(v.id)}');}">
        ${avatar}
        <span class="vendors-map-vendor-chip-copy"><strong>${esc(v.business_name||'Vendor')}</strong><small>${esc(v.city||'Online')}${dist?' · '+esc(dist):''}</small></span>
        <span class="vendors-map-vendor-chip-action" title="View on map" aria-label="View on map"><i class="fa-solid fa-location-dot"></i></span>
      </div>`;
    }).join('');
    return `<div class="vendors-map-vendor-rail-head"><strong>Vendors</strong>${all.length>6?`<button type="button" onclick="switchVendorsView('list')">See all →</button>`:''}</div><div class="vendors-map-vendor-rail">${chips}</div>`;
  }

  if(typeof window.renderVendorMapRail==='function') window.renderVendorMapRail=function(){
    const wrap=byId('vendorsMapVendorRail');
    if(!wrap) return;
    // Re-rendering the rail (e.g. after tapping a chip to focus a vendor on
    // the map) used to wholesale-replace its innerHTML, which silently reset
    // horizontal scroll to the start every time -- losing the buyer's place
    // in a long vendor list right when they'd just found what they clicked.
    const prevScroll = wrap.querySelector('.vendors-map-vendor-rail')?.scrollLeft || 0;
    wrap.innerHTML=vendorRailHtmlV2();
    const rail=wrap.querySelector('.vendors-map-vendor-rail');
    if(rail){
      rail.scrollLeft = prevScroll;
      if(horizontalBrowseEnabled)setupAutoScroll(rail);
    }
    if(typeof hydrateFollowerCounts==='function')hydrateFollowerCounts();
  };

  /* Open the Vendors map for a storefront distance click, then focus the exact vendor and trace the road route. */
  window.openVendorDistanceMap=async function(vendorId){
    if(!vendorId)return;
    window.__pendingVendorMapFocusId=String(vendorId);
    vendorsViewMode="map"; // open on the map itself, not the grid of vendors
    try{await navigate("vendors");if(vendorsViewMode!=="map"||byId("vendorsMapWrap")?.classList.contains("hidden"))await switchVendorsView("map");}catch(err){
      window.__pendingVendorMapFocusId=null;
      showToast("Could not open the vendor map right now.","error");
    }
  };

  /* ---------------------------------------------------------------
     Road route trace from buyer to vendor, accent-coloured and animated.
     OSRM gives road geometry; straight-line fallback keeps the feature usable.
     --------------------------------------------------------------- */
  let routeLayer=null;
  let routeTimer=null;
  let routeEndpoints=[];
  function clearVendorRoute(){
    if(routeTimer){clearTimeout(routeTimer);routeTimer=null;}
    if(vendorsMap){
      if(routeLayer){try{ if(routeLayer.glow) vendorsMap.removeLayer(routeLayer.glow); if(routeLayer.core) vendorsMap.removeLayer(routeLayer.core); else vendorsMap.removeLayer(routeLayer); }catch(_){} }
      routeEndpoints.forEach(m=>{try{vendorsMap.removeLayer(m);}catch(_){}});
    }
    routeLayer=null;
    routeEndpoints=[];
  }
  window.traceVendorRoute=traceVendorRoute;
  async function traceVendorRoute(vendor){
    if(!vendorsMap||!vendor||vendor.lat==null||vendor.lng==null) return;
    clearVendorRoute();
    let loc=buyerLocation;
    if(!loc){
      try{loc=await requestCustomerLocation(true);}catch(_){loc=null;}
    }
    if(!loc){
      try{
        const perm=await getBrowserLocationPermission();
        if(perm==='granted') loc=await getCurrentPositionOnce();
      }catch(_){ }
    }
    if(!loc){
      const perm=await getBrowserLocationPermission();
      if(perm==='denied') showLocationPrompt('recovery','Levromart already has permission to use location at the app level, but your browser/device permission is blocking the map. Turn Location back on for this site and try again.');
      else showToast('We could not get your current location yet. Tap Locate me on the map and try again.','info');
      return;
    }
    const color=getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()||'#3fb97f';
    let coords=[[Number(loc.lat),Number(loc.lng)],[Number(vendor.lat),Number(vendor.lng)]];
    try{
      const url=`https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(loc.lng)},${encodeURIComponent(loc.lat)};${encodeURIComponent(vendor.lng)},${encodeURIComponent(vendor.lat)}?overview=full&geometries=geojson`;
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5500);
      const res=await fetch(url,{signal:controller.signal});clearTimeout(timer);
      const json=await res.json();
      const route=json?.routes?.[0]?.geometry?.coordinates;
      if(Array.isArray(route)&&route.length>1) coords=route.map(c=>[Number(c[1]),Number(c[0])]);
    }catch(_){/* straight-line fallback */}
    const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const glowLine=window.L.polyline(coords, {color:'#39ff88',weight:7,opacity:0.12,lineCap:'round',lineJoin:'round'}).addTo(vendorsMap);
    const finalLine=window.L.polyline([], {color:'#22c55e',weight:3.2,opacity:.72,lineCap:'round',lineJoin:'round',className:'levro-route-neon-core'}).addTo(vendorsMap);
    finalLine.setStyle({dashArray:reducedMotion ? null : '12 9'});
    routeLayer={glow:glowLine,core:finalLine};
    routeEndpoints=[];
    const start=window.L.circleMarker(coords[0],{radius:7,color:'#fff',weight:2,fillColor:'#39ff88',fillOpacity:1}).addTo(vendorsMap);
    const end=window.L.circleMarker(coords[coords.length-1],{radius:8,color:'#fff',weight:2,fillColor:'#39ff88',fillOpacity:1}).addTo(vendorsMap);
    routeEndpoints=[start,end];
    if(reducedMotion){
      finalLine.setLatLngs(coords);
    }else{
      let i=1;
      let drawing=true;
      const trace=()=>{
        if(!routeLayer?.core) return;
        if(drawing){
          const n=Math.min(coords.length, i);
          finalLine.setLatLngs(coords.slice(0,n));
          i=Math.min(coords.length, i + Math.max(1,Math.ceil(coords.length/24)));
          if(i>=coords.length){ drawing=false; routeTimer=setTimeout(trace,850); }
          else routeTimer=setTimeout(trace,42);
        }else{
          drawing=true; i=1; routeTimer=setTimeout(trace,420);
        }
      };
      trace();
    }
    try{vendorsMap.fitBounds(window.L.latLngBounds(coords),{padding:[36,36],animate:true,duration:.6,maxZoom:16});}catch(_){}
  }

  const oldFocus=window.focusVendorOnMap;
  window.focusVendorOnMap=async function(vendorId){
    const list=Array.isArray(window.__filteredVendors)?window.__filteredVendors:[];
    const target=list.find(v=>String(v.id)===String(vendorId));
    if(!target||target.lat==null||target.lng==null){showToast('This vendor has not added a map location yet.','info');return;}
    const keepY=window.scrollY, keepEl=document.scrollingElement||document.documentElement;
    const restoreY=()=>{ if(Math.abs((window.scrollY||0)-keepY)>2) keepEl.scrollTop=keepY; };
    if(vendorsViewMode!=='map'||byId('vendorsMapWrap')?.classList.contains('hidden')){ vendorsViewMode='map'; switchVendorsView('map'); }
    [0,60,150,300,500,800].forEach(t=>setTimeout(restoreY,t));
    const focus=async()=>{
      if(!vendorsMap)return;
      vendorsMap.setView([Number(target.lat),Number(target.lng)],Math.max(vendorsMap.getZoom(),15),{animate:true,duration:.45});
      const geo=(window.__filteredVendors||[]).filter(v=>v.lat!=null&&v.lng!=null);
      const idx=geo.findIndex(v=>String(v.id)===String(target.id));
      const offset=buyerLocation?1:0;
      const m=idx>=0?vendorsMapMarkers[idx+offset]:null;
      if(m?.openPopup)m.openPopup();
      await traceVendorRoute(target);
    };
    requestAnimationFrame(()=>requestAnimationFrame(()=>focus()));
    setTimeout(()=>focus(),220);
  };

  /* Clear a route when filters change or the page is left. */
  const originalSwitch=window.switchVendorsView;
  window.switchVendorsView=function(mode){
    if(mode!=='map') clearVendorRoute();
    return originalSwitch.apply(this,arguments);
  };

  /* ---------------------------------------------------------------
     Message swipe: true finger-drag, low threshold, correct WhatsApp
     direction, immediate reply target + focus. Prevent duplicate drag binding.
     --------------------------------------------------------------- */
  window.setupMessageSwipeReply=function(root){
    const el=root||document;
    el.querySelectorAll?.('.chat-bubble-wrap[data-msg-wrap-id]').forEach(wrap=>{
      const bubble=wrap.querySelector('.chat-bubble[data-msg-id]');
      if(!bubble||bubble.dataset.v2SwipeBound==='1'||bubble.classList.contains('deleted'))return;
      bubble.dataset.v2SwipeBound='1';
      let sx=0,sy=0,dx=0,dy=0,tracking=false,horizontal=false,armed=false,pointerId=null;
      const mine=bubble.classList.contains('mine');
      const reset=()=>{tracking=false;horizontal=false;dx=dy=0;armed=false;pointerId=null;wrap.classList.remove('chat-swipe-active');bubble.style.transform='';};
      bubble.addEventListener('pointerdown',e=>{
        if(chatSelectionMode||(e.pointerType==='mouse'&&e.button!==0))return;
        sx=e.clientX||0;sy=e.clientY||0;dx=dy=0;tracking=true;horizontal=false;armed=false;pointerId=e.pointerId;
        try{bubble.setPointerCapture(e.pointerId);}catch(_){}
      },{passive:true});
      bubble.addEventListener('pointermove',e=>{
        if(!tracking)return;
        dx=(e.clientX||0)-sx;dy=(e.clientY||0)-sy;
        if(!horizontal){
          if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.15){reset();return;}
          if(Math.abs(dx)<4)return;
          horizontal=Math.abs(dx)>=Math.abs(dy)*0.62;
          if(!horizontal)return;
          wrap.classList.add('chat-swipe-active');
        }
        const allowed=mine?dx<0:dx>0;
        if(!allowed){bubble.style.transform='translate3d(0,0,0)';return;}
        e.preventDefault();
        const shift=mine?Math.max(-96,Math.min(0,dx)):Math.min(96,Math.max(0,dx));
        bubble.style.transform=`translate3d(${shift}px,0,0)`;
        if(!armed&&Math.abs(shift)>=20){armed=true;if(navigator.vibrate)navigator.vibrate(8);}
      },{passive:false});
      const finish=()=>{
        if(!tracking)return;
        const allowed=mine?dx<0:dx>0;
        const shouldReply=horizontal&&allowed&&Math.abs(dx)>=20;
        const id=bubble.dataset.msgId;
        reset();
        if(shouldReply&&id){
          wrap.classList.add('chat-swipe-reply');
          setChatReplyTarget(id);
          setTimeout(()=>wrap.classList.remove('chat-swipe-reply'),220);
          requestAnimationFrame(()=>{try{byId('chatInput')?.focus({preventScroll:true});}catch(_){} });
        }
      };
      bubble.addEventListener('pointerup',finish,{passive:true});
      bubble.addEventListener('pointercancel',reset,{passive:true});
      bubble.addEventListener('lostpointercapture',finish,{passive:true});
    });
  };

  /* ---------------------------------------------------------------
     Smarter local marketplace fallback for Levi. When the Gemini endpoint
     returns a generic answer, search the real marketplace and suggest concrete
     products/vendors instead of repeating the capability boilerplate.
     --------------------------------------------------------------- */
  async function leviLiveMarketplaceFallback(text){
    const q=leviNormaliseText(text);
    if(!q)return null;
    // Strip common question phrasings too ("which vendor sells...", "who
    // has...", "how far is...") -- without this, a question like "which
    // vendor sells phones?" kept "which"/"vendor"/"sells" ahead of the
    // actual keyword ("phones") in word order, and the ILIKE fallback
    // below only ever looked at the first 3 words, silently dropping the
    // one word that actually mattered.
    const stripped=q.replace(/\b(levi|please|help me|can you|could you|where can i|where do i|which vendors?|what vendors?|who sells|which one sells|that sells|who has|how far is|how far|i want|i need|looking for|find me|show me|do you have|is there|are there|sells|selling|sell)\b/g,' ').replace(/\s+/g,' ').trim();
    if(stripped.length<2)return null;
    try{
      const {data:idRows}=await sb.rpc('search_product_ids',{p_query:stripped});
      const ids=(idRows||[]).slice(0,10).map(r=>r.id).filter(Boolean);
      let products=[];
      if(ids.length){
        const {data}=await sb.from('products').select('id,name,description,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,vendor:vendors(id,business_name,avg_rating,review_count,city)').eq('status','active').in('id',ids);
        products=(data||[]).sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
      }
      if(!products.length){
        const words=stripped.split(/\s+/).filter(w=>w.length>2).slice(0,6);
        if(words.length){
          const ors=words.map(w=>`name.ilike.%${w}%,description.ilike.%${w}%`).join(',');
          const {data}=await sb.from('products').select('id,name,description,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,vendor:vendors(id,business_name,avg_rating,review_count,city)').eq('status','active').or(ors).limit(10);
          products=data||[];
        }
      }
      if(products.length){
        const top=products.slice(0,3);
        const lines=top.map(p=>{
          const price=p.discount_price!=null&&Number(p.discount_price)>0&&Number(p.discount_price)<Number(p.sale_price)?`${naira(p.discount_price)} (was ${naira(p.sale_price)})`:p.sale_price!=null?naira(p.sale_price):p.rental_rate!=null?`${naira(p.rental_rate)}/${p.rental_rate_unit||'day'}`:'price on request';
          return `${p.name}, ${price} from ${p.vendor?.business_name||'a vendor'}`;
        });
        const first=top[0];
        if(top.length===1)navigate('productDetail',{productId:first.id});
        return `I found a close match: ${lines.join('; ')}. ${top.length>1?'I can narrow these down further if you tell me what matters most.':''}`;
      }
      const {data:vendors}=await sb.from('vendors').select('id,business_name,city,avg_rating,review_count').eq('verification_status','verified').eq('is_active',true).ilike('business_name',`%${stripped}%`).limit(6);
      if(vendors?.length){
        return `I found ${vendors.length===1?'a vendor':'vendors'} matching that: ${vendors.slice(0,3).map(v=>`${v.business_name} (${Number(v.avg_rating||0).toFixed(1)}★)`).join(', ')}. I can open the vendor directory for you.`;
      }
    }catch(e){console.warn('[Levi] live fallback search failed',e);}
    return null;
  }
  const priorFetch=window.fetchLeviReply;
  if(typeof priorFetch==='function'&&!window.__levroLeviLiveFallbackV2){
    window.__levroLeviLiveFallbackV2=true;
    window.fetchLeviReply=async function(payload){
      const out=await priorFetch.apply(this,arguments);
      if(!isGenericLeviReply(out?.reply))return out;
      const latest=[...(payload?.messages||[])].reverse().find(m=>m?.role==='user')?.content||'';
      const live=await leviLiveMarketplaceFallback(latest);
      if(live)return {...out,reply:live};
      return out;
    };
  }
})();

/* ---- levromart-final-ui-polish-v3-js ---- */
(function(){
  "use strict";

  function normalizeProductGrid(root){
    const scope=root||document;
    scope.querySelectorAll?.('.grid').forEach(grid=>{
      if(!grid.querySelector(':scope > .product-card-wrap')) return;
      grid.classList.add('levro-product-grid-square');
      grid.querySelectorAll(':scope > .product-card-wrap').forEach(w=>{
        w.classList.add('levro-square-product');
        const card=w.querySelector(':scope > .card');
        if(card) card.classList.add('levro-square-product-card');
      });
    });
  }
  normalizeProductGrid();
  const oldMapRender=window.renderVendorsMap;
  if(typeof oldMapRender==='function'&&!window.__levroMapRouteClearV3){
    window.__levroMapRouteClearV3=true;
    window.renderVendorsMap=function(){
      if(typeof window.clearVendorRoute==='function'){try{window.clearVendorRoute();}catch(_){}}
      return oldMapRender.apply(this,arguments);
    };
  }

  window.__levroNormalizeProductGrid=normalizeProductGrid;
  const app=byId('app');
  if(app&&window.MutationObserver){
    const mo=new MutationObserver(muts=>{
      if(muts.some(m=>m.addedNodes&&m.addedNodes.length)) normalizeProductGrid(app);
    });
    mo.observe(app,{childList:true,subtree:true});
  }
})();

/* ---- levromart-final-2026-09-09-v4-js ---- */
(function(){
  "use strict";

  /* Replace the previous expandable notification-folder behaviour. Multiple
     message notifications from one conversation become one compact, clickable
     row. Nothing expands in-place; clicking opens the conversation and marks
     every grouped notification as read. */
  const oldRenderNotifications = window.renderNotifPanel;
  if(typeof oldRenderNotifications === 'function' && !window.__levroNotifMultipleV4){
    window.__levroNotifMultipleV4 = true;
    window.renderNotifPanel = async function(){
      const result = await oldRenderNotifications.apply(this, arguments);
      const panel = typeof getNotifHost === 'function' ? getNotifHost() : byId('notifPanel');
      const list = panel?.querySelector('.notif-list-scroll');
      if(!list || typeof notifSelectMode !== 'undefined' && notifSelectMode) return result;
      const rows=[...list.querySelectorAll(':scope > .notif-item-wrap')];
      const groups=new Map();
      rows.forEach(row=>{
        const item=row.querySelector('.notif-item'); if(!item) return;
        let params={}; try{params=JSON.parse(item.dataset.params||'{}');}catch(_){ }
        if(item.dataset.view!=='messages' || !params.conversationId) return;
        const key=String(params.conversationId);
        if(!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(row);
      });
      for(const [conversationId, groupRows] of groups){
        if(groupRows.length < 2) continue;
        const firstItem=groupRows[0].querySelector('.notif-item');
        const sender=firstItem?.dataset.actorName || firstItem?.querySelector('.notif-copy strong')?.textContent || 'Someone';
        const avatar=firstItem?.dataset.actorAvatar || '';
        const unread=groupRows.filter(r=>r.querySelector('.notif-item')?.classList.contains('unread')).length;
        const latest=groupRows[0].querySelector('.notif-copy .muted')?.textContent || 'New message';
        const ids=groupRows.map(r=>r.querySelector('.notif-item')?.dataset.id).filter(Boolean);
        const wrap=document.createElement('div');
        wrap.className='notif-item-wrap';
        const row=document.createElement('button'); row.type='button';
        row.className='notif-message-summary'+(unread?' unread':'');
        const av=avatar ? `<img class="notif-summary-avatar" src="${esc(avatar)}" alt="">` : `<span class="notif-summary-avatar">${esc(initials(sender))}</span>`;
        row.innerHTML=`${av}<span class="notif-message-summary-copy"><span class="notif-message-summary-title">New message from ${esc(sender)}</span>${unread>1?`<span class="notif-message-summary-count">${unread} new messages</span>`:''}<span class="notif-message-summary-sub">${esc(latest)}</span></span><i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:.72rem;"></i>`;
        row.addEventListener('click',async()=>{
          if(ids.length){
            await sb.from('notifications').update({read:true}).in('id',ids);
            notifCount=Math.max(0,notifCount-unread);
            const dot=byId('notifDot');
            if(dot){if(notifCount>0){dot.textContent=notifCount>9?'9+':notifCount;dot.classList.remove('hidden');}else dot.classList.add('hidden');}
          }
          closeAllPanels(); navigate('messages',{conversationId});
        });
        wrap.appendChild(row);
        groupRows[0].replaceWith(wrap);
        groupRows.slice(1).forEach(r=>r.remove());
      }
      return result;
    };
  }

  /* A more forgiving drag recogniser: pointer capture keeps the message in
     contact with the finger, horizontal movement starts after only a few px,
     and the reply threshold is intentionally easy. */
  window.setupMessageSwipeReply = function(root){
    const el=root||document;
    el.querySelectorAll?.('.chat-bubble-wrap[data-msg-wrap-id]').forEach(wrap=>{
      if(wrap.dataset.levroSwipeV4==='1') return;
      wrap.dataset.levroSwipeV4='1';
      const bubble=wrap.querySelector('.chat-bubble[data-msg-id]');
      if(!bubble || bubble.classList.contains('deleted')) return;
      let sx=0,sy=0,dx=0,dy=0,tracking=false,horizontal=false,pointerId=null;
      const reset=()=>{tracking=false;horizontal=false;dx=dy=0;pointerId=null;wrap.classList.remove('chat-swipe-active');bubble.style.transform='';};
      bubble.addEventListener('pointerdown',e=>{
        if(chatSelectionMode) return;
        if(e.pointerType==='mouse' && e.button!==0) return;
        sx=e.clientX;sy=e.clientY;dx=dy=0;tracking=true;horizontal=false;pointerId=e.pointerId;
        try{bubble.setPointerCapture(e.pointerId);}catch(_){ }
      },{passive:false});
      bubble.addEventListener('pointermove',e=>{
        if(!tracking || (pointerId!=null && e.pointerId!==pointerId)) return;
        dx=e.clientX-sx;dy=e.clientY-sy;
        if(!horizontal){
          if(Math.abs(dy)>Math.abs(dx)*1.45 && Math.abs(dy)>8){reset();return;}
          if(Math.abs(dx)<4)return;
          if(Math.abs(dx)<Math.abs(dy)*.72)return;
          horizontal=true;wrap.classList.add('chat-swipe-active');
        }
        e.preventDefault();
        const resistance=.88;
        const shift=Math.max(-96,Math.min(96,dx*resistance));
        bubble.style.transform=`translate3d(${shift}px,0,0)`;
      },{passive:false});
      const finish=e=>{
        if(!tracking)return;
        const msgId=bubble.dataset.msgId;
        const shouldReply=horizontal && Math.abs(dx)>=14;
        try{if(pointerId!=null)bubble.releasePointerCapture(pointerId);}catch(_){ }
        reset();
        if(shouldReply && msgId){
          wrap.classList.add('chat-swipe-reply');
          setChatReplyTarget(msgId);
          setTimeout(()=>wrap.classList.remove('chat-swipe-reply'),220);
          requestAnimationFrame(()=>{try{byId('chatInput')?.focus({preventScroll:true});}catch(_){ }});
        }
      };
      bubble.addEventListener('pointerup',finish,{passive:false});
      bubble.addEventListener('pointercancel',reset,{passive:false});
      bubble.addEventListener('lostpointercapture',()=>{if(tracking)finish();},{passive:false});
    });
  };
  if(typeof window.setupMessageInteractions==='function'){
    const oldSetup=window.setupMessageInteractions;
    window.setupMessageInteractions=function(root){
      oldSetup.apply(this,arguments);
      window.setupMessageSwipeReply(root);
    };
  }
})();
