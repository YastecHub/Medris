// ---------- SUPABASE ----------
// Public project URL + anon key - safe to expose client-side. Row Level
// Security on every table is what actually protects the data; this key
// alone cannot bypass it. Never put the service-role key or a payment
// provider's secret key in client-side code like this file.
const SUPABASE_URL = "{{env:VITE_SUPABASE_URL}}";
const SUPABASE_ANON_KEY = "{{env:VITE_SUPABASE_ANON_KEY}}";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, window.__levroSafeFetch ? { global: { fetch: window.__levroSafeFetch } } : undefined);
// sb.rpc(...) calls go to the backend (POST /api/v1/rpc/{name}); see src/bridge/rpc-shim.ts.
try { if (window.levroData && window.levroData.installRpc) window.levroData.installRpc(sb); } catch (_) {}
// Live updates (sb.channel) go to the backend's socket once it delivers row changes; see src/bridge/live-shim.ts.
try { if (window.levroData && window.levroData.installLive) window.levroData.installLive(sb); } catch (_) {}
// Any write to cart_items marks the cached cart count stale, so the badge still updates at once.
try {
  const __sbFrom = sb.from.bind(sb);
  sb.from = (table) => {
    const q = __sbFrom(table);
    if (table === "notifications") ["insert", "update", "delete", "upsert"].forEach((m) => { const orig = q[m]; if (typeof orig === "function") q[m] = (...a) => { window.__notifRaw = null; return orig.apply(q, a); }; });
    if (table === "vendor_follows") ["insert", "update", "delete", "upsert"].forEach((m) => { const orig = q[m]; if (typeof orig === "function") q[m] = (...a) => { window.__followerCountMemo = null; return orig.apply(q, a); }; });
    if (table === "cart_items") ["insert", "update", "delete", "upsert"].forEach((m) => { const orig = q[m]; if (typeof orig === "function") q[m] = (...a) => { window.__cartCountAt = 0; return orig.apply(q, a); }; });
    return q;
  };
} catch (_) {}

