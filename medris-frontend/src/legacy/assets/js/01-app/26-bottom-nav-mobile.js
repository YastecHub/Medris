// ---------- BOTTOM NAV (mobile) ----------
// Mouse users can't swipe: let them drag horizontal rails (and shift-wheel still works natively).
(function(){
  let rail=null,startX=0,startLeft=0,moved=false;
  document.addEventListener("mousedown",(e)=>{
    if(e.button!==0)return; const r=e.target.closest?.(".hscroll"); if(!r)return;
    rail=r;startX=e.pageX;startLeft=r.scrollLeft;moved=false;
  });
  document.addEventListener("mousemove",(e)=>{
    if(!rail)return; const dx=e.pageX-startX;
    if(!moved&&Math.abs(dx)>6){moved=true;rail.classList.add("is-dragging");}
    if(moved){rail.scrollLeft=startLeft-dx;e.preventDefault();}
  });
  const end=()=>{ if(rail&&moved){const r=rail;setTimeout(()=>r.classList.remove("is-dragging"),0);} rail=null; };
  document.addEventListener("mouseup",end); document.addEventListener("mouseleave",end);
  document.addEventListener("click",(e)=>{ if(moved){e.stopPropagation();e.preventDefault();moved=false;} },true);
})();
// Tapping a bottom-nav tab you are already on does nothing (no reload, no flash).
function lvTabSame(view) {
  if (!view || currentView !== view) return false;
  const p = currentViewParams || {};
  if (view === "vendorOrders") return (p.perspective || "sales") === "sales" && (!p.status || p.status === "all");
  if (view === "buyerOrders") return !p.status || p.status === "all";
  return true;
}
// Tapping Home while already on a clean Home does nothing (no reload, no flash). With a category/search active it resets them.
function lvHomeTap() {
  const filtered = !!(currentHomeCategoryId || currentSectorId || (byId("searchInput")?.value || "").trim());
  // already on Home: go back to the top (and close any open panel) instead of doing nothing
  if (currentView === "home" && !filtered) { try { window.lvCloseRail && window.lvCloseRail(); } catch (_) {} window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  resetHomeFilters();
  navigate("home");
}
// Line icons for the bottom bar (one family: 1.9 stroke, rounded)
window.lvLineIcon = function (n) {
  // the exact shop-with-pin picture the founder chose (traced from the supplied image); the tab bar paints it in the same colour as the other icons
  // the open-box picture the founder chose for Orders (traced from the supplied image)
  if (n === "orders") return `<svg class="lv-line-ic lv-shop-ic" viewBox="0 0 24 24" width="25" height="25" fill="currentColor" stroke="none" aria-hidden="true"><path fill-rule="evenodd" d="M22.47 12.82 20.47 9.79 20.30 9.60 20.08 9.49 17.15 8.40 16.96 8.38 16.82 8.41 16.71 8.47 16.59 8.60 16.51 8.80 16.51 8.96 16.60 9.16 16.73 9.29 16.89 9.37 18.43 9.93 18.51 9.98 18.53 10.01 18.50 10.04 12.04 12.46 11.87 12.43 5.50 10.04 5.49 9.99 5.57 9.93 6.85 9.46 7.07 9.29 7.16 9.04 7.13 8.83 7.07 8.71 6.85 8.54 6.60 8.51 4.30 9.35 3.70 9.60 3.58 9.72 1.58 12.73 1.50 12.91 1.50 13.09 1.58 13.27 1.72 13.42 3.38 14.04 3.50 14.13 3.52 17.95 3.61 18.37 3.77 18.75 4.00 19.12 4.31 19.47 4.69 19.75 5.10 19.95 11.91 22.50 12.09 22.50 18.90 19.95 19.26 19.78 19.69 19.47 20.00 19.12 20.23 18.75 20.39 18.37 20.48 17.95 20.50 14.13 20.59 14.06 22.28 13.42 22.42 13.27 22.50 13.09 22.50 12.91ZM19.51 14.53 19.51 17.78 19.47 18.01 19.36 18.29 19.19 18.56 18.95 18.79 18.75 18.93 18.31 19.12 12.68 21.23 12.54 21.26 12.49 21.22 12.49 14.76 12.52 14.73 12.62 14.81 13.65 16.35 13.92 16.50 14.09 16.50 19.42 14.49 19.48 14.49ZM4.49 14.53 4.52 14.49 4.67 14.53 9.91 16.50 10.08 16.50 10.18 16.46 10.37 16.34 11.40 14.79 11.48 14.73 11.51 14.76 11.51 21.22 11.46 21.26 11.37 21.25 5.38 19.00 5.05 18.79 4.83 18.58 4.66 18.33 4.53 18.01 4.49 17.78ZM21.22 12.70 21.22 12.74 21.14 12.81 14.26 15.39 14.18 15.37 12.79 13.29 12.84 13.21 19.76 10.62 19.87 10.68ZM2.78 12.71 4.13 10.68 4.19 10.62 4.24 10.62 11.16 13.21 11.21 13.29 9.82 15.37 9.74 15.39 2.86 12.81 2.78 12.74ZM18.31 4.61 18.11 4.52 17.97 4.50 17.79 4.55 17.65 4.64 14.63 7.66 14.53 7.86 14.51 8.07 14.54 8.18 14.65 8.35 14.85 8.47 14.95 8.49 15.14 8.47 15.34 8.36 18.36 5.35 18.48 5.11 18.48 4.89 18.43 4.77ZM5.69 4.61 5.53 4.83 5.50 5.00 5.55 5.21 5.64 5.35 8.66 8.36 8.80 8.46 8.91 8.49 9.16 8.47 9.30 8.40 9.41 8.29 9.49 8.10 9.49 7.91 9.46 7.80 9.37 7.66 6.33 4.63 6.21 4.55 6.03 4.50 5.89 4.52ZM11.91 1.50 11.77 1.55 11.63 1.66 11.54 1.81 11.51 1.94 11.51 7.05 11.59 7.27 11.73 7.41 11.91 7.49 12.09 7.49 12.27 7.41 12.37 7.33 12.46 7.18 12.49 7.05 12.49 1.94 12.46 1.81 12.34 1.63 12.23 1.55 12.09 1.50Z"/></svg>`;
  if (n === "shophand") return `<svg class="lv-line-ic lv-shop-ic" viewBox="0 0 24 24" width="25" height="25" aria-hidden="true"><path fill-rule="evenodd" d="M9.71 14.64 9.63 14.77 9.60 15.12 9.60 18.47 9.63 18.77 9.68 18.87 9.81 19.00 10.01 19.08 14.83 19.08 15.03 19.02 15.15 18.92 15.23 18.78 15.26 18.63 15.26 14.92 15.21 14.74 15.06 14.56 14.85 14.48 12.02 14.48 11.77 14.59 11.62 14.82 11.62 15.07 11.69 15.22 11.82 15.35 11.95 15.42 14.25 15.44 14.29 15.47 14.30 18.05 14.24 18.12 10.59 18.10 10.56 18.05 10.56 15.52 10.61 15.44 10.87 15.42 11.11 15.27 11.20 15.09 11.20 14.81 11.02 14.56 10.81 14.48 10.01 14.48 9.83 14.54ZM2.92 5.91 2.82 6.01 2.72 6.21 1.02 11.23 1.03 11.59 1.15 12.07 1.35 12.51 1.58 12.84 1.88 13.13 2.18 13.35 2.49 13.52 2.84 13.65 2.82 13.68 2.61 13.76 2.49 13.88 2.42 14.00 2.39 14.24 2.41 20.01 2.36 20.08 1.33 20.11 1.17 20.21 1.03 20.41 1.00 20.59 1.02 22.45 1.12 22.66 1.23 22.76 1.40 22.83 9.68 22.83 9.88 22.73 10.00 22.59 10.05 22.46 10.05 22.25 9.96 22.06 9.85 21.95 9.61 21.87 2.03 21.87 1.96 21.77 1.98 21.09 2.11 21.04 18.49 21.04 18.59 21.09 18.59 21.82 18.54 21.87 11.44 21.87 11.22 21.93 11.07 22.06 10.99 22.25 10.99 22.46 11.09 22.66 11.20 22.76 11.35 22.83 19.19 22.83 19.41 22.71 19.55 22.46 19.55 20.47 19.52 20.37 19.41 20.21 19.17 20.09 18.15 20.09 18.06 20.06 18.05 17.97 17.93 17.69 17.78 17.57 17.63 17.52 17.48 17.52 17.33 17.57 17.17 17.72 17.09 17.89 17.09 20.01 17.04 20.08 16.97 20.09 5.72 20.08 5.69 20.04 5.69 15.45 5.75 15.40 7.73 15.40 7.79 15.45 7.81 19.28 7.88 19.43 7.99 19.55 8.24 19.63 8.54 19.56 8.67 19.45 8.74 19.31 8.77 19.12 8.77 14.96 8.75 14.82 8.67 14.64 8.55 14.53 8.37 14.44 5.12 14.44 4.93 14.53 4.81 14.64 4.73 14.82 4.73 19.99 4.71 20.04 4.63 20.09 3.47 20.09 3.37 20.04 3.37 14.20 3.34 14.00 3.24 13.83 3.10 13.71 3.14 13.68 3.77 13.68 4.16 13.57 4.58 13.35 5.11 12.92 5.54 13.27 5.85 13.47 6.27 13.63 6.65 13.70 7.13 13.68 7.61 13.53 7.99 13.32 8.54 12.84 8.57 12.84 8.95 13.20 9.27 13.42 9.76 13.63 10.14 13.70 10.61 13.68 11.11 13.53 11.59 13.25 11.97 12.94 12.33 13.27 12.65 13.48 12.98 13.63 13.44 13.73 13.67 13.71 13.82 13.65 13.99 13.47 14.04 13.32 14.04 13.17 13.99 13.02 13.82 12.84 13.57 12.75 13.23 12.72 13.01 12.64 12.81 12.51 12.61 12.31 12.36 11.93 12.27 11.83 12.30 11.78 12.51 11.78 12.71 11.71 12.86 11.58 12.94 11.40 12.94 11.18 12.88 11.03 12.78 10.91 12.56 10.82 2.23 10.80 2.19 10.75 3.52 6.87 3.58 6.79 10.82 6.79 11.06 6.71 11.19 6.57 11.25 6.43 11.25 6.19 11.20 6.06 11.04 5.90 10.86 5.83 3.14 5.83ZM8.95 11.81 8.98 11.78 11.67 11.78 11.69 11.84 11.40 12.22 11.01 12.55 10.62 12.70 10.16 12.74 9.80 12.65 9.42 12.44 9.10 12.11ZM5.41 11.79 8.11 11.78 8.14 11.86 7.89 12.24 7.59 12.51 7.20 12.69 6.96 12.74 6.68 12.74 6.30 12.65 5.99 12.49 5.74 12.27 5.41 11.84ZM2.21 11.83 2.26 11.78 4.79 11.78 4.83 11.81 4.58 12.17 4.25 12.49 3.93 12.65 3.53 12.74 3.12 12.70 2.74 12.52 2.39 12.17ZM17.33 4.06 16.69 4.16 16.29 4.32 16.17 4.44 16.11 4.59 16.09 4.75 16.14 4.92 16.29 5.10 16.47 5.18 16.69 5.18 17.17 5.03 17.67 5.03 17.88 5.08 18.31 5.28 18.71 5.65 18.96 6.08 19.07 6.57 19.07 6.82 19.02 7.10 18.96 7.30 18.73 7.70 18.51 7.93 18.31 8.08 18.03 8.23 17.68 8.33 17.12 8.33 16.74 8.21 16.41 8.02 16.04 7.63 15.84 7.25 15.78 7.04 15.74 6.61 15.78 6.34 15.91 5.96 15.93 5.81 15.84 5.58 15.66 5.41 15.50 5.37 15.31 5.38 15.16 5.45 14.98 5.68 14.80 6.36 14.80 7.01 14.90 7.45 15.10 7.93 15.36 8.33 15.76 8.73 16.16 8.99 16.69 9.21 17.23 9.31 17.62 9.31 18.15 9.21 18.73 8.96 19.12 8.68 19.39 8.41 19.67 8.02 19.89 7.55 20.00 7.10 20.03 6.59 19.95 6.01 19.80 5.60 19.55 5.17 19.17 4.74 18.74 4.42 18.28 4.21 17.91 4.11ZM17.00 1.17 16.54 1.22 15.99 1.34 15.06 1.67 14.50 1.97 14.05 2.27 13.49 2.75 13.19 3.06 12.89 3.43 12.55 3.96 12.31 4.40 12.12 4.88 11.97 5.38 11.87 5.86 11.82 6.29 11.82 7.05 11.97 7.97 12.28 9.01 12.66 9.92 13.39 11.30 14.04 12.34 14.65 13.25 15.41 14.31 17.09 16.51 17.32 16.76 17.48 16.83 17.68 16.83 17.80 16.80 17.96 16.66 20.02 13.88 20.55 13.07 20.56 12.79 20.53 12.69 20.40 12.52 20.18 12.42 19.98 12.42 19.77 12.54 18.91 13.78 17.65 15.47 17.57 15.50 15.71 13.07 14.93 11.94 14.25 10.85 13.84 10.10 13.29 8.93 13.04 8.23 12.86 7.52 12.80 7.10 12.78 6.44 12.91 5.58 13.11 4.98 13.31 4.57 13.52 4.21 13.91 3.71 14.32 3.29 14.78 2.93 15.13 2.71 15.78 2.42 16.32 2.25 16.89 2.15 17.93 2.15 18.49 2.25 19.04 2.42 19.29 2.52 19.94 2.86 20.37 3.18 20.91 3.71 21.26 4.16 21.48 4.50 21.79 5.20 22.01 6.06 22.04 6.41 22.04 7.07 21.91 7.98 21.61 9.01 21.16 10.09 20.37 11.59 20.37 11.79 20.43 11.96 20.58 12.11 20.85 12.19 21.05 12.14 21.28 11.93 21.94 10.70 22.39 9.69 22.64 8.99 22.88 8.03 22.98 7.35 23.00 6.38 22.93 5.78 22.82 5.27 22.49 4.37 22.19 3.82 21.91 3.41 21.61 3.05 21.14 2.58 20.78 2.28 20.32 1.97 19.75 1.67 19.26 1.47 18.76 1.32 18.25 1.22 17.80 1.17Z"/></svg>`;
  const P = {
    home: "<path d='M3.5 10.2A3 3 0 0 1 4.6 7.9l5.6-4.5a3 3 0 0 1 3.6 0l5.6 4.5a3 3 0 0 1 1.1 2.3V17a4 4 0 0 1-4 4H7.5a4 4 0 0 1-4-4z'/> <path d='M8.6 14.4c.9 1.3 2 2 3.4 2s2.5-.7 3.4-2'/>",
    store: "<path d='M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5'/> <path d='M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244'/> <path d='M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05'/>",
    request: "<path d='M12 22V12'/> <path d='M20.27 18.27 22 20'/> <path d='M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559'/> <path d='M3.29 7 12 12l8.71-5'/> <path d='m7.5 4.27 8.997 5.148'/> <circle cx='18.5' cy='16.5' r='2.5'/>",
    bell: "<path d='M10.268 21a2 2 0 0 0 3.464 0'/> <path d='M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'/>",
    orders: "<path d='M13 16H8'/> <path d='M14 8H8'/> <path d='M16 12H8'/> <path d='M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z'/>",
    shield: "<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/> <path d='m9 12 2 2 4-4'/>",
    coins: "<circle cx='12' cy='12' r='9'/><path d='M9 16V8l6 8V8'/>",
    wallet: "<path d='M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1'/> <path d='M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'/>",
    plus: "<path d='M5 12h14'/><path d='M12 5v14'/>",
    user: "<circle cx='12' cy='8' r='5'/> <path d='M20 21a8 8 0 0 0-16 0'/>",
    map: "<path d='M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z'/><circle cx='12' cy='10' r='2.5'/>",
    messages: "<path d='M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z'/>",
  };
  return `<svg class="lv-line-ic" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.home}</svg>`;
};
function renderBottomNav() {
  const nav = byId("bottomNav");
  if (!nav) return;

  // The account type is remembered, so the bar never starts as "Request" for a vendor (or as a shopper's bar for an admin) while the profile is still loading
  let navRole = profile?.role || null;
  try {
    if (!navRole && session) navRole = localStorage.getItem("lv-nav-role") || null;
    if (profile?.role && session) localStorage.setItem("lv-nav-role", profile.role === "admin" ? "admin" : (profile.role === "vendor" || vendor) ? "vendor" : "buyer");
  } catch (_) {}
  const isVendorUser = session && navRole !== "admin" && (!!vendor || navRole === "vendor");
  const homeTab = { icon: lvLineIcon("home"), label: "Home", action: "lvHomeTap()", view: "home" };
  const vendorsTab = { icon: lvLineIcon("shophand"), label: "Vendors", action: "navigate('vendors')", view: "vendors" };
  const addTab = isVendorUser
    ? { icon: lvLineIcon("plus"), label: "Add", action: "openAddChooser()", view: null }
    : { icon: lvLineIcon("request"), label: "Request", action: session ? "navigate('requestEquipment')" : "requireLoginThen('requestEquipment')", view: "requestEquipment" };
  const notificationsTab = { icon: lvLineIcon("bell"), label: "Notifications", action: "navigate('notifications')", view: "notifications", badge: notifCount };
  const ordersTab = isVendorUser
    ? { icon: lvLineIcon("orders"), label: "Orders", action: "navigate('vendorOrders',{status:'all',perspective:'sales'})", view: "vendorOrders", badge: Number(vendorPendingOrderCount||0) + Number(buyerPendingOrderCount||0) }
    : { icon: lvLineIcon("orders"), label: "Orders", action: "navigate('buyerOrders')", view: "buyerOrders", badge: buyerPendingOrderCount };

  const itemHtml = (it) => `<button class="bottom-nav-item ${it.view && it.view === currentView ? "active" : ""}${it.view === "notifications" && it.badge ? " ringing" : ""}" onclick="if(lvTabSame('${it.view || ""}'))return;${it.action}"${it.view && it.view === currentView ? ' aria-current="page"' : ""}><span class="bn-icon">${it.icon}${it.badge ? `<span class="bn-badge">${it.badge > 9 ? "9+" : it.badge}</span>` : ""}</span><span>${it.label}</span></button>`;

  if (session && navRole === "admin") {
    nav.classList.remove("has-add", "buyer-no-add", "lv-snap-dock");
    nav.innerHTML = [homeTab, vendorsTab,
      { icon: lvLineIcon("shield"), label: "Admin", action: "navigate('adminPanel')", view: "adminPanel", badge: Number(window.__lvPayPending||0) },
      { icon: lvLineIcon("wallet"), label: "Finance", action: "navigate('adminFinance')", view: "adminFinance" }].map(itemHtml).join("");
    return;
  }

  nav.classList.remove("buyer-no-add", "lv-snap-dock");
  nav.classList.add("has-add");
  nav.innerHTML =
    '<div class="bn-group bn-group-left">' + [homeTab, vendorsTab].map(itemHtml).join("") + '</div>' +
    '<button class="bottom-nav-add' + (isVendorUser ? '' : ' is-request') + '" onclick="' + (isVendorUser ? 'openAddChooser()' : (session ? "navigate('requestEquipment')" : "requireLoginThen('requestEquipment')")) + '" aria-label="' + addTab.label + '">' +
      '<span class="bn-icon">' + addTab.icon + '</span><span>' + addTab.label + '</span>' +
    '</button>' +
    '<div class="bn-group bn-group-right">' + [notificationsTab, ordersTab].map(itemHtml).join("") + '</div>';
}

const LEVRO_MOTION_KEY="levromart-motion-preference-v1";
function getLevromartMotionPreference(){try{return localStorage.getItem(LEVRO_MOTION_KEY)==="full"?"full":"calm";}catch(_){return "calm";}}
function applyLevromartMotionPreference(value){const pref=value==="full"?"full":"calm";document.documentElement.dataset.levroMotion=pref;try{localStorage.setItem(LEVRO_MOTION_KEY,pref);}catch(_){}return pref;}
function setLevromartMotionPreference(value){const pref=applyLevromartMotionPreference(value);try{hydrateSettingsPage?.();}catch(_){}showToast(pref==="calm"?"Calm mode enabled. Decorative motion is off.":"Full Motion enabled.","success");}
applyLevromartMotionPreference(getLevromartMotionPreference());

function initBottomNavScrollMotion(){
  const nav = byId("bottomNav");
  if (!nav || nav.dataset.scrollMotionReady === "1") return;
  nav.dataset.scrollMotionReady = "1";
  const getMetrics=()=>{
    const chat=document.body.classList.contains("chat-full-page") ? document.querySelector(".chat-messages") : null;
    if(chat) return {y:Math.max(0,chat.scrollTop||0),maxY:Math.max(0,chat.scrollHeight-chat.clientHeight)};
    return {y:Math.max(0,window.scrollY||document.documentElement.scrollTop||0),maxY:Math.max(0,document.documentElement.scrollHeight-window.innerHeight)};
  };
  let lastY=getMetrics().y;
  let raf=0, idleTimer=0;
  const reduced=()=>window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const restore=()=>{nav.classList.remove("nav-scroll-hide","nav-scroll-shrink");nav.style.removeProperty("--bn-translate");};
  const hide=()=>{if(reduced())return restore();nav.classList.remove("nav-scroll-shrink");nav.classList.add("nav-scroll-hide");};
  const apply=()=>{
    raf=0;
    const {y,maxY}=getMetrics(), delta=y-lastY;
    const chatOpen=document.body.classList.contains("chat-full-page");
    if(chatOpen){ restore(); return; }
    const special=document.body.classList.contains("profile-reveal-open")||document.body.classList.contains("profile-reveal-dragging")||nav.classList.contains("nav-hidden")||document.body.classList.contains("search-input-active");
    if(special||reduced()){restore();lastY=y;return;}
    if(Math.abs(delta)<3)return;
    lastY=y;
    if(delta>0 && y>16 && y<maxY-8) hide(); else if(delta<0 || y<=16 || y>=maxY-8) restore();
    clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>{if(delta<0||y<=16||y>=maxY-8)restore();},420);
  };
  const onScroll=()=>{if(!raf)raf=requestAnimationFrame(apply);};
  window.addEventListener("scroll",onScroll,{passive:true});
  // Only the page itself (or the chat list) matters here. Rows that auto-scroll sideways fire "scroll" constantly, and each one
  // used to force a full-page layout just to read the scroll position.
  document.addEventListener("scroll",(e)=>{ const t=e.target; if(t!==document && t!==document.documentElement && !(t&&t.classList&&t.classList.contains("chat-messages"))) return; onScroll(); },{passive:true,capture:true});
  window.addEventListener("resize",()=>{lastY=getMetrics().y;restore();},{passive:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){lastY=getMetrics().y;restore();}});
}

// A floating cart button, docked near Levi's FAB, is easier to notice
// than a nav-tab would be without adding a 6th cramped item to the
// already-full buyer bottom nav.
function initFloatingScrollVisibility(){
  if (window.__leviCartScrollReady) return;
  if (getLevromartMotionPreference()==="calm") return;
  window.__leviCartScrollReady = true;
  let lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  let timer = 0;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    const delta = y - lastY;
    if (Math.abs(delta) >= 2 && y > 20) {
      byId('aiChatFab')?.classList.add('scroll-faded');
      byId('cartFab')?.classList.add('scroll-faded');
      lastY = y;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      byId('aiChatFab')?.classList.remove('scroll-faded');
      byId('cartFab')?.classList.remove('scroll-faded');
      lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    }, 260);
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(apply); }, {passive:true});
  ['aiChatFab','cartFab'].forEach(id => byId(id)?.addEventListener('click', () => byId(id)?.classList.remove('scroll-faded'), {passive:true}));
}

function updateCartFab() {
  // The cart lives in the header now (master UI/UX spec, Part 3: "the cart
  // must NOT float over the homepage"), permanently beside Messages, for
  // both buyers and vendors (a vendor is also a buyer). The floating
  // draggable FAB is kept out of the render path rather than deleted
  // outright, so its badge-count logic below stays the single source of
  // truth for both surfaces without duplicating it.
  const fab = byId("cartFab");
  if (fab) fab.classList.add("hidden");

  const showCart = !!session && profile?.role !== "admin";
  const headerWrap = byId("headerCartWrap");
  if (headerWrap) headerWrap.classList.toggle("hidden", !showCart);
  const headerBadge = byId("headerCartBadge");
  if (headerBadge) {
    headerBadge.textContent = buyerCartCount > 9 ? "9+" : buyerCartCount;
    headerBadge.classList.toggle("hidden", buyerCartCount === 0);
  }

  const badge = byId("cartFabBadge");
  if (badge) {
    badge.textContent = buyerCartCount > 9 ? "9+" : buyerCartCount;
    badge.classList.toggle("hidden", buyerCartCount === 0);
  }
}
function requireLoginThen(view) {
  if (!session) { showLogin(); return; }
  navigate(view);
}

function showLogin() { authMode = "login"; applyAuthMode(); byId("loginModal").classList.remove("hidden"); trackModalOpened("loginModal"); }
function hideLogin() {
  byId("loginModal").classList.add("hidden");
  byId("authError").classList.add("hidden");
  if (dismissibleModalId === "loginModal") dismissibleModalId = null;
}
function toggleAuthMode() { authMode = authMode === "login" ? "register" : "login"; applyAuthMode(); }
function setAuthMode(mode) { authMode = mode; applyAuthMode(); }
function applyAuthMode() {
  const isRegister = authMode === "register";
  const isForgot = authMode === "forgot";
  const signInTab = byId("authSignInTab");
  const createTab = byId("authCreateAccountTab");
  if (signInTab && createTab) {
    const signInActive = !isRegister;
    signInTab.classList.toggle("active", signInActive);
    createTab.classList.toggle("active", isRegister);
    signInTab.setAttribute("aria-selected", signInActive ? "true" : "false");
    createTab.setAttribute("aria-selected", isRegister ? "true" : "false");
  }
  byId("authModalTitle").innerHTML = isForgot
    ? "<i class='fa-solid fa-key'></i> Reset your password"
    : isRegister ? "<i class='fa-solid fa-user-plus'></i> Create your Levromart account" : "<i class='fa-solid fa-right-to-bracket'></i> Welcome back to Levromart";
  byId("signupExtraFields").classList.toggle("hidden", !isRegister);
  byId("googleAuthWrap").classList.toggle("hidden", isForgot);
  byId("loginPasswordWrap").classList.toggle("hidden", isForgot);
  byId("confirmPasswordWrap").classList.toggle("hidden", !isRegister);
  byId("forgotPasswordMsg").classList.toggle("hidden", !isForgot);
  byId("authAgreementMsg").classList.toggle("hidden", !isRegister);
  byId("forgotPasswordLinkWrap").classList.toggle("hidden", isRegister || isForgot);
  byId("authSubmitBtn").textContent = isForgot ? "Send reset link" : isRegister ? "Create account" : "Login";
  byId("authToggleLink").textContent = "Back to login";
  byId("authToggleLink").onclick = (e) => { e.preventDefault(); isForgot ? setAuthMode("login") : toggleAuthMode(); };
  byId("authToggleLink").parentElement?.classList.toggle("hidden", !isForgot);
  byId("authError").classList.add("hidden");
}

// Only one active login per account: right after a successful sign-in,
// revoke every other device/browser's session for this user (their end
// only actually logs out once it next tries to refresh its token - see
// the onAuthStateChange listener below for the "signed out elsewhere"
// message that fires when that happens).
let manualLogout = false;

// Redirects away to Google and back -- Supabase picks the returned session
// up automatically (detectSessionInUrl is on by default), which fires the
// same onAuthStateChange listener as any other login, so no separate
// "handle the OAuth callback" code is needed here. First-time Google
// sign-ins default to the customer role via the handle_new_user trigger,
// same as leaving "I am a…" on its default during a normal signup --
// anyone who actually wants to sell can still apply as a vendor
// afterward, same as always.
async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) showToast(error.message, "error");
}
function togglePasswordVisibility(inputId, button) {
  const input = byId(inputId);
  if (!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button?.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  button?.setAttribute("title", showing ? "Show password" : "Hide password");
  const icon = button?.querySelector("i");
  if (icon) icon.className = `fa-regular ${showing ? "fa-eye" : "fa-eye-slash"}`;
}

function friendlyAuthErrorMessage(err) {
  const raw = String(err?.message || "").toLowerCase();
  // The single biggest cause of a genuinely correct password still failing
  // here is an account that has no password at all -- it was created via
  // Google, which never sets one. The generic message left people typing
  // the same (nonexistent) password over and over with no way to know why.
  if (raw.includes("invalid login credentials")) return "Incorrect email/phone or password. If you signed up with Google, tap \"Continue with Google\" below instead, or use \"Forgot password?\" to set one for the first time.";
  if (raw.includes("email not confirmed")) return "This email hasn't been confirmed yet.";
  if (raw.includes("user already registered") || raw.includes("already registered")) return "An account with this email or phone already exists.";
  const __f = window.__levroClassifyBackendError ? window.__levroClassifyBackendError(err?.message) : null;
  if (__f) return __f.text;
  return err?.message || "Something went wrong. Please try again.";
}
async function submitAuth() {
  const email = byId("loginEmail").value.trim();
  const password = byId("loginPassword").value;
  const errorEl = byId("authError");
  errorEl.classList.add("hidden");

  if (authMode === "forgot") {
    if (!email) { errorEl.textContent = "Enter your email address."; errorEl.classList.remove("hidden"); return; }
    const btn = byId("authSubmitBtn");
    btn.disabled = true;
    try {
      // Resend is now wired in as Supabase Auth's SMTP provider, so the
      // native emailed-link flow (handled by the PASSWORD_RECOVERY listener
      // above) is reliable again -- no more routing this through an admin
      // for manual approval.
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      hideLogin();
      showToast("If an account exists for that email, we've sent a link to reset your password.", "success");
    } catch (err) {
      errorEl.textContent = err.message || "Could not send the password reset email.";
      errorEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (!password) { errorEl.textContent = "Password is required."; errorEl.classList.remove("hidden"); return; }
  if (authMode !== "register" && !email) { errorEl.textContent = "Enter your email address or phone number."; errorEl.classList.remove("hidden"); return; }

  const btn = byId("authSubmitBtn");
  btn.disabled = true;
  // show at once that something is happening (the steps behind can take a few seconds on a slow network)
  const __btnHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (authMode === "register" ? "Creating your account…" : "Signing you in…");

  try {
    if (authMode === "register") {
      const name = byId("loginName").value.trim();
      const role = byId("loginRole").value;
      const city = byId("loginCity").value.trim();
      const phone = byId("loginPhone").value.trim();

      if (!name) throw new Error("Full name is required.");
      if (!phone) throw new Error("Phone is required.");
      if (!window.__lvSignupCampus) throw new Error("Choose your campus (or pick \"Not on a campus\").");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== byId("loginPasswordConfirm").value) throw new Error("Passwords don't match.");

      // Account creation is handled by the single existing Vercel function.
      // The server creates the Auth user with email_confirm:true, so there is
      // NO confirmation-email step: create the account and continue immediately.
      const registerRes = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          email,
          password,
          name,
          phone,
          city,
          role,
          referral_code: String(byId("loginReferral")?.value || "").trim()
        })
      });

      const registerBody = await registerRes.json().catch(() => ({}));
      if (!registerRes.ok) {
        throw new Error(registerBody.error || "Could not create your account.");
      }

      // The account is already confirmed by the server, so sign in immediately.
      try {
        sessionStorage.setItem("levromart-just-registered", "1");
        if (String(role).toLowerCase() === "vendor") sessionStorage.setItem("levromart-new-vendor-applicant", "1");
      } catch (_) {}
      const loginEmail = email || authAliasFromPhone(phone);
      const { error: loginError } = await sb.auth.signInWithPassword({
        email: loginEmail,
        password
      });
      if (loginError) throw loginError;
      window.__lvFreshSignIn = Date.now();
      // the campus is saved in the background: the person does not wait for it
      try { const __cp = window.__lvSignupCampus; if (__cp) Promise.resolve(window.lvSaveCampus(__cp)).catch(() => {}); } catch (_) {}
      if (registerBody?.referral?.ok) {
        try { localStorage.removeItem("levro-ref-code"); } catch (_) {}
        setTimeout(() => showToast(`Referral applied. You joined with ${registerBody.referral.business_name}'s code.`, "success"), 1200);
      }

      await finishLoginSuccess(role === "vendor" ? "vendorApply" : "home");
    } else {
      let loginEmail = email;
      if (looksLikePhoneIdentifier(email)) {
        loginEmail = authAliasFromPhone(email);
      }
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;
      window.__lvFreshSignIn = Date.now();
      // The OTP check (and role-select / set-password, if either is still
      // pending on this account) all now run from inside finishLoginSuccess
      // -> refreshAuthStateOnce -> runPostAuthChecks, one shared sequence
      // for every sign-in path (password, Google, and a returning session
      // past its 7-day OTP window) instead of duplicating the check here.
      await finishLoginSuccess("home");
    }
  } catch (err) {
    // Every other validation branch in this function shows the inline
    // authError box with .remove("hidden") -- this one instead did
    // .add("hidden"), so a wrong password or bad email/phone silently hid
    // the error box instead of showing it, leaving only a toast (easy to
    // miss/auto-dismiss) as the sole feedback that login had failed.
    errorEl.textContent = friendlyAuthErrorMessage(err);
    errorEl.classList.remove("hidden");
    showToast(friendlyAuthErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = __btnHtml;
  }
}

async function finishLoginSuccess(view) {
  await refreshAuthStateOnce();

  let justRegistered = false;
  try { justRegistered = sessionStorage.getItem("levromart-just-registered") === "1"; if (justRegistered) sessionStorage.removeItem("levromart-just-registered"); } catch (_) {}
  if (justRegistered) {
    // New accounts start with Levromart's own location setting enabled. The
    // browser/device still owns the real permission and will show its prompt
    // when the request is made. If permission is denied, use our recovery UI.
    locationSharingEnabled = true;
    try { localStorage.setItem("medris-location-enabled", "1"); } catch (_) {}
    setAutomaticDistancePreference(true);
    setTimeout(async () => {
      if (!session || !profile || !navigator.geolocation) return;
      try {
        await getCustomerLocation(true);
        updateVendorsLocationUI();
      } catch (err) {
        const state = await getBrowserLocationPermission();
        showLocationPrompt("recovery", state === "denied" ? locationRecoveryText("denied") : (err?.message || "Allow Levromart to access your location so nearby vendors can be shown automatically."));
      }
    }, 500);
  }

  // Only refresh buyer location automatically after the customer has explicitly
  // opted into the one-time automatic-distance preference. This prevents a
  // fresh login from unexpectedly triggering a browser location prompt.
  if (buyerDistanceAutoEnabled && locationSharingEnabled && navigator.geolocation) {
    scheduleAutomaticLocationRefresh();
  }
  hideLogin();
  // Vendor applicants go directly into the existing application route after
  // the authenticated account is established; the renderer itself checks for
  // an existing vendor/application row and redirects to the dashboard instead.
  let postSignupView = view;
  try {
    if (sessionStorage.getItem("levromart-new-vendor-applicant") === "1") {
      postSignupView = "vendorApply";
      sessionStorage.removeItem("levromart-new-vendor-applicant");
    }
  } catch (_) {}
  try {
    if (justRegistered && postSignupView === "home") postSignupView = "profileSetup";
    else if (postSignupView === "home" && vendor && profile?.role !== "admin" && !lvSetupSeen() && !vendor.cover_url && !profile?.avatar_url) postSignupView = "profileSetup";
  } catch (_) {}
  navigate(postSignupView);
  awaitingInstallPromptForLogin = true;
  setTimeout(maybeShowInstallPrompt, 800);
  setTimeout(maybeShowNotifPrompt, 1600);
}

// Admin-only email OTP, required after the password on every fresh login
// (not on ordinary page reloads). See api/send-login-otp.js /
// verify-login-otp.js - this account has real power (approve/delete
// vendors, finance access), so it gets the extra step; buyer/vendor
// accounts don't have anything worth adding that friction for.
let pendingOtpAccessToken = null;

async function submitLoginOtp() {
  const code = byId("otpInput").value.trim();
  const errorEl = byId("otpError");
  errorEl.classList.add("hidden");
  if (!code) { errorEl.textContent = "Enter the 6-digit code."; errorEl.classList.remove("hidden"); return; }
  const btn = byId("otpSubmitBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/auth-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", accessToken: pendingOtpAccessToken, code }),
    });
    const json = await res.json();
    if (!json.ok) { errorEl.textContent = json.error || "That code didn't work."; errorEl.classList.remove("hidden"); return; }
    byId("otpModal").classList.add("hidden");
    pendingOtpAccessToken = null;
    // Fresh sign-in still has the login modal up (and nothing rendered
    // behind it worth keeping) -- send it to Home/adminPanel like any other
    // login. A standing session that just hit its 7-day OTP window is
    // already sitting on a real page, so just re-render exactly that page
    // instead of yanking them somewhere else.
    if (byId("loginModal") && !byId("loginModal").classList.contains("hidden")) {
      await finishLoginSuccess(profile?.role === "admin" ? "adminPanel" : "home");
    } else {
      await refreshAuthStateOnce();
      navigate(currentView || "home", currentViewParams || {}, false);
    }
  } catch (err) {
    errorEl.textContent = "Couldn't verify that code. Try again.";
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

