// ---------- INIT ----------
// Fires on sign-in, sign-out, and token refresh - including the background
// sign-in Supabase performs when a user lands here via an email
// confirmation link. Re-running the full profile lookup (not just the bare
// session) is what keeps the header in sync with that background event.
let __authRefreshInFlight = null;
function refreshAuthStateOnce() {
  if (!__authRefreshInFlight) {
    __authRefreshInFlight = refreshAuthState().finally(() => { __authRefreshInFlight = null; });
  }
  return __authRefreshInFlight;
}

