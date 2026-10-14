# React migration plan and screen inventory

*Status: PR 1 of 4 (inventory and plan). Documentation only: no application code is changed by this pull request. Updated after PRs 2-4 (#7 tests, #8 registry, #9 pilot) were opened.*

This document is the working map for moving the Levromart frontend from the legacy runtime to React, **one screen at a
time, without changing what any screen does or looks like**. It follows the strangler pattern described in the task
brief and the rules in `AGENTS.md` and `.agent/rules/` (frontend-specialist, architect, test-engineer,
accessibility-reviewer, performance-optimizer, git-workflow, project-context).

How it was produced: the legacy sources were read in the exact order the page loads them (`src/legacy/document.json`,
116 script units), every definition of every screen renderer was located (later definitions win), and the queries,
calls and storage keys inside each renderer, its event handlers and the helpers it calls were extracted with a script
and then checked by hand for the first screens to migrate. **The data columns are a static scan, not a trace of a
running app**: a query built from a string, or reached through more than one helper hop, can be missing. Treat every
row as "verified when the screen is migrated" (each migration pull request must re-check its own row and update this
file).

File references are `path:line` relative to `medris-frontend/`; `…/js/` stands for `src/legacy/assets/js/`.

## 0. Contents

1. What exists today (verified facts)
2. The view inventory (59 routes)
3. The first-wave screens in detail
4. Migration order
5. Design: view registry, switches and hooks
6. Testing approach
7. Progress table
8. Open questions

---

## 1. What exists today (verified facts)

### 1.1 How the app is put together

- `src/main.tsx` is a small React 19 + TypeScript entry. It runs as a module script after the legacy document has been
  parsed and mounts `<App/>` (which renders nothing yet) into `#medris-root`, a node the build appends at the end of the
  document. It imports no CSS on purpose: the legacy stylesheets define the whole look.
- The real app is the **legacy runtime**: classic scripts and stylesheets that share globals and rely on parse order.
  `build/legacy-document.ts` assembles them, unchanged, in the order of `src/legacy/document.json` (39 pieces: inline
  scripts, markup and 20 external files). `assets/js/01-app.js` is the concatenation of the 88 section files in
  `…/js/01-app/`. Things that run before the app: the data gateway (`src/bridge/data-gateway.ts`, compiled to a classic
  script and inlined just before the runtime), the Supabase client script from a CDN (`unpkg`, falling back to
  `jsdelivr`), `lib/compress-image.js`.
- The Supabase client is the global `sb` (`…/js/01-app/02-supabase.js:7`), created with `window.__levroSafeFetch` as its
  fetch when that exists, and with a small wrapper on `sb.from(...)` that clears caches after writes to
  `notifications`, `vendor_follows` and `cart_items`. **React must reuse this `sb`** (the gateway already does:
  `declare const sb: SupabaseClient;` in `src/bridge/data-gateway.ts`). Top-level `let`/`const` of the classic scripts
  (`session`, `profile`, `vendor`, `currentView`, …) are reachable from module code by name in the same way.
- Light/dark theme (`medris-theme`, attribute `data-theme` on `:root`), accent colour (`medris-accent`), font scale
  (`levromart-font-scale`), campus scope (`lv-view-campus`, `lv-campus`) are all read by CSS or by legacy code; React
  screens must not replace them, only use the same classes.

### 1.2 Routing: `navigate(view, params, pushHistory)`

`navigate` is declared once at `…/js/01-app/30-navigation.js:174` and then **wrapped** by later scripts. Each wrapper
does a small extra job and then calls the previous one, so the core is always the function that renders:

| Order | Where | What the wrapper adds |
|---|---|---|
| 1 (core) | `…/js/01-app/30-navigation.js:174` | everything below |
| 2 | `…/js/09-part.js:131-134` | stops the chat fallback poller unless opening a conversation |
| 3 | `…/js/09-part.js:1411-1413` | pass-through (kept for an old admin tab fix) |
| 4 | `…/js/11-levromart-global-broken-image-fallback.js:359-362` | resets the orders rail scroll when leaving orders |
| 5 | `…/js/11-levromart-global-broken-image-fallback.js:394-398` | remembers/restores the conversation-list scroll |
| 6 | `…/js/12-lv-onboarding-auth-js.js:321-331` | remembers vendors opened from the search page (installed at load and again on `window.load`) |
| 7 (outermost) | `…/js/12-lv-onboarding-auth-js.js:494-497` | sets `body[data-view]` for admin styling |

What the core does, in order (all of it must keep working for a React screen):

1. `levroCommissionGate(view)` (`:130`): for vendors whose commission is overdue, redirects `vendorDashboard`,
   `vendorEditProfile`, `vendorProducts`, `vendorPackages`, `vendorSuggestionsInbox`, `settings` to the payment screen.
2. Leaving `notifications` commits the notifications that were visible as read (`commitPendingNotificationReads`).
3. Destroys the vendors map (`vendorsMap.remove()`) when leaving `vendors`; closes a chat realtime channel when leaving
   `messages`.
4. A suspended account is forced to the `suspended` view; non-super-admins asking for a super-admin view are sent to
   `adminDisputes` (`SUPER_ADMIN_ONLY_VIEWS`, `…/js/01-app/80-admin.js:6`).
5. Protected views wait (bounded, 1.2 s) for the session to be restored so the "Access denied" guard does not flash
   (`protectedRouteViews`, `:230`).
6. Sets `currentView`/`currentViewParams`, link-preview meta, and the body classes `chat-full-page`,
   `search-full-page`, `product-detail-view`.
7. `history.pushState({view, params}, "", url)` when `pushHistory` is true (`:313`). URLs: `?storefront=<id>`,
   `?package=<id>`, `?product=<id>`, `?levro=notifications`, otherwise `?appView=<view>&appParams=<json>`.
   Also stores `sessionStorage["medris_last_view"]` and calls `__levromartPersistedRoute`.
8. Paints something at once: the in-memory `routeHtmlCache`, a persisted HTML snapshot
   (`levromart-route-html-v2:<view>:<params>` in `sessionStorage` **and** `localStorage`, up to 500 KB), or a skeleton
   shell (`navigationShellHtml`). Home is cache-first (`paintHomeFromLocalCatalog`).
9. **Renders: `switch (view) { case "home": html = await renderHome(); … }`** (`:365-424`). Unknown views fall back to
   Home. If a protected renderer returns the "Access denied" guard, auth is refreshed once and the renderer is run again
   (`:425-470`). Errors fall back to the cached HTML or a retry card.
10. `app.innerHTML = html`, then the per-view follow-up work: storefront follow-button carry-over and extras
    hydration, `renderNotifPanel()` for notifications, `initLeaderboardPage()`, `initAdminPoints()`, dispute evidence,
    Home leaderboard card, comment counts, variant indicators, product ratings, `hydrateSettingsPage()`, search focus,
    carousels, gallery swipe, delivery fields, `applyHorizontalBrowsePreference()`, auto-scroll rails.
11. Scroll handling: same-view refreshes keep the scroll position, Back to Home restores it, profile pages keep theirs,
    everything else scrolls to the top; then `__levromartRestoreScroll(view)` for reloads.

Other pieces that touch every screen:

- **Back button / deep links.** One `popstate` listener (`…/js/01-app/88-modal-back-button-outside-click-dismissa.js:44`)
  first closes a modal or selection mode, otherwise calls `navigate(e.state.view, e.state.params, false)`. `init()` (same
  file, `:56`) resumes from `?appView=`, `?product=`, `?storefront=`, `?package=` and `?levro=` (notification and
  carousel links), and a script at the top of the document stores `?ref=` as `levro-ref-code`
  (`src/legacy/scripts/001-inline.js:1`, again `…/js/11-…fallback.js:749`). Notifications carry `target_view` /
  `target_params`, read in `…/js/09-part.js:13`, `…/js/01-app/20-notifications-real-persisted-realtime.js:169,221,283`
  and the push-click handler in `…/js/08-levromart-chat-viewport-stabilizer-20260.js:1637-1655`.
- **`Element.prototype.innerHTML` is patched** (`…/js/14-motion.js:5` and `:47`): page swaps are animated and lists
  inside `#vendorsGrid`, `#productGrid` and `#vendorCatChips` are updated card by card. React must not rely on
  `innerHTML` for its own output and must be checked against these patches.
- **MutationObservers on `#app`** (for example the commission countdown, `…/js/07-levromart-final-qa-20260909-js.js:822`),
  `popstate` listeners (`…/js/12-lv-onboarding-auth-js.js:799`, `…/js/14-motion.js:9`) and listeners for a
  `levromart:view-rendered` event (`…/js/07-…:835,912`, `…/js/08-…:1663`, `…/js/10-…:877,899`, `…/js/12-…:2203`).
  No place that dispatches that event was found by search; **to be confirmed in PR 3** before a React view relies on it.
- **Service worker** `src/service-worker/sw.js` (360 lines): shell cache named with the asset version, a runtime cache,
  image caching, push notification display and click handling. A change to legacy code only reaches installed apps after
  `bump-version`.
- **Realtime channels** found (all created from legacy code): `notifications-<user>` and `marketplace-<user>`
  (`…/js/01-app/20-notifications-real-persisted-realtime.js:459,556`), `orders-live-*`, `order-extras-*`, `requests-live-*`
  (`…/js/01-app/21-live-orders.js:156-171`), `conv-<id>` (`…/js/01-app/54-whatsapp-style-message-actions-selection.js:559`),
  `product-comments-<id>` / `package-comments-<id>` (`…/js/01-app/62-product-package-social-interactions.js:45,53`),
  `levro-inline-<kind>-comments-<id>` (`…/js/08-…:1784`), `voicecall-<id>` (`…/js/11-…:527`), `lb-live-*` (`…/js/11-…:1264`),
  `cc-*` (`…/js/12-…:864`).
- **Server calls** from legacy code: `/api/delete-account` (also serves link previews and account checks via rewrites in
  `vercel.json`), `/api/notify`, `/api/vendor-payments` (payments, R2 upload presign, application finishing),
  `/api/auth-otp`, `/api/order-payout-action`, `/api/initiate-payment`, `/api/verify-payment`, `/api/chat` (Levi AI),
  `/api/turn`.
- **localStorage keys** with a fixed name (35): `levi-voice`, `levro-convs-v1:`, `levro-dt-tip-v1`, `levro-ref-code`, `levro-seen-v1:`, `levromart-ai-chat-expanded`, `levromart-font-scale`, `levromart-levi-wake`, `levromart-notif-prompt-v2`, `levromart-permission-nudge-seen-v2`, `levromart-tour-seen`, `levromart-vendor-listing-tab`, `levromart_ai_panel_pos`, `levromart_levi_ask_last`, `levromart_manual_password_reset`, `levromart_review_completed_v1`, `levromart_vendors_view`, `lv-campus`, `lv-campus-pending`, `lv-hidden-comments`, `lv-no-thumbs`, `lv-sv-pending`, `lv-vendor-ops`, `lv-vendor-ops-pending`, `lv-view-campus`, `lv_session_only`, `medris-accent`, `medris-ai-last-conversation`, `medris-distance-auto`, `medris-install-dismissed`, `medris-levi-fab-size`, `medris-levi-visible`, `medris-location-enabled`, `medris-notif-dismissed`, `medris-theme`. Dynamic keys also exist:
  `levromart-route-html-v2:*`, `levromart-order-route-v1:*`, `levro-cache:*` (session), `sb-*` (Supabase session).
- **sessionStorage keys:** `medris_last_view`, `levromart-just-registered`, `levromart-new-vendor-applicant`,
  `levromart-force-vendor-application`, `levromart-pending-listing-draft`, `levromart-pending-listing-reference`,
  `levromart-google-role-selection-pending`, `levromart-request-offers-seen-at`, `lv-campus-skip`, `lv-r2-bad`, `lv_alive`.

### 1.3 Safety net that exists today

`tests/legacy-baseline.json` pins every legacy file byte for byte; changing `src/legacy/` needs
`npm run bump-version -w medris-frontend -- <n>` and `npm run legacy:rebaseline -w medris-frontend`. CI runs typecheck,
lint, legacy syntax, tests and the Vercel build. There are **no browser tests yet** and no component tests: PR 2 adds them
before anything is converted.

### 1.4 Things in the repository that do not match the brief or the comments

- `src/app/App.tsx` mentions `docs/FRONTEND.md` ("Migrating a screen"); **that file does not exist** in `docs/`. This
  document will take its place.
- The brief says "navigate() (last definition)". The outermost definition is the `body[data-view]` wrapper at
  `…/js/12-lv-onboarding-auth-js.js:494`; it contains no rendering. See open question Q1 for where the hook should go.

---

## 2. The view inventory (59 routes)

`switch (view)` in the core `navigate` has 58 `case` labels (`customerFollowing` appears twice) and a default that renders
Home. For each view: the **last** definition of its renderer (when there are several, the earlier ones are listed and the
later ones usually wrap the earlier one), who can see it, and where it is opened from (`navigate('<view>'` call sites,
counted by file; links built from data such as notification targets are not visible to a search).

### 2.1 Routing table

| View | Renderer: last definition | Defs | Who | Opened from (files) |
|---|---|---|---|---|
| `home` | `renderHome` → `…/js/01-app/39-home-marketplace-browse.js:6` | 1 | guest | 08-levromart-chat-viewport×8, 37-homepage-promotional-ca×6, 88-modal-back-button-outsi×5, 30-navigation.js×4 |
| `productDetail` | `renderProductDetail` → `…/js/12-lv-onboarding-auth-js.js:245` (earlier: `…/js/01-app/56-product-detail.js:98`) | 2 | guest | 56-product-detail.js×4, 69-my-listings-vendor-cata×4, 41-instant-search-names-ar×3, 08-levromart-chat-viewport×3 |
| `packageDetail` | `renderPackageDetail` → `…/js/01-app/55-package-detail.js:112` | 1 | guest | 69-my-listings-vendor-cata×3, 08-levromart-chat-viewport×3, 61-request-equipment-buyer×2, 37-homepage-promotional-ca×1 |
| `storefront` | `renderStorefront` → `…/js/03-levromart-2026-09-09-vendor-logic-fixes.js:298` (earlier: `…/js/01-app/59-storefront-public-vendor-page.js:311`) | 2 | guest | 11-levromart-global-broken×5, 12-lv-onboarding-auth-js.j×5, 58-vendors-page-card-empty×4, 64-vendor-dashboard.js×4 |
| `vendors` | `renderVendorsDirectory` → `…/js/05-part.js:155` (earlier: `…/js/01-app/58-vendors-page-card-empty-state.js:156`, `…/js/03-levromart-2026-09-09-vendor-logic-fixes.js:158`) | 3 | guest | 87-levi-voice.js×3, 08-levromart-chat-viewport×2, 22-auth.js×1, 26-bottom-nav-mobile.js×1 |
| `vendorApply` | `renderVendorApply` → `…/js/09-part.js:933` (earlier: `…/js/01-app/63-vendor-application.js:19`, `…/js/03-levromart-2026-09-09-vendor-logic-fixes.js:317`, `…/js/04-levromart-vendor-location-auto-script.js:48`, `…/js/06-part.js:134`, `…/js/09-part.js:206`) | 6 | signed-in (applicant) | 22-auth.js×2, 44-wishlist.js×2, 013-inline.js×2, 24-my-details-any-logged-i×1 |
| `vendorDashboard` | `renderVendorDashboard` → `…/js/10-levromart-admin-reject-inventory-fix-js-.js:1013` (earlier: `…/js/01-app/64-vendor-dashboard.js:23`) | 2 | vendor (commission gate) | 22-auth.js×3, 09-part.js×3, 44-wishlist.js×2, 63-vendor-application.js×2 |
| `vendorEditProfile` | `renderVendorEditProfile` → `…/js/01-app/67-vendor-edit-profile.js:2` | 1 | vendor (commission gate) | 67-vendor-edit-profile.js×5, 64-vendor-dashboard.js×3, 63-vendor-application.js×2, 88-modal-back-button-outsi×2 |
| `editProfile` | `renderEditProfile` → `…/js/01-app/24-my-details-any-logged-in-buyer-vendor-s.js:84` | 1 | signed-in | 24-my-details-any-logged-i×3, 56-product-detail.js×1, 87-levi-voice.js×1 |
| `profileSetup` | `renderProfileSetup` → `…/js/01-app/25-profile-setup-first-screen-after-sign-up.js:5` | 1 | signed-in (new account) | — |
| `buyerProfile` | `renderBuyerProfile` → `…/js/01-app/24-my-details-any-logged-in-buyer-vendor-s.js:2` | 1 | signed-in | 22-auth.js×2 |
| `settings` | `renderSettingsPage` → `…/js/01-app/23-dedicated-levromart-settings-page.js:2` | 1 | signed-in (vendors: commission gate) | 22-auth.js×3, 24-my-details-any-logged-i×2, 64-vendor-dashboard.js×2, 18-slide-in-drawers.js×1 |
| `vendorProducts` | `renderVendorProducts` → `…/js/01-app/69-my-listings-vendor-catalogue-page.js:131` | 1 | vendor (commission gate) | 69-my-listings-vendor-cata×7, 64-vendor-dashboard.js×4, 22-auth.js×3, 07-levromart-final-qa-2026×2 |
| `vendorPackages` | `renderVendorPackages` → `…/js/01-app/70-vendor-packages-bundle-deals-e-g-an-outr.js:4` | 1 | vendor (commission gate) | — |
| `vendorEarnings` | `renderVendorEarnings` → `…/js/01-app/65-vendor-earnings-payout-history-so-a-vend.js:35` | 1 | vendor | 64-vendor-dashboard.js×2 |
| `vendorFollowers` | `renderVendorFollowersPage` → `…/js/01-app/44-wishlist.js:60` | 1 | vendor | 64-vendor-dashboard.js×2, 22-auth.js×1, 44-wishlist.js×1, 07-levromart-final-qa-2026×1 |
| `vendorFollowerNetwork` | `renderVendorFollowerNetwork` → `…/js/01-app/45-follower-network-vendors-only.js:16` | 1 | vendor | 45-follower-network-vendor×2 |
| `vendorOrders` | `renderVendorOrders` → `…/js/01-app/72-order-stats-today-week-month-all-time-co.js:200` | 1 | vendor | 22-auth.js×4, 72-order-stats-today-week-×2, 26-bottom-nav-mobile.js×1, 64-vendor-dashboard.js×1 |
| `buyerOrders` | `renderCustomerOrders` → `…/js/01-app/72-order-stats-today-week-month-all-time-co.js:346` | 1 | signed-in (buyer) | 22-auth.js×4, 24-my-details-any-logged-i×1, 26-bottom-nav-mobile.js×1, 76-customer-order-details-×1 |
| `orderHistory` | `renderOrderHistoryPage` → `…/js/01-app/73-order-history-page.js:12` | 1 | signed-in | 73-order-history-page.js×1 |
| `orderDetail` | `renderOrderDetail` → `…/js/01-app/77-vendor-order-details-redesigned-page.js:136` | 1 | signed-in (buyer or vendor of that order; admin read) | 78-quantity-suggestions.js×18, 56-product-detail.js×4, 83-admin-manage-admins.js×3, 10-levromart-admin-reject-×3 |
| `leaveReview` | `renderLeaveReview` → `…/js/01-app/78-quantity-suggestions.js:516` | 1 | signed-in (buyer) | — |
| `adminPanel` | `renderAdminPanel` → `…/js/01-app/82-admin-one-time-r2-image-size-pass.js:343` | 1 | admin (super-admin only) | 82-admin-one-time-r2-image×14, 09-part.js×5, 10-levromart-admin-reject-×4, 22-auth.js×1 |
| `adminCarousel` | `renderAdminCarousel` → `…/js/01-app/38-admin-link-library.js:183` | 1 | admin | 38-admin-link-library.js×7 |
| `adminR2Migration` | `renderAdminR2Migration` → `…/js/01-app/81-admin-one-time-r2-migration.js:118` | 1 | admin (super-admin only) | — |
| `adminR2Optimize` | `renderAdminR2Optimize` → `…/js/01-app/82-admin-one-time-r2-image-size-pass.js:91` | 1 | admin (super-admin only) | — |
| `adminLinkLibrary` | `renderAdminLinkLibrary` → `…/js/01-app/38-admin-link-library.js:136` | 1 | admin | 22-auth.js×1 |
| `adminDisputes` | `renderAdminDisputes` → `…/js/01-app/83-admin-manage-admins.js:705` | 1 | admin | 83-admin-manage-admins.js×4, 22-auth.js×2, 011-levromart-payment-reso×2 |
| `adminSupportRequests` | `renderAdminSupportRequests` → `…/js/01-app/82-admin-one-time-r2-image-size-pass.js:278` | 1 | admin | 22-auth.js×2, 82-admin-one-time-r2-image×1 |
| `adminPasswordResets` | `renderAdminPasswordResets` → `…/js/01-app/82-admin-one-time-r2-image-size-pass.js:182` | 1 | admin (super-admin only) | 82-admin-one-time-r2-image×3 |
| `adminInventory` | `renderAdminInventory` → `…/js/10-levromart-admin-reject-inventory-fix-js-.js:106` | 1 | admin (super-admin only) | 22-auth.js×1 |
| `adminPeople` | `renderAdminPeople` → `…/js/01-app/83-admin-manage-admins.js:5` | 1 | admin (super-admin only) | 83-admin-manage-admins.js×4, 22-auth.js×3 |
| `adminFeedback` | `renderAdminFeedback` → `…/js/01-app/83-admin-manage-admins.js:233` | 1 | admin | 22-auth.js×3 |
| `vendorSuggestionsInbox` | `renderVendorSuggestionsInbox` → `…/js/01-app/83-admin-manage-admins.js:245` | 1 | vendor (commission gate) | 22-auth.js×2, 64-vendor-dashboard.js×1 |
| `adminUsers` | `renderAdminUsers` → `…/js/01-app/83-admin-manage-admins.js:257` | 1 | admin (super-admin only) | 83-admin-manage-admins.js×2, 22-auth.js×1 |
| `adminFinance` | `renderAdminFinance` → `…/js/01-app/83-admin-manage-admins.js:424` | 1 | admin | 22-auth.js×1, 26-bottom-nav-mobile.js×1 |
| `adminCampuses` | `renderAdminCampuses` → `…/js/12-lv-onboarding-auth-js.js:2098` | 1 | admin | 12-lv-onboarding-auth-js.j×1 |
| `adminLog` | `renderAdminLog` → `…/js/01-app/83-admin-manage-admins.js:363` | 1 | admin (super-admin only) | 22-auth.js×2 |
| `adminAuthLogs` | `renderAdminAuthLogs` → `…/js/01-app/83-admin-manage-admins.js:337` | 1 | admin | 83-admin-manage-admins.js×1 |
| `adminConversations` | `renderAdminConversations` → `…/js/01-app/83-admin-manage-admins.js:317` | 1 | admin | 22-auth.js×1, 51-chat-snapshots-instant-×1, 83-admin-manage-admins.js×1 |
| `adminMonthlyListings` | `renderAdminMonthlyListings` → `…/js/01-app/82-admin-one-time-r2-image-size-pass.js:124` | 1 | admin (super-admin only) | 82-admin-one-time-r2-image×3, 22-auth.js×1 |
| `wishlist` | `renderWishlist` → `…/js/01-app/44-wishlist.js:2` | 1 | signed-in | 22-auth.js×3, 24-my-details-any-logged-i×1, 37-homepage-promotional-ca×1 |
| `customerFollowing` | `renderCustomerFollowing` → `…/js/01-app/44-wishlist.js:17` | 1 | signed-in | 22-auth.js×2, 24-my-details-any-logged-i×1, 44-wishlist.js×1 |
| `cart` | `renderCart` → `…/js/01-app/46-cart-buy-and-sale-items-only-grouped-by.js:29` | 1 | signed-in (buyer/vendor) | 46-cart-buy-and-sale-items×5, 87-levi-voice.js×3, 37-homepage-promotional-ca×1, 03-levromart-2026-09-09-ve×1 |
| `messages` | `renderMessages` → `…/js/01-app/51-chat-snapshots-instant-open-works-withou.js:89` | 1 | signed-in (admin: read-only viewer) | 50-custom-chat-lists-whats×5, 48-suggestion-box.js×4, 22-auth.js×2, 49-chat-row-selection.js×2 |
| `notifications` | `renderNotificationsPage` → `…/js/01-app/29-dedicated-notifications-page.js:2` | 1 | signed-in | 07-first-visit-app-tour-li×1, 18-slide-in-drawers.js×1, 22-auth.js×1, 26-bottom-nav-mobile.js×1 |
| `requestEquipment` | `renderRequestEquipment` → `…/js/01-app/61-request-equipment-buyers-post-needs-vend.js:2` | 1 | signed-in (buyer) | 60-request-form-handlers.j×2, 61-request-equipment-buyer×2, 22-auth.js×1, 24-my-details-any-logged-i×1 |
| `supportRequest` | `renderSupportRequest` → `…/js/01-app/59-storefront-public-vendor-page.js:557` | 1 | signed-in | 22-auth.js×2, 59-storefront-public-vendo×2, 85-legal-pages.js×2, 24-my-details-any-logged-i×1 |
| `contactUs` | `renderContactUs` → `…/js/01-app/59-storefront-public-vendor-page.js:526` | 1 | guest | 22-auth.js×3 |
| `leaderboard` | `renderLeaderboard` → `…/js/11-levromart-global-broken-image-fallback.js:847` | 1 | guest | 22-auth.js×3, 11-levromart-global-broken×1, 12-lv-onboarding-auth-js.j×1 |
| `adminPoints` | `renderAdminPoints` → `…/js/11-levromart-global-broken-image-fallback.js:1358` | 1 | admin | 22-auth.js×1, 11-levromart-global-broken×1 |
| `search` | `renderSearchPage` → `…/js/01-app/40-dedicated-search-page.js:37` | 1 | guest | 09-auth-identifier-helpers×1, 86-floating-ai-chat-dragga×1 |
| `vendorRequests` | `renderVendorRequests` → `…/js/01-app/61-request-equipment-buyers-post-needs-vend.js:76` | 1 | vendor | 12-lv-onboarding-auth-js.j×2, 22-auth.js×1, 26-bottom-nav-mobile.js×1, 61-request-equipment-buyer×1 |
| `terms` | `renderTerms` → `…/js/01-app/85-legal-pages.js:2` | 1 | guest | — |
| `privacy` | `renderPrivacy` → `…/js/01-app/85-legal-pages.js:55` | 1 | guest | — |
| `refundPolicy` | `renderRefundPolicy` → `…/js/01-app/85-legal-pages.js:100` | 1 | guest | 85-legal-pages.js×1 |
| `sharedAiChat` | `renderSharedAiChat` → `…/js/01-app/86-floating-ai-chat-draggable.js:180` | 1 | guest (share link token) | 88-modal-back-button-outsi×1 |
| `suspended` | `renderSuspendedScreen` → `…/js/01-app/27-suspended-account-screen.js:2` | 1 | signed-in (suspended account only) | 27-suspended-account-scree×1 |

Notes:
- "Defs" greater than 1 means the screen is redefined later; before migrating such a screen, read **all** definitions
  (the renderer may call the earlier one and edit its output). Examples: `renderProductDetail` (wrapped in
  `…/js/12-lv-onboarding-auth-js.js:245`), `renderStorefront` (`…/js/03-…:298`), `renderVendorApply` (six definitions).
- Views listed in `protectedRouteViews` wait for the session before rendering; the guard text
  `Access denied.` is matched by regular expression in `navigate`, so a React replacement must not print that text
  unless it really denies access (and must print it exactly the same way when it does).

### 2.2 Data, storage and realtime (static scan)

Columns: **Reads** = tables read by `sb.from()` in the renderer and the helpers it calls; **Actions** = tables written,
RPCs and `/api` calls reached from its inline event handlers (one level deep); **RPC (render)** = RPCs called while
rendering; **Realtime** = channels the screen relies on; **Storage** = `localStorage` keys read or written by the
renderer or its helpers. `—` means "not found by the scan", not "none".

| View | Reads | RPC (render) | Actions: writes / RPC / API | Realtime | Storage |
|---|---|---|---|---|---|
| `home` | `products`, `vendor_packages`, `vendors` | — | RPC: `search_product_ids` | — | — |
| `productDetail` | `products`, `service_offers` | `get_service_price_hint` | — | product-comments-<id> | — |
| `packageDetail` | `package_engagement_settings`, `vendor_packages` | — | RPC: `create_package_order` | package-comments-<id> | — |
| `storefront` | `reviews`, `vendors` | `get_vendor_follow_state`, `get_vendor_stats`, `increment_vendor_profile_view` | — | levro-inline-<kind>-comments-<id> | — |
| `vendors` | `products`, `vendors` | — | — | — | `levromart_vendors_view` |
| `vendorApply` | `vendors` | — | W: `vendors`<br>RPC: `create_notification`, `get_or_create_custom_sector`, `submit_vendor_application` | — | — |
| `vendorDashboard` | `orders`, `vendor_packages`, `vendors` | `get_favorite_counts`, `get_vendor_commission_deadline`, `get_vendor_commission_owed`, `get_vendor_follower_counts` | — | — | `levromart-vendor-listing-tab` |
| `vendorEditProfile` | `vendors` | `compute_monthly_billing_amount`, `get_vendor_commission_deadline`, `get_vendor_commission_owed` | W: `users`, `vendors`<br>RPC: `get_vendor_commission_deadline`, `get_vendor_commission_owed`, `vendor_set_storefront_active`<br>API: `/api/vendor-payments` | — | — |
| `editProfile` | — | — | W: `users` | — | — |
| `profileSetup` | — | — | W: `users` | — | — |
| `buyerProfile` | `orders` | — | — | — | — |
| `settings` | — | — | — | — | `levromart-font-scale`, `medris-levi-fab-size` |
| `vendorProducts` | `monthly_listing_submissions`, `product_variants`, `products`, `vendors` | `get_favorite_counts`, `get_vendor_product_regions` | — | — | — |
| `vendorPackages` | `vendor_packages`, `vendors` | — | W: `vendor_packages` | — | — |
| `vendorEarnings` | `orders`, `vendors` | — | — | — | — |
| `vendorFollowers` | `vendors` | — | — | — | — |
| `vendorFollowerNetwork` | `vendors` | `get_vendor_follower_network` | — | — | — |
| `vendorOrders` | `order_items`, `orders`, `vendors` | `get_orders_buyer_names` | — | orders-live-*, order-extras-* (global) | — |
| `buyerOrders` | `order_items`, `orders` | — | — | orders-live-*, order-extras-* (global) | — |
| `orderHistory` | `order_items`, `orders`, `vendors` | `get_orders_buyer_names` | — | — | — |
| `orderDetail` | `notifications`, `orders`, `service_offers`, `vendors` | `edit_pending_order`, `get_order_buyer_contact`, `vendor_dispute_reported_payment` | W: `conversations`, `reviews`<br>RPC: `confirm_service_offer_payment`, `dispute_service_offer_payment`, `edit_pending_order`, `get_or_create_conversation`, `raise_dispute`, `send_order_reminder` +3 more | orders-live-*, order-extras-* (global) | — |
| `leaveReview` | `orders`, `reviews` | — | W: `reviews` | — | — |
| `adminPanel` | `vendors` | `admin_list_locked_vendors` | RPC: `admin_permanently_delete_vendor`, `admin_restore_vendor` | — | — |
| `adminCarousel` | `homepage_carousel_slides` | — | W: `homepage_carousel_slides` | — | — |
| `adminR2Migration` | — | — | — | — | — |
| `adminR2Optimize` | — | — | — | — | — |
| `adminLinkLibrary` | — | — | — | — | — |
| `adminDisputes` | `disputes`, `orders` | — | RPC: `admin_confirm_reported_payment`, `admin_reject_reported_payment` | — | — |
| `adminSupportRequests` | `support_requests`, `users` | — | W: `support_requests` | — | — |
| `adminPasswordResets` | — | `admin_get_manual_password_reset_requests` | RPC: `admin_approve_manual_password_reset`, `admin_reject_manual_password_reset` | — | — |
| `adminInventory` | — | `admin_get_inventory` | — | — | — |
| `adminPeople` | `users` | `admin_get_pending_appeals` | — | — | — |
| `adminFeedback` | — | `get_platform_suggestions` | — | — | — |
| `vendorSuggestionsInbox` | — | `get_vendor_suggestions` | — | — | — |
| `adminUsers` | `users` | — | RPC: `admin_set_user_role` | — | — |
| `adminFinance` | — | `admin_list_transactions`, `admin_list_vendor_payouts` | — | — | — |
| `adminCampuses` | `vendors` | `admin_campus_submissions` | — | — | — |
| `adminLog` | `admin_actions` | — | — | — | — |
| `adminAuthLogs` | `auth_activity_logs`, `users` | — | — | — | — |
| `adminConversations` | — | `admin_list_conversations` | — | — | — |
| `adminMonthlyListings` | `monthly_listing_submissions`, `vendors` | — | RPC: `admin_approve_monthly_listing`, `admin_deactivate_monthly_listing`, `admin_reject_monthly_listing` | — | — |
| `wishlist` | `favorites`, `package_favorites` | — | — | — | — |
| `customerFollowing` | `vendor_follows` | — | — | — | — |
| `cart` | — | — | — | — | — |
| `messages` | `conversations`, `message_pins`, `messages` | `admin_get_conversation_participants`, `conversation_is_open`, `get_conversation_other_party`, `list_my_chat_lists`, `list_my_conversations` | — | conv-<id> (messages), voicecall-<id> (calls) | `levro-convs-v1:` |
| `notifications` | — | — | — | notifications-<user>, marketplace-<user> (global, started at sign-in) | — |
| `requestEquipment` | `equipment_requests` | — | W: `equipment_requests` | requests-live-* (global) | — |
| `supportRequest` | `support_requests` | — | W: `support_requests` | — | — |
| `contactUs` | — | — | — | — | — |
| `leaderboard` | — | — | — | lb-live-* | — |
| `adminPoints` | — | — | RPC: `admin_award_social_points`, `admin_search_points_users` | — | — |
| `search` | — | — | — | — | — |
| `vendorRequests` | `equipment_requests`, `users`, `vendors` | `sync_current_account_role` | W: `equipment_requests`, `request_offers`, `vendors` | requests-live-* (global) | — |
| `terms` | — | — | — | — | — |
| `privacy` | — | — | — | — | — |
| `refundPolicy` | — | — | — | — | — |
| `sharedAiChat` | — | `get_shared_ai_conversation` | — | — | — |
| `suspended` | — | `get_my_account_appeal` | RPC: `submit_account_appeal` | — | — |

Known gaps in the scan: tables written through helper functions two hops away, queries assembled from variables, and
screens whose body is mostly wrappers (their data lives in the earlier definition, which is scanned). The migration pull
request for each screen must replace its row with a hand-checked one.

### 2.3 Risk and ownership

Risk is about what can go wrong for a user if the React screen misbehaves, not about how hard the code is.

| Level | Meaning |
|---|---|
| Low | static or near-static, signed-out, no writes |
| Low-Medium / Medium | reads data, a few handlers, nothing that moves money or approves people |
| Medium-High | large, many handlers, writes, caches or realtime |
| High / Highest | orders, payments, commission, onboarding, chat and calls, admin approval and money |

| View | Risk | Why | Wave |
|---|---|---|---|
| `home` | Medium-High | largest screen: carousels, category rail, infinite scroll, cache-first paint, leaderboard card | 3 |
| `productDetail` | Medium-High | variants, comments realtime, add-to-cart / order buttons, gallery swipe | 3 |
| `packageDetail` | Medium-High | like productDetail, bundle items | 3 |
| `storefront` | Medium-High | follow button hydration race, comments, packages, SEO meta, deep link | 3 |
| `vendors` | Medium | owns a Leaflet map that navigate() must destroy; filters, campus scope, distances | 3 |
| `vendorApply` | Highest | onboarding, bank details, uploads | 5 |
| `vendorDashboard` | Medium-High | commission gate, billing banners | 4 |
| `vendorEditProfile` | High | payout/bank details, billing mode | 5 |
| `editProfile` | Medium | profile writes, avatar upload | 4 |
| `profileSetup` | Medium | first screen after sign-up | 4 |
| `buyerProfile` | Medium | profile hub, order counts | 4 |
| `settings` | Medium | theme, font size, accent, push, log out, delete account entry | 4 |
| `vendorProducts` | Medium-High | vendor writes, variants, image uploads | 4 |
| `vendorPackages` | Medium | vendor writes | 4 |
| `vendorEarnings` | High | payouts and commission | 5 |
| `vendorFollowers` | Medium | read | 4 |
| `vendorFollowerNetwork` | Medium | read via RPC | 4 |
| `vendorOrders` | High | orders + payments, realtime | 5 |
| `buyerOrders` | High | orders list + realtime | 5 |
| `orderHistory` | High | orders | 5 |
| `orderDetail` | Highest | payments reported/confirmed, disputes, status transitions | 5 |
| `leaveReview` | High | writes reviews, tied to payment state | 5 |
| `adminPanel` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminCarousel` | Medium-High | admin tool (back-office) | 5 |
| `adminR2Migration` | Medium-High | admin tool (back-office) | 5 |
| `adminR2Optimize` | Medium-High | admin tool (back-office) | 5 |
| `adminLinkLibrary` | Medium-High | admin tool (back-office) | 5 |
| `adminDisputes` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminSupportRequests` | Medium-High | admin tool (back-office) | 5 |
| `adminPasswordResets` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminInventory` | Medium-High | admin tool (back-office) | 5 |
| `adminPeople` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminFeedback` | Medium-High | admin tool (back-office) | 5 |
| `vendorSuggestionsInbox` | Medium | read | 4 |
| `adminUsers` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminFinance` | Highest | admin tools: vendor approval, money, accounts | 5 |
| `adminCampuses` | Medium-High | admin tool (back-office) | 5 |
| `adminLog` | Medium-High | admin tool (back-office) | 5 |
| `adminAuthLogs` | Medium-High | admin tool (back-office) | 5 |
| `adminConversations` | Medium-High | admin tool (back-office) | 5 |
| `adminMonthlyListings` | Medium-High | admin tool (back-office) | 5 |
| `wishlist` | Low-Medium | two read queries; the toggles live in other screens | 2 |
| `customerFollowing` | Low-Medium | one read query | 2 |
| `cart` | High | money: totals, delivery fees, creates orders | 5 |
| `messages` | Highest | realtime chat, calls, snapshots, notifications | 5 |
| `notifications` | Medium | live data + realtime, marks items read when you leave, select mode, push deep links | 2 |
| `requestEquipment` | Medium | writes buyer requests | 4 |
| `supportRequest` | Medium | writes tickets, attachments upload | 4 |
| `contactUs` | Low | static links; one global handler | 1 |
| `leaderboard` | Low-Medium | read-only, realtime refresh, campus scoped | 2 |
| `adminPoints` | Medium-High | admin tool (back-office) | 5 |
| `search` | Medium | history, suggestions, campus scope, full-page layout class | 3 |
| `vendorRequests` | Medium | reads/answers buyer requests, offers | 4 |
| `terms` | Low | static text, no data | 1 |
| `privacy` | Low | static text, no data | 1 |
| `refundPolicy` | Low | static text, no data | 1 |
| `sharedAiChat` | Low-Medium | read-only RPC by token | 2 |
| `suspended` | High | route lock + appeals | 5 |

---

## 3. The first-wave screens in detail

What was checked by reading the code (not only by the scan): the markup structure, handlers, ids/`data-*` attributes read
by other code, deep links, storage and realtime, and the side effects `navigate` runs for that view.

### 3.1 `terms / privacy / refundPolicy`

- **What it is:** three static HTML strings in one file (`…/js/01-app/85-legal-pages.js:2`, `:55`, `:100`). No data, no
  handlers, no ids, no storage. They show a "Last updated" date that is part of the text.
- **Reached from:** settings and sign-up screens and the legal consent dialog (`…/js/02-levromart-legal-consent-final-js.js`,
  which is a separate gate and is **not** part of this screen).
- **Must keep:** the heading structure and `legal-page` class (the CSS styles `h2/h3/p` inside it), the text exactly as
  written (a parity test compares screenshots), light and dark mode, large font scale.
- **Why it is the pilot candidate:** it exercises the whole mechanism (registry, switch, mount, unmount, theme, back
  button, scroll reset, deep link `?appView=terms` for a signed-in user) with no data and no way to harm a user.
  (Correction found while building the pilot: a signed-out visitor meets the sign-in screen first, in the legacy app too,
  and lands on Home after "Browse as guest"; `?appView=` deep links open the page only once signed in.)

### 3.2 `contactUs`

- **What it is:** a static page (`…/js/01-app/59-storefront-public-vendor-page.js:526`) with phone/email links, three social
  buttons that call the global `window.trackSocialClick`, a WhatsApp link and a button that opens `supportRequest`.
- **Must keep:** the global `trackSocialClick` call and the `navigate('supportRequest')` target; the hard-coded
  contact details must stay in one place (copy them, do not "tidy" them).

### 3.3 `notifications`

- **What it is:** `renderNotificationsPage` (`…/js/01-app/29-dedicated-notifications-page.js:2`) returns only the page
  shell; the list is filled by `renderNotifPanel()` after the HTML is in the DOM (`navigate` calls it for this view),
  from `…/js/01-app/20-notifications-real-persisted-realtime.js` (select mode, mark read, delete/archive, per-item
  navigation using `target_view` / `target_params`, realtime `notifications-<user>`).
- **ids read by other code:** `#notificationsPage` (1 file), `#notificationsPageHeaderActions` (1 file). `lastNotificationReturnView` decides what Back does.
- **Behaviour outside the screen:** leaving the screen commits pending reads (`commitPendingNotificationReads`) from
  `navigate`; the popstate handler resets `notifSelectMode`; the header bell badge is driven from the same realtime
  feed.
- **Why it is not the pilot:** real data, realtime and a write on leaving; do it after the registry has proven itself.

### 3.4 `wishlist / customerFollowing`

- Two small signed-in screens (`…/js/01-app/44-wishlist.js:2`, `:17`) reading `favorites`, `package_favorites` and
  `vendor_follows`. The heart/follow toggles live in product and storefront screens and update caches
  (`window.__followerCountMemo`, see the `sb.from` wrapper). `customerFollowing` is listed twice in the `switch`; harmless.

### 3.5 `vendors`

- Three definitions (`…/js/01-app/57-vendors-directory.js`, `…/js/01-app/58-vendors-page-card-empty-state.js`,
  `…/js/05-part.js:155` is the last). Owns a Leaflet map (`#vendorsMap`, `#vendorsMapWrap`, `#vendorsMapVendorRail`) loaded
  on demand from `unpkg`; `navigate` destroys it when you leave. Grid cards are diffed by the `innerHTML` patch in
  `14-motion.js` (`#vendorsGrid`). Filters and view mode use `levromart_vendors_view` and campus scope keys.
- **ids read by other code:** `#app` (25 files), `#vendorCatChips` (1 file), `#vendorCategoryFilter` (1 file), `#vendorCityFilter` (1 file), `#vendorSearchInput` (1 file), `#vendorSectorFilter` (1 file), `#vendorsFiltersPanel` (1 file), `#vendorsFiltersToggle` (1 file), `#vendorsGrid` (2 files), `#vendorsMap` (3 files), `#vendorsMapVendorRail` (1 file), `#vendorsMapWrap` (3 files)

### 3.6 `storefront`

- Two definitions (`…/js/01-app/59-storefront-public-vendor-page.js`, wrapper at `…/js/03-…:298`). Uses
  `window.__storefrontExtrasPending` so that follow state, stats, reviews and packages are applied **after** `navigate`
  has put the HTML in the DOM; replacing the DOM must not break that handshake. Deep link `?storefront=<id>`; sets page
  meta for link previews (`syncLevromartLinkPreviewMeta`). Calls `increment_vendor_profile_view`.
- **ids read by other code:** `#storefrontCategoryChips` (1 file), `#storefrontFollowWrap` (1 file), `#storefrontGrid` (1 file), `#storefrontMoreSheet` (1 file), `#storefrontMoreSheetRoot` (1 file), `#storefrontPackagesSection` (1 file), `#storefrontProductsCount` (1 file), `#storefrontProductsShell` (1 file), `#storefrontSearch` (1 file), `#storefrontServicesCount` (1 file), `#storefrontViewMoreWrap` (1 file), `#vendorReviews` (1 file)

### 3.7 `productDetail / packageDetail`

- `renderProductDetail` is wrapped (`…/js/12-…:245`) and adds service-offer logic (`get_service_price_hint`). Realtime
  comment channels, variant pickers, gallery swipe (`initGallerySwipeSurfaces`), `params.openComments`,
  `params.scrollToReviews`. Deep links `?product=<id>` / `?package=<id>`. Body class `product-detail-view` is set by
  `navigate`. Order and cart buttons call global handlers that write via RPCs: those stay legacy.
- **ids read by other code:** none found

### 3.8 `search`

- `renderSearchPage` (`…/js/01-app/40-dedicated-search-page.js:37`) is a shell; results, history and suggestions are
  produced by many functions in `40-…`, `41-…`, `42-…` and `…/js/08-…` (search history, `levromart:search-history-changed`).
  `navigate` focuses `#searchPageInput`, calls `renderSearchPageSuggestions()`, and toggles body class `search-full-page`.
- **ids read by other code:** `#searchPageClearBtn` (1 file), `#searchPageHistoryBlock` (2 files), `#searchPageInput` (5 files), `#searchPageResults` (4 files), `#searchScopeNote` (1 file)

### 3.9 `home`

- `renderHome` is 23 KB of render code plus nine helpers (`…/js/01-app/39-home-marketplace-browse.js:6`). Cache-first:
  `navigate` paints `paintHomeFromLocalCatalog` and an HTML snapshot before the live render; the offline cache lives in
  `35-offline-marketplace-cache.js`. The carousel (`#homePromotionalCarousel`), category rail and product grid are kept
  alive by `14-motion.js` so they do not blink; infinite scroll loads 24 items at a time.
- **ids read by other code:** `#browseCategoryLabel` (1 file), `#browseCategoryOptions` (1 file), `#browseCategorySubmenu` (2 files), `#browseFilterPanel` (2 files), `#browseFilterTrigger` (2 files), `#browseListingLabel` (1 file), `#browseListingSubmenu` (2 files), `#browseSection` (6 files), `#browseSortLabel` (1 file), `#browseSortSubmenu` (1 file), `#filterCategory` (3 files), `#filterCategorySearch` (1 file), `#filterListing` (2 files), `#homePromotionalCarousel` (1 file)

### 3.10 `leaderboard`

- Added late (`…/js/11-…:847`), campus scoped, `initLeaderboardPage()` after render, realtime `lb-live-*`.

---

## 4. Migration order

Lowest risk first, as the brief asks. A wave only starts when the previous one has been **on in production for two weeks
without problems** (or the owner says otherwise). Within a wave, one screen per pull request.

| Wave | Screens | Why this order |
|---|---|---|
| 0 | PR 1-4: plan, tests, registry, pilot | nothing is switched on for users |
| 1 | `terms`, `privacy`, `refundPolicy`, `contactUs` | static, signed-out, no writes; proves the mechanism |
| 2 | `notifications`, `wishlist`, `customerFollowing`, `leaderboard`, `sharedAiChat` | first live reads with a session; first realtime from React |
| 3 | `vendors`, `storefront`, `productDetail`, `packageDetail`, `search`, `home` | the public marketplace: read-mostly but large, cache-first, many shared ids |
| 4 | `settings`, `editProfile`, `profileSetup`, `buyerProfile`, `requestEquipment`, `supportRequest`, vendor read/management screens (`vendorDashboard`, `vendorProducts`, `vendorPackages`, `vendorFollowers`, `vendorFollowerNetwork`, `vendorRequests`, `vendorSuggestionsInbox`) | signed-in, writes that are simple and reversible |
| 5 (end, each its own carefully tested step) | `cart`, `buyerOrders`, `orderHistory`, `orderDetail`, `leaveReview`, `vendorOrders`, `vendorEarnings`, `vendorEditProfile`, `vendorApply`, `messages`, `suspended`, all `admin*` | money, orders, commission, onboarding, chat/calls, approvals |

Rules that apply to every step: same CSS classes and markup structure; same Supabase queries and RPCs with the same
arguments; business rules stay in the database; every `id` and `data-*` attribute other code reads is kept; every global
function that other legacy code calls from the markup (`onclick="..."`) keeps its name until its callers move too (a React
screen can render the same `onclick` attributes, or attach handlers that call the same global function).

**Recommended pilot: `terms`** (the Terms of Service page). It is the same size of risk as the notifications page without
any of the data: no queries, no realtime, no write on leave, no state. If the registry, the mount/unmount, the theme,
Back button, scroll reset and deep link all behave, the same machinery is then reused for `privacy`, `refundPolicy` and
`contactUs`, and only then for screens with data. The notifications page is a better *second-wave* candidate.

---

## 5. Design: view registry, switches and hooks

### 5.1 Pieces (all under `medris-frontend/src/`, TypeScript strict)

| Piece | Path | Job |
|---|---|---|
| Registry (classic script, tiny) | `bridge/view-registry.ts`, compiled and inlined next to the data gateway | answers `levroReact.isOn(view)` synchronously; holds the switch state; exposes `levroReact.render(view, params, container)` and `levroReact.unmount()` to legacy code; never imports React |
| Components | `views/<view>/index.tsx` (+ `components/`, `hooks/`, `services/`) | the screens; loaded on demand with dynamic `import()` so the legacy path does not pay for them |
| Entry | `main.tsx` / `app/App.tsx` | registers the lazy components with the registry; a `ready` promise resolves once the module script has run |
| Hooks | `hooks/useLegacySession.ts`, `useProfile.ts`, `useVendor.ts`, `useRealtime.ts` | read the **existing** `sb` and legacy state; never create a second client |
| Services | `services/` | typed wrappers around the same `sb.from(...)` / `sb.rpc(...)` calls the legacy screen makes (same table, same columns, same filters) |

The registry must be a classic script because `init()` calls `navigate` while the page is still loading, before the
module script of `main.tsx` has run (the data gateway is built the same way for the same reason).

### 5.2 The hook in `navigate`

One small, documented change in the **core** `navigate` (`…/js/01-app/30-navigation.js`), at the `switch (view)`, because
every wrapper delegates to it and it is the only function that renders (see Q1). Sketch:

```js
// REACT-REGISTRY HOOK: a migrated screen that is switched on renders into #app through React.
if (window.levroReact?.isOn(view)) {
  html = window.levroReact.placeholderHtml(view);   // '<div id="levro-react-root" data-view="…"></div>'
  reactView = view;                                  // mounted right after app.innerHTML = html
} else {
  switch (view) { …the existing cases, unchanged… }
}
```

and, directly after `app.innerHTML = html`: `if (reactView) await levroReact.mount(reactView, params, byId("levro-react-root"), navToken);`.
Everything else in `navigate` (shell, scroll, history, body classes, `hideLevromartSplash`, the per-view follow-ups) keeps
running, so the surrounding behaviour stays identical. Details that PR 3 must handle and test:

- **No stale HTML.** `routeHtmlCache` and `persistRouteHtml` store the HTML string that is put in `#app`. A React view must
  not be stored as a snapshot (the next visit would paint an empty root): skip both for views that are on.
- **Unmount cleanly.** `levroReact.unmount()` is called at the start of `navigate` (before `#app` is replaced) and on
  `pagehide`, so effects, timers and realtime subscriptions of the React screen are released. React roots are created with
  `createRoot(container)` on the placeholder, never on `#app` itself, so legacy code that does `app.innerHTML = …` is safe.
- **Stale navigations.** The mount checks `navToken !== navigationGeneration` exactly like the legacy path.
- **Auth guard retry.** The "Access denied" re-render logic only applies to legacy HTML; a React screen reads the
  session/profile hooks and renders its own loading state (not the guard text) until the profile has resolved.
- **Race with the module script.** If a view is switched on but `main.tsx` has not run yet, `isOn(view)` stays true and
  `mount` awaits `ready` with a time limit (suggested 2 s); on timeout it falls back to the legacy renderer for that
  navigation. A failing React render also falls back to legacy (error boundary calls `levroReact.fallback(view)`), so a
  bad screen can never leave a blank page.
- **`innerHTML` patch and observers** (`14-motion.js`, the `#app` MutationObservers): PR 3 includes a test that the
  page-swap animation and the commission countdown still work with a React view mounted.

### 5.3 The switches

Same pattern as `levroData.useBackend` (`src/services/backend-features.ts`):

| Layer | How | Default |
|---|---|---|
| Build default | `VITE_REACT_VIEWS` = comma list, `all`, or empty (also in `.env.example`; **not** set in Vercel) | empty = nothing on |
| Per-browser override | `localStorage["medris:react-views"]` (same style as `medris:backend-features`) | none |
| URL helper | `?react=terms,privacy` or `?react=all` stores the list; `?react=off` removes it; the parameter is removed from the address bar after it is read (like `?ref=`), so deep links stay clean | none |
| Console | `levroReact.use("terms")`, `levroReact.use("all")`, `levroReact.use(null)` | none |

Precedence: URL helper, then the stored override, then the build default. `isOn(view)` is true only if the view has a
registered component **and** is in the resulting list. `?react=off` always wins and also turns off an `all` build default.
Reading storage is wrapped in `try/catch` (private mode). A small badge or console line states which screens are on, so
a tester can see it.

Switching a screen on for everyone later is a one-line change of `VITE_REACT_VIEWS` (or of its default) in its own pull
request; deleting the legacy code of a screen is a third pull request after two weeks in production.

### 5.4 Session, profile and data hooks

- `useLegacySession()` returns `{ session, profile, vendor }` read from the legacy globals and re-renders when they change.
  Two options for the change signal (Q2): (a) subscribe to `sb.auth.onAuthStateChange` and re-read `profile`/`vendor`
  after the legacy `refreshAuthState` has finished (needs one documented line there to dispatch an event), or (b) poll.
  Proposal: (a), as part of PR 3, because (b) wastes battery and (c) fetching the profile a second time would double the
  Supabase traffic.
- Data access mirrors the legacy queries one for one in `services/` (same table, columns, filters, RPC arguments), so the
  database is asked exactly the same thing. Where `levroData` already wraps a query, React uses `levroData`.
- Realtime from React uses the same channel names as today so the legacy global channels and the React screens do not
  create duplicates (`notifications-<user>` stays owned by the legacy code until the notifications screen is migrated).

### 5.5 Conventions

- TypeScript strict; no `any` without a comment saying why; JSX escaping is the default and
  `dangerouslySetInnerHTML` is never used with database text (the only allowed use is the static legal text, which is
  our own string, and only if reviewed).
- No new runtime libraries (React's own state and small hooks; no router, no store). Each pull request reports the
  bundle-size change (`npm run build -w medris-frontend`, size of the new chunk and of the initial bundle).
- Accessibility: real `<button>`/`<a>`, labels, visible focus, Escape/Back behaviour as today, reduced motion, large
  text, both themes, checked at 390 px and 1280 px; anything that cannot be tested is listed in the pull request.
- Performance: the legacy path loads no React views; the chunk for a screen loads only when it is on and opened.

---

## 6. Testing approach

### 6.1 PR 2: end-to-end safety net (Playwright)

- **Tooling.** `@playwright/test` as a *dev* dependency of `medris-frontend` (the only addition; reason: the brief asks
  for it, and the repository has no browser tests today). CI installs Chromium only
  (`npx playwright install --with-deps chromium`).
- **What it loads.** The built app (`npm run build -w medris-frontend`, then `vite preview`), with the same
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` placeholders the build already requires, pointing at a fake host.
- **No live network.** Every request that is not the preview server is answered by `page.route` fixtures, and any
  unmatched request **fails the test** (so a new call cannot silently reach production):
  - Supabase REST (`/rest/v1/<table>`, `/rest/v1/rpc/<name>`) from JSON fixtures keyed by table/RPC and query, auth
    (`/auth/v1/*`) and storage; the realtime WebSocket is blocked (screens must work without it);
  - `/api/*` answered by canned JSON;
  - CDN scripts: `unpkg`/`jsdelivr` Supabase client is served from the repository's own
    `node_modules/@supabase/supabase-js/dist/umd`; Font Awesome and Google Fonts CSS are served from fixtures checked
    into the tests folder so screenshots are stable; Leaflet and map tiles stubbed;
  - the service worker is blocked in tests (`serviceWorkers: "block"`).
- **Fake session.** A fixture writes a Supabase session object (fake JWT with a far expiry, a made-up user id) into
  `localStorage` before the page loads, plus fixture rows for `users`/`vendors` so `refreshAuthState` resolves to a buyer
  (and, in a second project, to a vendor). No real user data in fixtures; names and numbers are invented.
- **Screens visited (first wave, guest and signed-in buyer):** terms, privacy, refundPolicy, contactUs, notifications,
  wishlist, customerFollowing, vendors, storefront, productDetail, packageDetail, search, home, leaderboard.
- **Screenshots:** 390 x 844 and 1280 x 800, light and dark (`data-theme`), animations disabled, a frozen clock
  (`page.clock`), dynamic regions (times, counts from the clock) masked. Reference images are committed under
  `medris-frontend/tests/e2e/__screenshots__/` and compared with a small pixel tolerance.
- **Behaviour assertions** next to the pictures: the right view is shown, the URL, Back button, deep links
  (`?storefront=`, `?product=`, `?ref=`), the theme toggle, and no requests outside the fixtures.
- **CI.** A new job step in `.github/workflows/ci.yml` (allowed for this task) runs these tests; the run uploads the
  screenshots and diffs as an artifact on failure. Local command: `npm run test:e2e -w medris-frontend`.
- **Rule.** Reference screenshots are regenerated only by a person-approved `test:e2e:update` run, never to turn red into
  green (same rule as `legacy-baseline.json`).

### 6.2 PR 3: registry tests

- Unit tests (Vitest) for the switch logic: build default, stored override, `?react=` forms, `off`, unknown names,
  unavailable storage.
- The e2e suite from PR 2 runs **unchanged** with everything off; its screenshots must not change.
- A test with a stub React view switched on checks mount, unmount, no leaked timers/subscriptions, fallback on error and
  on module timeout, Back/forward, and that no HTML snapshot of the React view is stored.

### 6.3 PR 4 and every later screen: parity

A parity test renders the screen twice with the same fixtures (`?react=off` and `?react=<view>`), compares screenshots at
both widths and themes (anti-aliasing tolerance only), compares the visible text, the list of ids/`data-*` attributes other
code reads, the calls made (same table/RPC/arguments, recorded from the fixture server) and the key interactions. For
screens with data, a "wrong user cannot see it" check relies on the database policies and is *not* re-tested in the
browser.

---

## 7. Progress table

Status values: **legacy** (not started), **React-off** (component merged, switched off), **React-on** (switched on for
everyone), **legacy removed**. Every later pull request updates its own rows. Today every screen is **legacy** except `terms`, `privacy`, `refundPolicy`, `contactUs`, `customerFollowing`, `wishlist` and `notifications`, which are **React-off** once their pull requests are merged.

| View | Wave | Status | Pull request | Notes |
|---|---|---|---|---|
| `home` | 3 | legacy | — | |
| `productDetail` | 3 | legacy | — | |
| `packageDetail` | 3 | legacy | — | |
| `storefront` | 3 | React-off (frame + header) | PR for the storefront | React loads the vendor and catalogue (same requests, in the same order as legacy, through `src/services/storefront.ts`) and draws the page frame once: cover, avatar, name (with "formerly"), bio, meta, distance, stats/follow placeholders, "Store options" sheet, "Latest from" strip, catalogue tabs, panel containers; plus the states (loading shell, not found, paused, retry card). **The grid, search and chips, catalogue tab switch, follow button + menu, stats, packages, reviews, share box and lightbox stay legacy-owned** (they fill the frame by id; state in legacy variables): React calls `filterStorefrontProducts`, `hydrateStorefrontExtras` and the card hydrators once the frame is in the page. Same title/social meta, same view-counter RPC (not for the owner). Parity tests pass (markup incl. hydrated parts, requests/RPCs/writes, every control, owner view, guest, pixels vs legacy). Not on for anyone: `?react=storefront`. Differences to know: React does not use the legacy HTML snapshot cache, so an instant revisit shows the loading shell first. |
| `vendors` | 3 | React-off (frame only) | PR for the vendors directory | React draws the **page frame once** (title, view buttons, Buy/Rent tabs, search, filter panel, chips/grid/map containers incl. the rail); never re-renders it. **Everything inside stays owned by the legacy scripts** (cards, selects, chips, rail, Leaflet map, infinite scroll, shuffle/sort/view state live in closures): React calls the old `renderVendorsDirectory()` for its side effects (state reset + scheduled load) and ignores its HTML string; every control calls the same global the old inline handler called. Parity: same markup after load, same Supabase reads, same filters/tabs/modes/sort, card → storefront, pixels vs the legacy reference pictures. Not converted (decision for a later step): cards, filters, map. Not on for anyone: `?react=vendors`. |
| `vendorApply` | 5 | legacy | — | |
| `vendorDashboard` | 4 | legacy | — | |
| `vendorEditProfile` | 5 | legacy | — | |
| `editProfile` | 4 | legacy | — | |
| `profileSetup` | 4 | legacy | — | |
| `buyerProfile` | 4 | legacy | — | |
| `settings` | 4 | legacy | — | |
| `vendorProducts` | 4 | legacy | — | |
| `vendorPackages` | 4 | legacy | — | |
| `vendorEarnings` | 5 | legacy | — | |
| `vendorFollowers` | 4 | legacy | — | |
| `vendorFollowerNetwork` | 4 | legacy | — | |
| `vendorOrders` | 5 | legacy | — | |
| `buyerOrders` | 5 | legacy | — | |
| `orderHistory` | 5 | legacy | — | |
| `orderDetail` | 5 | legacy | — | |
| `leaveReview` | 5 | legacy | — | |
| `adminPanel` | 5 | legacy | — | |
| `adminCarousel` | 5 | legacy | — | |
| `adminR2Migration` | 5 | legacy | — | |
| `adminR2Optimize` | 5 | legacy | — | |
| `adminLinkLibrary` | 5 | legacy | — | |
| `adminDisputes` | 5 | legacy | — | |
| `adminSupportRequests` | 5 | legacy | — | |
| `adminPasswordResets` | 5 | legacy | — | |
| `adminInventory` | 5 | legacy | — | |
| `adminPeople` | 5 | legacy | — | |
| `adminFeedback` | 5 | legacy | — | |
| `vendorSuggestionsInbox` | 4 | legacy | — | |
| `adminUsers` | 5 | legacy | — | |
| `adminFinance` | 5 | legacy | — | |
| `adminCampuses` | 5 | legacy | — | |
| `adminLog` | 5 | legacy | — | |
| `adminAuthLogs` | 5 | legacy | — | |
| `adminConversations` | 5 | legacy | — | |
| `adminMonthlyListings` | 5 | legacy | — | |
| `wishlist` | 2 | React-off | PR for Wishlist + shared cards | Introduces shared `ProductCard` / `PackageCard` (`src/components/`), typed read `src/services/wishlist.ts` (same queries; errors treated as empty, as legacy), legacy helpers reused through `src/views/legacy-globals.ts`. Parity tests pass (markup, requests, heart/quick-add/open/keyboard, broken images, pixels). Not on for anyone: `?react=wishlist`. Legacy finding: card `aria-label` built with an escaper that leaves `"` unescaped (see PR). |
| `customerFollowing` | 2 | React-off | PR for "Vendors you follow" (wave 2, first screen) | Typed read in `src/services/follows.ts` (same query as legacy); keeps `lmFilterFollowing`; chunk `CustomerFollowingPage-*.js`. Parity tests pass (markup, same DB request, error/empty/guest/admin states, pixels). Not on for anyone: `?react=customerFollowing`. |
| `cart` | 5 | legacy | — | |
| `messages` | 5 | legacy | — | |
| `notifications` | 2 | React-off | PR for Notifications | React draws the page and list; **all actions stay legacy functions** (open row, tabs, select mode, batch mark, read-queue commit); a bridge replaces `window.renderNotifPanel` while the React page is on screen so legacy redraws go to React. Same reads (`levroData.notifications.panel`, owner lookups) and same localStorage first-paint cache. Parity tests pass incl. same writes. Not on for anyone: `?react=notifications`. |
| `requestEquipment` | 4 | legacy | — | |
| `supportRequest` | 4 | legacy | — | |
| `contactUs` | 1 | React-off | PR for contact us (see below) | Static page; keeps `trackSocialClick` and `navigate('supportRequest')`; chunk `ContactUsPage-*.js`. Parity tests pass. Not on for anyone: `?react=contactUs` / `VITE_REACT_VIEWS`. |
| `leaderboard` | 2 | legacy | — | |
| `adminPoints` | 5 | legacy | — | |
| `search` | 3 | React-off (frame) | PR for the search page | React draws the page frame once (back button, search box, the five filter tabs, scope note, results area with the "Recent searches" chips from the same saved list) and then does what the router did after the old HTML landed: reset the filter to "All", focus the box (again after 60 ms), draw the suggestions, bind the long-press on results. **Typing, the delayed query, Enter, the filter tabs, clear, the suggestions and results, "see more" scrolling and the recent-searches buttons stay legacy-owned** (they fill the frame by id). Parity tests pass. Not on for anyone: `?react=search`. Note: on a phone the header's search button focuses a temporary box first and hands focus to the real one when it appears; the React page appears after its chunk loads, so the very first open may need a second tap for the keyboard (not testable here). |
| `vendorRequests` | 4 | legacy | — | |
| `terms` | 1 | React-off (pilot, in PR #9) | #9 | Chunk `TermsPage-*.js` 8.2 kB, loads only when on. Parity tests pass. Not on for anyone: `?react=terms` / `VITE_REACT_VIEWS`. |
| `privacy` | 1 | React-off | this PR (#10) | Same pattern as `terms`; chunk `PrivacyPage-*.js` 6.0 kB, loads only when on. Parity tests pass. Not on for anyone: `?react=privacy` / `VITE_REACT_VIEWS`. |
| `refundPolicy` | 1 | React-off | PR for refund policy (see below) | Same pattern as `terms`/`privacy`; no links; chunk `RefundPolicyPage-*.js`. Parity tests pass. Not on for anyone: `?react=refundPolicy` / `VITE_REACT_VIEWS`. |
| `sharedAiChat` | 2 | legacy | — | |
| `suspended` | 5 | legacy | — | |

---

## 8. Open questions

Plain words, in the order they matter.

1. **Q1: where the hook goes.** The brief says "navigate(), its last definition". The last (outermost) definition is a
   thin wrapper that only sets `body[data-view]`; the only place that renders is the first definition in
   `30-navigation.js`. I propose putting the (minimal) hook in the **first** definition at the `switch`, because every
   wrapper delegates to it. Is that acceptable? (A hook in the outermost wrapper would have to re-implement the shell,
   scroll, history and caching steps, which I recommend against.)
2. **Q2: how React learns that the profile changed.** Proposal: one documented line in the legacy auth refresh that
   dispatches an event React listens to. This is a second legacy edit in PR 3. OK?
3. **Q3: pilot choice.** I recommend `terms` (static, no data). Do you want `notifications` instead, accepting real data
   and realtime in the very first conversion?
4. **Q4: test fixtures for Supabase.** CI must never call the live Supabase. I plan hand-written fixtures (invented names
   and numbers). Do you prefer a one-time export of anonymised real rows instead? (I would not do that without your
   explicit approval.)
5. **Q5: the Playwright dev dependency** and a Chromium download in CI (about 150 MB, cached). Acceptable?
6. **Q6: Vercel preview and `?react=`.** The URL helper stores the choice in `localStorage` of that browser only. Do you
   also want a visible "React screens on: terms" badge on previews, removed in production?
7. **Q7: font-scale and large-text checks.** I will include `levromart-font-scale` extremes in the parity screenshots for
   migrated screens unless you think that is too many images.
8. **Q8: `levromart:view-rendered`.** Several scripts listen for it, but no dispatcher was found. If it is dead code, I
   would leave it alone; if something dispatches it indirectly, React screens must dispatch it too. I will confirm in PR 3.
9. **Q9: missing `docs/FRONTEND.md`** referenced in `src/app/App.tsx`. I propose that this document replaces it and that
   the comment is updated in PR 3 (a TypeScript file, not legacy).
10. **Q10: "two weeks in production" clock.** Counted from the pull request that switches a screen on for everyone, not from
    the pull request that adds it. Correct?

Nothing in this plan requires changes to the database, `api/`, `medris-backend/`, `vercel.json`, payment code or the rules
in `.agent/`. The only workflow file touched later is `.github/workflows/ci.yml` (PR 2, a new test step).
