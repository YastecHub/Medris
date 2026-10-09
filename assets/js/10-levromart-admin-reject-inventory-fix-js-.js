/* ---- levromart-admin-reject-inventory-fix-js-20260916 ---- */
(function(){
  "use strict";

  /* ---------------- Vendor rejection: no password, reason required ---------------- */
  window.promptVendorRejectionReason = function(businessName){
    return new Promise((resolve)=>{
      const modal=document.getElementById("adminVendorRejectReasonModal");
      const input=document.getElementById("adminRejectReasonInput");
      const msg=document.getElementById("adminRejectReasonMsg");
      const ok=document.getElementById("adminRejectReasonConfirm");
      const cancel=document.getElementById("adminRejectReasonCancel");
      if(!modal||!input||!ok||!cancel){ resolve(null); return; }

      msg.textContent=`Give "${businessName||"this vendor"}" a clear reason. This reason will be sent to the vendor in a notification.`;
      input.value="";
      modal.classList.remove("hidden");
      setTimeout(()=>input.focus(),30);

      const cleanup=(value)=>{
        modal.classList.add("hidden");
        ok.disabled=false;
        ok.removeEventListener("click",onOk);
        cancel.removeEventListener("click",onCancel);
        input.removeEventListener("keydown",onKey);
        modal.removeEventListener("click",onBackdrop);
        resolve(value);
      };
      const onOk=()=>{
        const reason=String(input.value||"").trim();
        if(!reason){
          input.focus();
          showToast("Please enter a rejection reason.","error");
          return;
        }
        cleanup(reason);
      };
      const onCancel=()=>cleanup(null);
      const onKey=(e)=>{
        if(e.key==="Escape"){e.preventDefault();onCancel();}
        else if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();onOk();}
      };
      const onBackdrop=(e)=>{if(e.target===modal)onCancel();};
      ok.addEventListener("click",onOk);
      cancel.addEventListener("click",onCancel);
      input.addEventListener("keydown",onKey);
      modal.addEventListener("click",onBackdrop);
    });
  };

  const previousSetVendorStatus=window.setVendorStatus;
  window.setVendorStatus=async function(id,status,filterStatus,businessName){
    if(status!=="rejected"){
      return previousSetVendorStatus.apply(this,arguments);
    }
    if(adminVendorActionBusy.has(id))return;
    if(!session?.user?.id || profile?.role!=="admin"){
      showToast("Admin access is required.","error");return;
    }

    adminVendorActionBusy.add(id);
    try{
      const {data:target,error:targetError}=await sb.from("vendors")
        .select("id,user_id,business_name,verification_status")
        .eq("id",id).is("deleted_at",null).maybeSingle();
      if(targetError||!target){
        showToast(targetError?.message||"Vendor application not found.","error");return;
      }
      businessName=target.business_name||businessName||"this vendor";

      const reason=await window.promptVendorRejectionReason(businessName);
      if(reason===null)return;

      const {data:{session:liveSession}={}}=await sb.auth.getSession();
      if(!liveSession?.user?.id){
        showToast("Your admin session has expired. Please sign in again and retry.","error");return;
      }

      const {data,error}=await sb.rpc("admin_reject_vendor",{
        p_vendor_id:id,
        p_reason:reason
      });
      if(error){
        showToast(`Could not reject ${businessName}: ${error.message}`,"error");
        return;
      }
      if(!data?.success || !data?.rejected){
        showToast("The rejection did not complete. Please check the vendor status before retrying.","error");
        return;
      }

      try{await logAdminAction("reject_vendor","vendor",id,businessName);}catch(_){}
      invalidateMarketplaceState();
      showToast(`${businessName} rejected. The reason was sent to the vendor.`,"success");
      await navigate("adminPanel",{status:filterStatus||"pending"},{replace:true});
    }catch(err){
      console.error("[Levromart] Vendor rejection failed:",err);
      showToast(err?.message||"Could not reject this vendor.","error");
    }finally{
      adminVendorActionBusy.delete(id);
      window.__pendingVendorRejectionReason=null;
    }
  };

  /* ---------------- Inventory ---------------- */
  window.renderAdminInventory = async function(){
    if(!session?.user?.id || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';

    const CACHE_MS=30000;
    const cached=window.__adminInventoryCache;
    if(cached && (Date.now()-cached.loadedAt)<CACHE_MS){
      window.__adminInventoryAll=cached.products;
      return buildAdminInventoryHtml(cached.products);
    }

    try{
      const {data,error}=await withRouteTimeout(
        sb.rpc("admin_get_inventory"),
        7000,
        {data:null,error:new Error("Inventory is taking too long to load. Please try again.")}
      );
      if(error) throw error;
      const products=Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : (Array.isArray(data?.products) ? data.products : []));
      window.__adminInventoryAll=products;
      window.__adminInventoryCache={products,loadedAt:Date.now()};
      return buildAdminInventoryHtml(products);
    }catch(e){
      console.error("[Levromart] Admin inventory load failed:",e);
      const cachedFallback=window.__adminInventoryCache?.products;
      if(Array.isArray(cachedFallback)) return buildAdminInventoryHtml(cachedFallback,true);
      return `<h2><i class="fa-solid fa-boxes-stacked"></i> Inventory</h2>${adminNavHtml("adminInventory")}<div class="empty-state"><i class="fa-solid fa-triangle-exclamation" style="font-size:1.6rem;display:block;margin-bottom:.6rem;"></i>Could not load inventory. Please try again.</div>`;
    }
  };

  function buildAdminInventoryHtml(products,stale=false){
    const all=[...(products||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base",numeric:true}));
    window.__adminInventoryAll=all;
    if(!["all","active","removed"].includes(window.__adminInventoryStatus)) window.__adminInventoryStatus="all";
    const total=all.length;
    const active=all.filter(p=>String(p.status)==="active").length;
    const removed=all.filter(p=>String(p.status)==="removed").length;
    const sectors=[...new Map(all.map(p=>[p.sector_id,p.sector_name]).filter(([id,name])=>id&&name).map(([id,name])=>[id,{id,name}])).values()]
      .sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:"base"}));
    const monthCounts=new Map();
    all.forEach(p=>{const d=new Date(p.created_at);if(Number.isNaN(d.getTime()))return;const key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;monthCounts.set(key,(monthCounts.get(key)||0)+1);});
    const monthRows=[...monthCounts.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([key,count])=>{const [y,m]=key.split("-");const label=new Date(Date.UTC(Number(y),Number(m)-1,1)).toLocaleString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});return `<tr><td>${esc(label)}</td><td class="num">${count}</td></tr>`;}).join("")||`<tr><td colspan="2" class="muted">No product records yet.</td></tr>`;
    const sectorOptions=sectors.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
    const statusLabel=window.__adminInventoryStatus==="active"?"Active products":window.__adminInventoryStatus==="removed"?"Removed products":"All products";
    const visible=all.filter(p=>window.__adminInventoryStatus==="all" || String(p.status)===window.__adminInventoryStatus);
    return `<h2><i class="fa-solid fa-boxes-stacked"></i> Inventory</h2>${adminNavHtml("adminInventory")}
      ${stale?`<div class="muted" style="margin:.35rem 0;">Showing your most recent inventory snapshot.</div>`:""}
      <div class="admin-inventory-controls">
        <select id="adminInventoryStatusSelect" class="admin-inventory-status-select" onchange="setAdminInventoryStatus(this.value)" aria-label="Inventory status">
          <option value="all" ${window.__adminInventoryStatus==="all"?"selected":""}>All products: ${total}</option>
          <option value="active" ${window.__adminInventoryStatus==="active"?"selected":""}>Active: ${active}</option>
          <option value="removed" ${window.__adminInventoryStatus==="removed"?"selected":""}>Removed: ${removed}</option>
        </select>
        <input id="adminInventorySearch" type="search" placeholder="Search product or vendor…" oninput="filterAdminInventory()">
        <select id="adminInventorySector" onchange="filterAdminInventory()"><option value="">All sectors</option>${sectorOptions}</select>
        <button type="button" class="btn btn-outline btn-sm" onclick="exportInventoryPdf()"><i class="fa-solid fa-file-pdf"></i> Download PDF report</button>
      </div>
      <div class="muted" id="adminInventoryCount" style="margin:.35rem 0 .65rem;">Showing ${visible.length} ${statusLabel.toLowerCase()}</div>
      <div class="admin-inventory-table-wrap">
        <table class="admin-inventory-table" id="adminInventoryTable">
          <thead><tr><th>#</th><th>Product</th><th>Vendor</th><th>Sector</th><th>Price</th><th>Status</th><th>Added</th><th>Action</th></tr></thead>
          <tbody>${renderAdminInventoryRows(visible)}</tbody>
        </table>
      </div>
      <details class="admin-inventory-months">
        <summary>Products added by month</summary>
        <div class="admin-inventory-table-wrap" style="margin-top:.6rem;">
          <table class="admin-inventory-table"><thead><tr><th>Month</th><th class="num">Products added</th></tr></thead><tbody>${monthRows}</tbody></table>
        </div>
      </details>`;
  }

  window.exportInventoryPdf=function(){
    const all=window.__adminInventoryAll||[];
    if(!all.length){showToast("No inventory to export yet.","error");return;}
    const total=all.length;
    const active=all.filter(p=>String(p.status)==="active").length;
    const removed=all.filter(p=>String(p.status)==="removed").length;
    const priceLabel=p=>(p.price===null||p.price===undefined||p.price==="")?"—":`₦${Number(p.price).toLocaleString("en-NG",{minimumFractionDigits:0,maximumFractionDigits:2})}`;

    const bySector=new Map();
    all.forEach(p=>{
      const sector=p.sector_name||"Unassigned";
      const category=p.category_name||"Uncategorized";
      if(!bySector.has(sector))bySector.set(sector,new Map());
      const cats=bySector.get(sector);
      if(!cats.has(category))cats.set(category,[]);
      cats.get(category).push(p);
    });
    const sortedSectors=[...bySector.keys()].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));

    const sectorSummaryRows=sortedSectors.map(sector=>{
      const cats=bySector.get(sector);
      let sectorTotal=0,sectorActive=0;
      cats.forEach(list=>{sectorTotal+=list.length;sectorActive+=list.filter(p=>String(p.status)==="active").length;});
      return `<tr><td>${esc(sector)}</td><td class="num">${cats.size}</td><td class="num">${sectorTotal}</td><td class="num">${sectorActive}</td></tr>`;
    }).join("");

    let n=0;
    const listingSections=sortedSectors.map(sector=>{
      const cats=bySector.get(sector);
      const sortedCats=[...cats.keys()].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
      const catBlocks=sortedCats.map(cat=>{
        const items=[...cats.get(cat)].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base",numeric:true}));
        const rows=items.map(p=>{
          n++;
          return `<tr><td>${n}</td><td>${esc(p.name||"Unnamed product")}</td><td>${esc(p.vendor_name||"Unknown vendor")}</td><td>${priceLabel(p)}</td><td>${esc(String(p.status||"unknown"))}</td></tr>`;
        }).join("");
        return `<h4>${esc(cat)} <span class="muted">(${items.length})</span></h4><table><thead><tr><th>#</th><th>Product</th><th>Vendor</th><th>Price</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
      }).join("");
      return `<h3>${esc(sector)}</h3>${catBlocks}`;
    }).join("");

    const w=window.open("","_blank");
    if(!w){showToast("Please allow pop-ups to export the PDF.","error");return;}
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Levromart Inventory Report</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0d201c;padding:2rem;}
      h1{color:#3fb97f;margin:0 0 .2rem;} .muted{color:#5c7269;margin-top:0;}
      h3{margin:1.5rem 0 .35rem;color:#3fb97f;border-bottom:2px solid #3fb97f;padding-bottom:.25rem;}
      h4{margin:.9rem 0 .3rem;font-size:.95rem;color:#0d201c;}
      table{width:100%;border-collapse:collapse;margin-top:.3rem;font-size:.82rem;}
      th,td{padding:.4rem .55rem;text-align:left;border-bottom:1px solid #e2e8f0;}
      th{background:#f3f8f7;} td.num,th.num{text-align:right;}
      .stats{display:flex;gap:1.2rem;margin:1.2rem 0;flex-wrap:wrap;}
      .stat{border:1px solid #e2e8f0;border-radius:8px;padding:.7rem 1.1rem;}
      .stat b{display:block;font-size:1.3rem;color:#3fb97f;}
      @media print{h3{page-break-after:avoid;}h4{page-break-after:avoid;}tr{page-break-inside:avoid;}}
    </style>
    
<style id="levro-storefront-profile-action-refinement-20261004">
/* Public storefront action hierarchy: the three-dot menu belongs to the banner;
   the identity row keeps only the two useful actions: Follow + notifications. */
#app .storefront-profile .storefront-banner-more{
  position:absolute!important;right:14px!important;top:14px!important;width:42px!important;height:42px!important;
  min-width:42px!important;min-height:42px!important;border-radius:50%!important;
  display:inline-flex!important;align-items:center!important;justify-content:center!important;
  border:1px solid rgba(255,255,255,.34)!important;background:rgba(0,0,0,.34)!important;
  color:#fff!important;box-shadow:0 6px 20px rgba(0,0,0,.22)!important;backdrop-filter:blur(10px)!important;
  -webkit-backdrop-filter:blur(10px)!important;z-index:8!important;cursor:pointer!important;
}
#app .storefront-profile .storefront-banner-more:active{transform:scale(.96)!important;}
#app .storefront-profile .storefront-banner-more i{font-size:1rem!important;}
#app .storefront-profile .storefront-follow-controls{display:flex!important;align-items:center!important;gap:.45rem!important;}
#app .storefront-profile .storefront-follow-controls .follow-btn{min-width:112px!important;justify-content:center!important;gap:.42rem!important;}
#app .storefront-profile .follow-btn-label{display:inline!important;}

/* LinkedIn-inspired interaction pattern, but with LevroMart's own icon language. */
#app .storefront-profile .follow-menu{padding:8px max(18px,env(safe-area-inset-left)) calc(20px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-right))!important;}
#app .storefront-profile .follow-menu > strong{font-size:1.05rem!important;padding:.2rem 0 .25rem!important;border:0!important;}
#app .storefront-profile .follow-mode-intro{margin:0 0 .8rem!important;color:var(--text-muted)!important;font-size:.74rem!important;line-height:1.45!important;}
#app .storefront-profile .follow-mode-row{width:100%!important;min-height:68px!important;display:grid!important;grid-template-columns:42px minmax(0,1fr) 28px!important;align-items:center!important;gap:.75rem!important;padding:.65rem .15rem!important;border:0!important;border-bottom:1px solid color-mix(in srgb,var(--border) 72%,transparent)!important;background:transparent!important;color:var(--text)!important;text-align:left!important;font:inherit!important;cursor:pointer!important;}
#app .storefront-profile .follow-mode-row:last-child{border-bottom:0!important;}
#app .storefront-profile .follow-mode-row:active{background:color-mix(in srgb,var(--text) 5%,transparent)!important;}
#app .storefront-profile .follow-mode-icon{width:42px!important;height:42px!important;border-radius:13px!important;display:grid!important;place-items:center!important;font-size:1rem!important;}
#app .storefront-profile .follow-mode-icon-all{background:color-mix(in srgb,#3b82f6 12%,var(--card))!important;color:#3b82f6!important;}
#app .storefront-profile .follow-mode-icon-relevant{background:color-mix(in srgb,#8b5cf6 12%,var(--card))!important;color:#8b5cf6!important;}
#app .storefront-profile .follow-mode-icon-off{background:color-mix(in srgb,var(--text) 8%,var(--card))!important;color:var(--text-muted)!important;}
#app .storefront-profile .follow-mode-copy{min-width:0!important;display:flex!important;flex-direction:column!important;gap:.15rem!important;}
#app .storefront-profile .follow-mode-copy b{font-size:.86rem!important;line-height:1.25!important;}
#app .storefront-profile .follow-mode-copy small{margin:0!important;font-size:.69rem!important;line-height:1.35!important;color:var(--text-muted)!important;}
#app .storefront-profile .follow-mode-check{width:24px!important;height:24px!important;border:2px solid var(--border)!important;border-radius:50%!important;display:grid!important;place-items:center!important;color:transparent!important;}
#app .storefront-profile .follow-mode-row[aria-pressed="true"] .follow-mode-check{border-color:var(--primary)!important;background:var(--primary)!important;color:#fff!important;}
#app .storefront-profile .follow-mode-row[aria-pressed="true"] .follow-mode-copy b{font-weight:800!important;}

@media(max-width:620px){
  #app .storefront-profile .storefront-banner-more{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;right:12px!important;top:12px!important;}
  #app .storefront-profile .storefront-profile-actions{top:.55rem!important;right:0!important;}
  #app .storefront-profile .storefront-follow-controls .follow-btn{min-width:104px!important;}
}
</style>

<style id="levro-storefront-action-layout-final-20261004">
/* FINAL STOREFRONT ACTION LAYOUT
   The banner owns the three-dot menu. The vendor identity owns the avatar +
   name. Follow + Bell live in their own normal-flow row, so they can never
   collide with the avatar, name, cover, or each other. */
#app .storefront-profile .storefront-profile-actions.storefront-public-actions{
  position:static!important;
  right:auto!important;
  top:auto!important;
  z-index:auto!important;
  display:flex!important;
  align-items:center!important;
  justify-content:flex-end!important;
  gap:.5rem!important;
  width:100%!important;
  min-height:40px!important;
  margin:.65rem 0 0!important;
  padding:0!important;
  flex-wrap:nowrap!important;
}
#app .storefront-profile .storefront-public-actions .storefront-follow-wrap{
  display:flex!important;
  align-items:center!important;
  gap:.5rem!important;
  position:static!important;
  min-width:0!important;
}
#app .storefront-profile .storefront-public-actions .follow-btn.follow-btn-icon{
  width:auto!important;
  min-width:112px!important;
  height:40px!important;
  min-height:40px!important;
  padding:.45rem .95rem!important;
  border-radius:999px!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  gap:.42rem!important;
  font-size:.82rem!important;
  white-space:nowrap!important;
}
#app .storefront-profile .storefront-public-actions .follow-btn.follow-btn-icon .follow-btn-label{
  display:inline!important;
}
#app .storefront-profile .storefront-public-actions .follow-settings-btn{
  width:40px!important;
  min-width:40px!important;
  height:40px!important;
  min-height:40px!important;
  padding:0!important;
  border-radius:50%!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  flex:0 0 40px!important;
}
#app .storefront-profile .storefront-public-actions .storefront-own-message-icon{
  width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;
  padding:0!important;border-radius:50%!important;
}
#app .storefront-profile .storefront-banner-more{
  position:absolute!important;
  right:14px!important;
  top:14px!important;
  width:42px!important;height:42px!important;
  min-width:42px!important;min-height:42px!important;
  z-index:8!important;
}
@media(max-width:620px){
  #app .storefront-profile .storefront-profile-actions.storefront-public-actions{
    margin-top:.6rem!important;
    min-height:38px!important;
  }
  #app .storefront-profile .storefront-public-actions .follow-btn.follow-btn-icon{
    min-width:108px!important;height:38px!important;min-height:38px!important;
    padding:.4rem .85rem!important;font-size:.78rem!important;
  }
  #app .storefront-profile .storefront-public-actions .follow-settings-btn,
  #app .storefront-profile .storefront-public-actions .storefront-own-message-icon{
    width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;
  }
}
</style>

<style id="levro-storefront-actions-final-clean-20261004">
/*
  FINAL STOREFRONT ACTION CLEANUP
  - Follow + notification sit OUTSIDE the banner, directly underneath it.
  - A small breathing gap remains between banner and actions.
  - Vendor name gets deliberate breathing room below the profile image/actions.
  - Three-dot control stays subtle but more legible.
*/
body #app .storefront-profile .storefront-profile-body{
  display:flex!important;
  flex-direction:column!important;
  position:relative!important;
}

/* The avatar still overlaps the banner, but its row now ends just above
   the action row so the actions can sit directly below the banner. */
body #app .storefront-profile .storefront-avatar-row{
  position:relative!important;
  display:flex!important;
  align-items:flex-end!important;
  justify-content:flex-start!important;
  width:100%!important;
  min-height:82px!important;
  height:82px!important;
  margin-top:-41px!important;
  margin-bottom:-28px!important;
  overflow:visible!important;
  z-index:5!important;
}

/* Follow + bell are normal-flow content below the banner — never inside it. */
body #app .storefront-profile .storefront-profile-actions.storefront-public-actions{
  position:relative!important;
  inset:auto!important;
  left:auto!important;
  right:auto!important;
  top:auto!important;
  bottom:auto!important;
  z-index:10!important;
  width:100%!important;
  min-width:0!important;
  height:40px!important;
  min-height:40px!important;
  margin:0 0 0!important;
  padding:0!important;
  display:flex!important;
  align-items:center!important;
  justify-content:flex-end!important;
  gap:.55rem!important;
  flex-wrap:nowrap!important;
  transform:none!important;
}

/* Keep the controls compact and aligned as one group. */
body #app .storefront-profile .storefront-public-actions .storefront-follow-wrap,
body #app .storefront-profile .storefront-public-actions .storefront-follow-controls{
  position:static!important;
  display:flex!important;
  align-items:center!important;
  justify-content:flex-end!important;
  gap:.55rem!important;
  width:auto!important;
  min-width:0!important;
  margin:0!important;
  padding:0!important;
}

body #app .storefront-profile .storefront-public-actions .follow-btn.follow-btn-icon{
  position:static!important;
  min-width:110px!important;
  width:auto!important;
  height:40px!important;
  min-height:40px!important;
  margin:0!important;
}

body #app .storefront-profile .storefront-public-actions .follow-settings-btn{
  position:static!important;
  width:40px!important;
  min-width:40px!important;
  height:40px!important;
  min-height:40px!important;
  margin:0!important;
}

/* Three-dot button: understated, crisp outline and slightly darker icon. */
body #app .storefront-profile .storefront-cover > .storefront-banner-more{
  position:absolute!important;
  inset:12px 12px auto auto!important;
  left:auto!important;
  right:12px!important;
  top:12px!important;
  z-index:25!important;
  width:42px!important;
  height:42px!important;
  min-width:42px!important;
  min-height:42px!important;
  margin:0!important;
  padding:0!important;
  border-radius:50%!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  background:rgba(255,255,255,.30)!important;
  border:2px solid rgba(15,23,42,.38)!important;
  color:#172033!important;
  box-shadow:0 3px 12px rgba(0,0,0,.13)!important;
  backdrop-filter:blur(4px)!important;
  -webkit-backdrop-filter:blur(4px)!important;
}
body #app .storefront-profile .storefront-cover > .storefront-banner-more i{
  font-size:1rem!important;
  color:#172033!important;
  opacity:.92!important;
}

[data-theme="dark"] body #app .storefront-profile .storefront-cover > .storefront-banner-more,
[data-theme="black"] body #app .storefront-profile .storefront-cover > .storefront-banner-more{
  background:rgba(0,0,0,.22)!important;
  border-color:rgba(255,255,255,.55)!important;
  color:#f4f6f8!important;
}
[data-theme="dark"] body #app .storefront-profile .storefront-cover > .storefront-banner-more i,
[data-theme="black"] body #app .storefront-profile .storefront-cover > .storefront-banner-more i{
  color:#f4f6f8!important;
}

@media(max-width:620px){
  body #app .storefront-profile .storefront-avatar-row{
    min-height:74px!important;
    height:74px!important;
    margin-top:-37px!important;
    margin-bottom:-25px!important;
  }

  body #app .storefront-profile .storefront-profile-actions.storefront-public-actions{
    height:38px!important;
    min-height:38px!important;
    gap:.45rem!important;
  }

  body #app .storefront-profile .storefront-public-actions .storefront-follow-wrap,
  body #app .storefront-profile .storefront-public-actions .storefront-follow-controls{
    gap:.45rem!important;
  }

  body #app .storefront-profile .storefront-public-actions .follow-btn.follow-btn-icon{
    min-width:108px!important;
    height:38px!important;
    min-height:38px!important;
  }

  body #app .storefront-profile .storefront-public-actions .follow-settings-btn{
    width:38px!important;
    min-width:38px!important;
    height:38px!important;
    min-height:38px!important;
  }

  body #app .storefront-profile .storefront-cover > .storefront-banner-more{
    width:40px!important;
    height:40px!important;
    min-width:40px!important;
    min-height:40px!important;
    right:12px!important;
    top:12px!important;
  }
}
</style>

</head><body>
    <h1>Levromart Inventory Report</h1>
    <p class="muted">Generated ${new Date().toLocaleString()}</p>
    <div class="stats">
      <div class="stat"><b>${total}</b>Total products</div>
      <div class="stat"><b>${active}</b>Active</div>
      <div class="stat"><b>${removed}</b>Removed</div>
      <div class="stat"><b>${sortedSectors.length}</b>Sectors</div>
    </div>
    <h3>Products by sector</h3>
    <table><thead><tr><th>Sector</th><th class="num">Categories</th><th class="num">Products</th><th class="num">Active</th></tr></thead><tbody>${sectorSummaryRows}</tbody></table>
    ${listingSections}
    ${"<scr"}ipt>window.onload = () => window.print();<\/script>
    

</body></html>`);
    w.document.close();
  };

  function renderAdminInventoryRows(rows){
    return rows.map((p,i)=>{
      const price=(p.price===null||p.price===undefined||p.price==="")?"—":`₦${Number(p.price).toLocaleString("en-NG",{minimumFractionDigits:0,maximumFractionDigits:2})}`;
      const st=String(p.status||"");
      return `<tr><td>${i+1}</td><td><strong>${esc(p.name||"Unnamed product")}</strong></td><td>${esc(p.vendor_name||"Unknown vendor")}</td><td>${esc(p.sector_name||"Unassigned")}</td><td>${price}</td><td><span class="admin-inventory-status ${st==="removed"?"removed":""}">${esc(st||"unknown")}</span></td><td>${p.created_at?new Date(p.created_at).toLocaleDateString("en-NG"):"—"}</td><td><button type="button" class="btn btn-sm btn-danger admin-inventory-delete-btn" data-product-id="${esc(p.id)}" data-product-name="${esc(p.name||"Unnamed product")}" onclick="adminDeleteInventoryProduct('${esc(p.id)}','${esc(p.name||"Unnamed product")}',event)"><i class="fa-solid fa-trash"></i> Delete</button></td></tr>`;
    }).join("")||`<tr><td colspan="8" class="muted" style="text-align:center;padding:1.2rem;">No products match your search/filter.</td></tr>`;
  }

  window.adminDeleteInventoryProduct=async function(productId,productName,event){
    event?.preventDefault?.(); event?.stopPropagation?.();
    if(!session?.user?.id || profile?.role!=="admin"){showToast("Admin access is required.","error");return;}
    productName=String(productName||"this product");
    if(!(await showConfirmDialog(`Delete "${esc(productName)}" from the inventory? If it has order history, Levromart will preserve that history while permanently removing the listing from the inventory view.`,{title:"Delete inventory product",okLabel:"Delete product",danger:true})))return;
    const btn=document.querySelector(`.admin-inventory-delete-btn[data-product-id="${CSS.escape(String(productId))}"]`);
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Deleting…';}
    try{
      const {data,error}=await sb.rpc("admin_delete_inventory_product",{p_product_id:productId});
      if(error)throw error;
      if(!data?.deleted)throw new Error("The product was not deleted.");
      const deletedId=String(productId);
      window.__adminInventoryAll=(window.__adminInventoryAll||[]).filter(p=>String(p.id)!==deletedId);
      if(window.__adminInventoryCache?.products) window.__adminInventoryCache.products=window.__adminInventoryCache.products.filter(p=>String(p.id)!==deletedId);
      filterAdminInventory();
      const total=window.__adminInventoryAll.length;
      const active=window.__adminInventoryAll.filter(p=>String(p.status)==='active').length;
      const removed=window.__adminInventoryAll.filter(p=>String(p.status)==='removed').length;
      const statusSel=document.getElementById('adminInventoryStatusSelect');
      if(statusSel){
        const opts=statusSel.options;
        if(opts[0])opts[0].textContent=`All products: ${total}`;
        if(opts[1])opts[1].textContent=`Active: ${active}`;
        if(opts[2])opts[2].textContent=`Removed: ${removed}`;
      }
      showToast(data.permanent?`${productName} permanently deleted.`:`${productName} removed from inventory; order history preserved.`,'success');
    }catch(err){
      console.error('[Levromart] Admin inventory delete failed:',err);
      showToast(err?.message||'Could not delete this product.','error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-trash"></i> Delete';}
    }
  };

  window.setAdminInventoryStatus=function(status){
    window.__adminInventoryStatus=["all","active","removed"].includes(status)?status:"all";
    filterAdminInventory();
    const statusSel=document.getElementById('adminInventoryStatusSelect');
    if(statusSel) statusSel.value=window.__adminInventoryStatus;
  };

  window.filterAdminInventory=function(){
    const all=window.__adminInventoryAll||[];
    const status=window.__adminInventoryStatus||"all";
    const q=String(document.getElementById("adminInventorySearch")?.value||"").trim().toLowerCase();
    const sector=String(document.getElementById("adminInventorySector")?.value||"");
    const filtered=all.filter(p=>
      (status==="all" || String(p.status||"")===status) &&
      (!q || [p.name,p.vendor_name,p.sector_name].some(v=>String(v||"").toLowerCase().includes(q))) &&
      (!sector || String(p.sector_id||"")===sector)
    );
    const tbody=document.querySelector("#adminInventoryTable tbody");
    if(tbody) tbody.innerHTML=renderAdminInventoryRows(filtered);
    const count=document.getElementById("adminInventoryCount");
    if(count){const label=status==="active"?"active products":status==="removed"?"removed products":"products";count.textContent=`Showing ${filtered.length} ${label} of ${all.filter(p=>status==="all"||String(p.status||"")===status).length}`;}
  };
})();

/* ---- levromart-admin-performance-final-js-20260916 ---- */
(function(){
  "use strict";

  function adminCard(vendorId){return document.getElementById(`adminVendor-${vendorId}`);}
  function fastRemoveVendorCard(vendorId){
    const card=adminCard(vendorId);
    if(!card)return;
    const host=card.parentElement;
    card.remove();
    if(host && !host.querySelector(".admin-vendor-card")){
      host.insertAdjacentHTML("beforeend",`<div class="card empty-state"><i class="fa-solid fa-store"></i><p>No vendors.</p></div>`);
    }
  }
  function updateVendorCardBadge(vendorId,status){
    const card=adminCard(vendorId); if(!card)return;
    const badge=card.querySelector("summary .badge"); if(!badge)return;
    badge.textContent=status;
    badge.className=`badge ${status==="verified"?"success":status==="pending"?"warning":status==="rejected"?"danger":""}`;
  }

  // Reject: show the reason box FIRST. Never wait for a network lookup before
  // displaying the modal. The vendor name is already present on the card.
  window.setVendorStatus=async function(id,status,filterStatus,businessName){
    if(status!=="rejected"){
      if(status==="verified"){
        // Keep approval's existing payout provisioning flow, but remove the
        // redundant getSession/logging round trips from the hot path.
        if(typeof window.__levroFastApproveVendor==="function") return window.__levroFastApproveVendor(id,filterStatus,businessName);
      }
      return;
    }
    if(adminVendorActionBusy.has(id))return;
    if(!session?.user?.id || profile?.role!=="admin"){showToast("Admin access is required.","error");return;}
    const card=adminCard(id);
    businessName=businessName||card?.dataset?.name||card?.querySelector("summary strong")?.textContent?.trim()||"this vendor";
    const reason=await window.promptVendorRejectionReason(businessName);
    if(reason===null)return;
    adminVendorActionBusy.add(id);
    const btn=document.querySelector(`#app .vendor-admin-action[data-vendor-id="${CSS.escape(String(id))}"][data-status="rejected"]`);
    try{
      if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Rejecting…';}
      const {data,error}=await sb.rpc("admin_reject_vendor",{p_vendor_id:id,p_reason:reason});
      if(error)throw error;
      if(!data?.rejected)throw new Error("The rejection did not complete.");
      invalidateMarketplaceState();
      fastRemoveVendorCard(id);
      showToast(`${businessName} rejected. The reason was sent to the vendor.` ,"success");
      // Refresh in the background only; never make the successful action wait.
      setTimeout(()=>{try{navigate("adminPanel",{status:filterStatus||"pending"},{replace:true});}catch(_){}},0);
    }catch(err){
      console.error("[Levromart] Fast vendor rejection failed:",err);
      showToast(err?.message||"Could not reject this vendor.","error");
      if(btn){btn.disabled=false;btn.innerHTML="Reject";}
    }finally{adminVendorActionBusy.delete(id);}
  };

  // Delete: confirmation opens immediately, and the successful card removal
  // happens without waiting for a full admin-page re-render.
  window.adminDeleteVendor=async function(vendorId,filterStatus,businessName){
    if(adminVendorActionBusy.has(vendorId))return;
    if(!session?.user?.id || profile?.role!=="admin"){showToast("Admin access is required.","error");return;}
    const card=adminCard(vendorId);
    businessName=businessName||card?.dataset?.name||card?.querySelector("summary strong")?.textContent?.trim()||"this vendor";
    if(!(await showConfirmDialog(`Move "${businessName}" to the Recycle Bin? Their storefront and listings will be hidden, but everything can be restored later.`,{title:"Move to Recycle Bin",okLabel:"Move to Recycle Bin",danger:true})))return;
    adminVendorActionBusy.add(vendorId);
    const btn=document.querySelector(`#app .vendor-admin-action[data-vendor-id="${CSS.escape(String(vendorId))}"][data-status="delete"]`);
    try{
      if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Moving…';}
      const {data,error}=await sb.rpc("admin_delete_vendor",{p_vendor_id:vendorId});
      if(error)throw error;
      if(!data?.deleted)throw new Error("The vendor could not be moved to the Recycle Bin.");
      invalidateMarketplaceState();
      fastRemoveVendorCard(vendorId);
      showToast(`${businessName} moved to the Recycle Bin.` ,"success");
      setTimeout(()=>{try{navigate("adminPanel",{status:filterStatus||"pending"},{replace:true});}catch(_){}},0);
    }catch(err){
      console.error("[Levromart] Fast vendor delete failed:",err);
      showToast(err?.message||"Could not move this vendor to the Recycle Bin.","error");
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-trash"></i> Delete vendor';}
    }finally{adminVendorActionBusy.delete(vendorId);}
  };

  // Approval does NOT depend on payout setup. Payout is an independent vendor
  // finance setting and must never block the admin from approving a vendor.
  window.__levroFastApproveVendor=async function(id,filterStatus,businessName){
    if(adminVendorActionBusy.has(id))return;
    if(!session?.user?.id || profile?.role!=="admin"){showToast("Admin access is required.","error");return;}
    const card=adminCard(id);
    businessName=businessName||card?.dataset?.name||card?.querySelector("summary strong")?.textContent?.trim()||"this vendor";
    if(!(await showConfirmDialog(`Approve "${businessName}" as a vendor?`,{title:"Approve vendor",okLabel:"Approve"})))return;
    adminVendorActionBusy.add(id);
    const btn=document.querySelector(`#app .vendor-admin-action[data-vendor-id="${CSS.escape(String(id))}"][data-status="verified"]`);
    try{
      if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Approving…';}
      const {data,error}=await sb.rpc("admin_set_vendor_status",{p_vendor_id:id,p_status:"verified"});
      if(error)throw error;
      if(!data?.success)throw new Error("Approval did not complete.");
      fastRemoveVendorCard(id);
      showToast(`${businessName} approved successfully.` ,"success");
      setTimeout(()=>{try{navigate("adminPanel",{status:filterStatus||"pending"},{replace:true});}catch(_){}},0);
    }catch(err){
      console.error("[Levromart] Fast vendor approval failed:",err);
      showToast(err?.message||"Could not approve this vendor.","error");
      if(btn){btn.disabled=false;btn.innerHTML="Approve";}
    }finally{adminVendorActionBusy.delete(id);}
  };

  // Inventory cache is invalidated whenever vendor actions change marketplace state.
  const oldInvalidate=window.invalidateMarketplaceState;
  if(typeof oldInvalidate==="function" && !window.__levroInvalidateWrapped){
    window.__levroInvalidateWrapped=true;
    window.invalidateMarketplaceState=function(){
      try{window.__adminInventoryCache=null;}catch(_){}
      return oldInvalidate.apply(this,arguments);
    };
  }
})();

/* ---- levromart-admin-speed-final-js-20260916 ---- */
(function(){
  "use strict";

  /* The admin attention MutationObserver used to fire a network refresh for
     essentially every DOM mutation. Admin pages contain many mutations while
     rendering, so that created a request storm and made tab switching slow.
     Keep the observer, but throttle the actual network work. */
  if(typeof window.hydrateAdminAttention === "function" && !window.__levroAdminAttentionThrottled){
    const originalHydrateAdminAttention=window.hydrateAdminAttention;
    let lastRun=0, queued=false;
    window.__levroAdminAttentionThrottled=true;
    window.hydrateAdminAttention=async function(...args){
      const now=Date.now();
      if(now-lastRun<5000){
        if(!queued){
          queued=true;
          setTimeout(()=>{queued=false;window.hydrateAdminAttention(...args);},Math.max(250,5000-(now-lastRun)));
        }
        return;
      }
      lastRun=now;
      return originalHydrateAdminAttention.apply(this,args);
    };
  }

  /* The bank-select hydration loop is only useful on the application screen.
     Make the callable path a no-op elsewhere so the existing legacy timer is
     effectively free while the user is browsing the rest of the app. */
  if(typeof window.hydrateApplicationBankSelect === "function" && !window.__levroBankHydrationGuarded){
    const originalBankHydrate=window.hydrateApplicationBankSelect;
    window.__levroBankHydrationGuarded=true;
    window.hydrateApplicationBankSelect=function(...args){
      if(currentView!=="vendorApply" && !document.getElementById("vaBankCode")) return;
      return originalBankHydrate.apply(this,args);
    };
  }
})();

/* ---- levromart-service-editor-final-js-20260917 ---- */
(function(){
  const originalRender=window.renderProductVariantPricing;
  if(typeof originalRender==='function'&&!window.__levroServiceVariantRenderWrapped){
    window.__levroServiceVariantRenderWrapped=true;
    window.renderProductVariantPricing=function(){
      const result=originalRender.apply(this,arguments);
      const wrap=document.getElementById('productVariantPricing');
      const service=!!document.getElementById('prodIsService')?.checked;
      if(!wrap)return result;
      wrap.classList.toggle('is-service-editor',service);
      const note=wrap.querySelector('.variant-price-note');
      if(note) note.textContent=service ? 'Add each service option or package separately. Give it a name, description and price; add an image when useful.' : (wrap.querySelector('.variant-price-row') ? 'Each variety is optional. Add only the details that apply. Drag the handle to reorder.' : 'Add optional variety details such as an image, name, color, size, price or discount price.');
      wrap.querySelectorAll('.variant-price-row').forEach((row)=>{
        const name=row.querySelector('.variant-name')?.closest('.variant-field');
        const color=row.querySelector('.variant-color')?.closest('.variant-field');
        const size=row.querySelector('.variant-size')?.closest('.variant-field');
        const price=row.querySelector('.variant-sale-price')?.closest('.variant-field');
        const discount=row.querySelector('.variant-discount-price')?.closest('.variant-field');
        const desc=row.querySelector('.variant-description')?.closest('.variant-field');
        const qty=row.querySelector('.variant-quantity')?.closest('.variant-field');
        if(service){
          if(name) name.querySelector('label').innerHTML='Service/package name <span>(required)</span>';
          if(row.querySelector('.variant-name')) row.querySelector('.variant-name').placeholder='e.g. Shuku, All Back, Fulani Braids';
          if(color) color.style.display='none';
          if(size) size.style.display='none';
          if(price) price.querySelector('label').innerHTML='Price (₦) <span>(required)</span>';
          if(discount) discount.querySelector('label').innerHTML='Discount price (₦) <span>(optional)</span>';
          if(desc){desc.classList.add('service-variety-only');desc.querySelector('label').innerHTML='Description <span>(optional)</span>';desc.querySelector('textarea').placeholder='Describe what this service/package includes…';}
          if(qty) qty.style.display='none';
        }else{
          if(name) name.querySelector('label').innerHTML='Variety name <span>(optional · auto-named if blank)</span>';
          if(row.querySelector('.variant-name')) row.querySelector('.variant-name').placeholder='e.g. Large / Black / 500ml';
          if(color) color.style.display='';
          if(size) size.style.display='';
          if(price) price.querySelector('label').innerHTML='Price (₦) <span>(optional · uses product price if blank)</span>';
          if(desc){desc.classList.remove('service-variety-only');desc.querySelector('label').innerHTML='Description <span>(optional)</span>';desc.querySelector('textarea').placeholder='Description';}
          if(qty) qty.style.display='';
        }
      });
      return result;
    };
  }
  const originalForm=window.updateProductFormFields;
  if(typeof originalForm==='function'&&!window.__levroServiceFormWrapped){
    window.__levroServiceFormWrapped=true;
    window.updateProductFormFields=function(){const r=originalForm.apply(this,arguments);setTimeout(()=>window.renderProductVariantPricing?.(),0);return r;};
  }
})();

/* ---- levromart-payment-followup-final-js-20260917 ---- */
(function(){
  'use strict';
  let busy=false;
  function close(){document.getElementById('levroPaymentFollowupModal')?.remove();}
  async function fetchBuyerOverdue(){
    if(!session?.user?.id||profile?.role!=='buyer')return null;
    const {data,error}=await sb.from('orders').select('id,total_amount,order_type,delivery_method,payment_timing,payment_deposit_percent,status,status_changed_at,payment_escalated_at,vendor:vendors(id,business_name),payments(payment_type,status,amount)').eq('buyer_id',session.user.id).eq('status','confirmed').not('payment_escalated_at','is',null).order('payment_escalated_at',{ascending:true}).limit(10);
    if(error)return null;
    return (data||[]).find(o=>{const fee=o.order_type==='rental'?'rental_fee':'sale_price';const feePaid=(o.payments||[]).some(p=>String(p.payment_type||'').toLowerCase()===fee&&p.status==='paid');const depositPaid=(o.payments||[]).some(p=>String(p.payment_type||'').toLowerCase()==='delivery_deposit_20'&&p.status==='paid');return !feePaid && !(o.delivery_method==='delivery'&&o.payment_timing==='pay_after'&&depositPaid);})||null;
  }
  async function fetchVendorOverdue(){
    if(!session?.user?.id||profile?.role!=='vendor'||!vendor?.id)return null;
    const {data,error}=await sb.from('orders').select('id,total_amount,order_type,delivery_method,payment_timing,payment_deposit_percent,status,status_changed_at,payment_escalated_at,buyer:users(name),payments(payment_type,status,amount)').eq('vendor_id',vendor.id).eq('status','confirmed').not('payment_escalated_at','is',null).order('payment_escalated_at',{ascending:true}).limit(10);
    if(error)return null;
    return (data||[]).find(o=>{const fee=o.order_type==='rental'?'rental_fee':'sale_price';const feePaid=(o.payments||[]).some(p=>String(p.payment_type||'').toLowerCase()===fee&&p.status==='paid');const depositPaid=(o.payments||[]).some(p=>String(p.payment_type||'').toLowerCase()==='delivery_deposit_20'&&p.status==='paid');return !feePaid && !(o.delivery_method==='delivery'&&o.payment_timing==='pay_after'&&depositPaid);})||null;
  }
  function amountForBuyer(o){
    if(o.delivery_method==='delivery'&&o.payment_timing==='pay_after'){
      const pct=Math.max(1,Math.min(99,Number(o.payment_deposit_percent??20)||20));
      return Math.round(Math.max(0,Number(o.total_amount||0))*pct/100*100)/100;
    }
    return Number(o.total_amount||0);
  }
  function showBuyer(o){
    if(!o||document.getElementById('levroPaymentFollowupModal'))return;
    const m=document.createElement('div');m.id='levroPaymentFollowupModal';m.className='levro-payment-followup-backdrop';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    const vendorName=esc(o.vendor?.business_name||'the vendor');
    const amount=amountForBuyer(o);
    m.innerHTML=`<div class="levro-payment-followup-card"><div class="levro-payment-followup-icon"><i class="fa-solid fa-wallet"></i></div><div style="text-align:center;"><h2 style="margin:0;">Payment still required</h2><p class="muted" style="margin:.4rem 0 0;">Your order with <strong>${vendorName}</strong> has been confirmed, but Levromart has not received a payment confirmation.</p></div><div class="levro-payment-followup-meta"><strong>What to do now</strong><br>Transfer the required amount to the vendor, then tap <strong>I've paid the vendor</strong>. If you no longer want the order, cancel it instead.</div><div class="levro-payment-followup-actions"><button type="button" class="btn" id="levroBuyerPaidFollowup"><i class="fa-solid fa-check"></i> I've paid the vendor · ${naira(amount)}</button><button type="button" class="btn btn-danger" id="levroBuyerCancelFollowup"><i class="fa-solid fa-xmark"></i> Cancel order</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('#levroBuyerPaidFollowup').onclick=async()=>{if(busy)return;busy=true;try{const {data,error}=await sb.rpc('buyer_report_manual_payment',{p_order_id:o.id,p_amount:amount});if(error)throw error;close();showToast(data?.message||'Payment reported. The vendor must confirm it or raise a dispute.','success');await navigate('orderDetail',{orderId:o.id},false);}catch(e){showToast(e?.message||'Could not report the payment.','error');}finally{busy=false;}};
    m.querySelector('#levroBuyerCancelFollowup').onclick=async()=>{if(busy)return;close();await buyerCancelOrder(o.id,false);};
  }
  function showVendor(o){
    if(!o||document.getElementById('levroPaymentFollowupModal'))return;
    const m=document.createElement('div');m.id='levroPaymentFollowupModal';m.className='levro-payment-followup-backdrop';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    const buyerName=esc(o.buyer?.name||'the customer');
    m.innerHTML=`<div class="levro-payment-followup-card"><div class="levro-payment-followup-icon"><i class="fa-solid fa-building-columns"></i></div><div style="text-align:center;"><h2 style="margin:0;">Payment follow-up required</h2><p class="muted" style="margin:.4rem 0 0;">Order <strong>${esc(o.id)}</strong> for <strong>${buyerName}</strong> has been confirmed for more than 24 hours without a verified payment.</p></div><div class="levro-payment-followup-meta"><strong>If the customer has paid you directly</strong><br>Confirm the payment after checking your account. If you cannot verify it, raise a dispute so Levromart can investigate.</div><div class="levro-payment-followup-actions"><button type="button" class="btn" id="levroVendorConfirmFollowup"><i class="fa-solid fa-check"></i> Confirm payment received</button><button type="button" class="btn btn-danger" id="levroVendorDisputeFollowup"><i class="fa-solid fa-triangle-exclamation"></i> Raise dispute</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('#levroVendorConfirmFollowup').onclick=async()=>{if(busy)return;if(!(await showConfirmDialog('Only confirm if you have actually received the customer’s payment, including a direct bank transfer outside Levromart. This records the payment and may complete the order. If you have not received it, raise a dispute instead.',{title:'Confirm payment received',okLabel:'Yes, confirm payment'})))return;busy=true;try{const {data,error}=await sb.rpc('vendor_confirm_unreported_payment',{p_order_id:o.id});if(error)throw error;close();showToast(data?.order_completed?'Payment confirmed. Order completed.':'Payment confirmed.','success');await navigate('orderDetail',{orderId:o.id},false);setTimeout(()=>window.maybePromptLevromartReview?.(),900);}catch(e){showToast(e?.message||'Could not confirm the payment.','error');}finally{busy=false;}};
    m.querySelector('#levroVendorDisputeFollowup').onclick=async()=>{if(busy)return;const reason=window.prompt('Why can you not confirm this payment? Please give the reason for admin review.','I cannot verify receipt of the payment.');if(reason===null||!String(reason).trim())return;busy=true;try{const {data,error}=await sb.rpc('vendor_dispute_unreported_payment',{p_order_id:o.id,p_reason:String(reason).trim()});if(error)throw error;close();showToast('Payment unresolved. The issue has been sent to admin for review.','success');await navigate('orderDetail',{orderId:o.id},false);}catch(e){showToast(e?.message||'Could not raise the dispute.','error');}finally{busy=false;}};
  }
  let lastFollowupCheck=0;
  window.maybePromptPaymentFollowup=async function(){
    if(busy||document.getElementById('levroPaymentFollowupModal')||!session?.user?.id||profile?.role==='admin')return;
    if(currentView==='leaveReview')return;
    if(Date.now()-lastFollowupCheck<120000)return; // was: every navigation + every 30s
    lastFollowupCheck=Date.now();
    try{
      const order=profile?.role==='buyer'?await fetchBuyerOverdue():await fetchVendorOverdue();
      if(order){if(profile?.role==='buyer')showBuyer(order);else showVendor(order);}
    }catch(e){console.warn('[Levromart] payment follow-up check failed',e);}
  };
  document.addEventListener('levromart:view-rendered',()=>setTimeout(()=>window.maybePromptPaymentFollowup?.(),500));
  document.addEventListener('levromart:auth-ready',()=>setTimeout(()=>window.maybePromptPaymentFollowup?.(),700));
})();

/* ---- levromart-service-booking-picker-js-20260917 ---- */
(function(){
  function enhance(){
    if(typeof currentView==='undefined'||currentView!=='productDetail')return;
    const p=window.__lastRenderedProductPreview||window.currentProductDetail||null;
    const product=p||currentProductDetail;
    if(!product?.is_service||!Array.isArray(product.variants)||!product.variants.length)return;
    if(document.querySelector('#app .service-variant-picker'))return;
    const qty=document.getElementById('buyQty');
    if(!qty)return;
    const variants=product.variants.slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
    const selected=variants[0];
    const wrap=document.createElement('div');wrap.className='service-variant-picker';
    wrap.innerHTML=`<div class="service-variant-picker-head"><strong>Choose a service/package</strong><span class="muted" style="font-size:.7rem;">${variants.length} option${variants.length===1?'':'s'}</span></div><input type="hidden" id="selectedProductVariantId" value="${esc(selected.id)}"><div class="service-variant-picker-list">${variants.map((v,i)=>{const price=Number(v.discount_price??v.sale_price??v.rental_rate??0);return `<button type="button" class="service-variant-choice ${i===0?'active':''}" aria-pressed="${i===0?'true':'false'}" data-service-variant-id="${esc(v.id)}"><strong>${esc(v.name||`Option ${i+1}`)}</strong>${v.description?`<small>${esc(v.description)}</small>`:''}<small class="service-variant-price">${price>0?naira(price):'Price on request'}</small></button>`}).join('')}</div>`;
    qty.closest('.flex')?.before(wrap);
    wrap.querySelectorAll('.service-variant-choice').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.serviceVariantId;selectProductVariant(id,false,false);wrap.querySelectorAll('.service-variant-choice').forEach(b=>{const on=b===btn;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}));
    selectProductVariant(selected.id,false,false);
  }
  document.addEventListener('levromart:view-rendered',()=>setTimeout(enhance,80));
})();

/* ---- levromart-final-payout-activation-and-bank-picker-20260917 ---- */
(function(){
  "use strict";

  /* ------------------------------------------------------------------
     BANK PICKER: use event delegation instead of inline onclick strings.
     This fixes search-result clicks, including banks whose names contain
     punctuation/apostrophes, and keeps the hidden select authoritative.
     ------------------------------------------------------------------ */
  window.selectVendorBank = function(code, name){
    const select=document.getElementById("veBankCode");
    const label=document.getElementById("veBankPickerLabel");
    if(!select)return false;
    const wanted=String(code||"").trim();
    const option=Array.from(select.options).find(o=>String(o.value)===wanted);
    if(!option)return false;
    select.value=wanted;
    select.dataset.currentBank=wanted;
    if(label)label.textContent=String(name||option.textContent||"").trim()||getBankDisplayName(wanted,"");
    select.dispatchEvent(new Event("change",{bubbles:true}));
    closeVendorBankPicker();
    return true;
  };

  window.openVendorBankPicker = function(){
    const select=document.getElementById("veBankCode");
    if(!select){console.warn("[Levromart] Payout bank selector is not mounted.");return;}
    closeVendorBankPicker();

    const banks=Array.from(select.options)
      .map(o=>({code:String(o.value||"").trim(),name:String(o.textContent||"").trim()}))
      .filter(b=>b.code&&b.name)
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));

    const modal=document.createElement("div");
    modal.id="vendorBankPickerModal";
    modal.className="modal vendor-bank-picker-modal";
    modal.setAttribute("role","dialog");
    modal.setAttribute("aria-modal","true");
    modal.innerHTML=`<div class="modal-content vendor-bank-picker-content">
      <div class="vendor-bank-picker-head">
        <div><div class="vendor-bank-picker-title"><i class="fa-solid fa-building-columns"></i><span>Select payout bank</span></div>
        <div class="muted" style="font-size:.76rem;margin-top:.2rem;">${banks.length} supported banks and financial institutions</div></div>
        <button type="button" class="drawer-close-btn" data-bank-picker-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="vendor-bank-search-wrap"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input id="vendorBankSearch" class="vendor-bank-search" type="search" autocomplete="off" placeholder="Search bank..." aria-label="Search banks" />
      </div>
      <div id="vendorBankPickerList" class="vendor-bank-picker-list"></div>
    </div>`;
    document.body.appendChild(modal);

    const list=document.getElementById("vendorBankPickerList");
    const search=document.getElementById("vendorBankSearch");
    const paint=()=>{
      const q=String(search?.value||"").trim().toLowerCase();
      const current=String(select.value||"");
      const filtered=q?banks.filter(b=>b.name.toLowerCase().includes(q)||b.code.toLowerCase().includes(q)):banks;
      list.innerHTML=filtered.length?filtered.map(b=>{
        const selected=String(b.code)===current;
        return `<button type="button" class="vendor-bank-option ${selected?"selected":""}" data-bank-code="${esc(b.code)}" data-bank-name="${esc(b.name)}">
          <span class="vendor-bank-option-icon"><i class="fa-solid fa-building-columns"></i></span>
          <span class="vendor-bank-option-main"><strong>${esc(b.name)}</strong><small>${esc(b.code)}</small></span>
          <i class="fa-solid ${selected?"fa-circle-check vendor-bank-option-check":"fa-chevron-right vendor-bank-option-arrow"}"></i>
        </button>`;
      }).join(""):`<div class="empty-state" style="padding:2rem 1rem;">No bank matches your search.</div>`;
    };

    modal.addEventListener("click",e=>{
      if(e.target===modal){closeVendorBankPicker();return;}
      const close=e.target.closest?.("[data-bank-picker-close]");
      if(close){e.preventDefault();e.stopPropagation();closeVendorBankPicker();return;}
      const option=e.target.closest?.("[data-bank-code]");
      if(option){
        e.preventDefault();e.stopPropagation();
        window.selectVendorBank(option.dataset.bankCode,option.dataset.bankName);
      }
    },true);
    search?.addEventListener("input",paint);
    paint();
    document.getElementById("veBankPickerBtn")?.setAttribute("aria-expanded","true");
    requestAnimationFrame(()=>search?.focus());
  };

  /* ------------------------------------------------------------------
     VISIBLE PAYOUT ACTIVATION CARD on My Shop. It disappears only when
     paystack_subaccount_code is present. The approval restriction remains
     unchanged; this is simply the persistent vendor-side prompt.
     ------------------------------------------------------------------ */
  window.openVendorPayoutSetup = async function(){
    try{
      await navigate("vendorEditProfile",{focusPayout:true},false);
      const reveal=()=>{
        const wrap=document.getElementById("bankFormWrap");
        const card=wrap?.closest?.(".card");
        if(wrap){
          wrap.classList.remove("hidden");
          card?.scrollIntoView({behavior:"smooth",block:"start"});
          document.getElementById("veBankPickerBtn")?.focus({preventScroll:true});
          return true;
        }
        return false;
      };
      if(!reveal()){
        let tries=0;const timer=setInterval(()=>{if(reveal()||++tries>20)clearInterval(timer);},100);
      }
    }catch(e){showToast?.(e?.message||"Could not open payout setup.","error");}
  };

  const baseDashboard=window.renderVendorDashboard;
  if(typeof baseDashboard==="function"){
    window.renderVendorDashboard=async function(){
      const html=await baseDashboard.apply(this,arguments);
      try{
        const v=vendor;
        if(!v||v.paystack_subaccount_code)return html;
        const activation=`<div class="vendor-payout-activation-banner" role="status">
          <strong><i class="fa-solid fa-money-bill-transfer"></i> Activate Payout</strong>
          <p>Your vendor account does not have an active payout account yet. Set it up now so Levromart can pay you through your connected bank account. This reminder disappears automatically once payout activation is complete.</p>
          <button type="button" class="btn btn-sm" onclick="openVendorPayoutSetup()"><i class="fa-solid fa-building-columns"></i> Activate Payout</button>
        </div>`;
        const htmlStr = String(html||"");
        // Prefer inserting after the whole profile header card (so the banner
        // doesn't land in the middle of the name/location/bio block); fall
        // back to right after the first heading for any older layout.
        if (htmlStr.includes('vendor-profile-header-card')) {
          let depth = 0, start = htmlStr.indexOf('<div class="vendor-profile-header-card">');
          if (start !== -1) {
            const divRe = /<div\b[^>]*>|<\/div>/g;
            divRe.lastIndex = start;
            let m;
            while ((m = divRe.exec(htmlStr))) {
              depth += m[0] === "</div>" ? -1 : 1;
              if (depth === 0) { const end = divRe.lastIndex; return htmlStr.slice(0, end) + activation + htmlStr.slice(end); }
            }
          }
        }
        return htmlStr.replace(/(<h2[^>]*>[\s\S]*?<\/h2>)/,`$1${activation}`);
      }catch(e){console.warn("[Levromart] Payout activation banner render failed:",e);return html;}
    };
  }

  /* Also expose a small refresh hook so a successful payout save can redraw
     My Shop without a hard reload. */
  window.__levroPayoutUxReady=true;
})();
