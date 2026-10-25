// ---------- AUTH IDENTIFIER HELPERS ----------
function normalizeAuthPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = "234" + digits.slice(1);
  return digits;
}
function authAliasFromPhone(phone) {
  const digits = normalizeAuthPhone(phone);
  return `p${digits}@accounts.levromart.app`;
}
function looksLikePhoneIdentifier(value) {
  const raw = String(value || "").trim();
  return raw && !raw.includes("@") && /[0-9]/.test(raw);
}

function naira(n) { return "₦" + Number(n ?? 0).toLocaleString(); }
// The price a buyer actually pays: the discount when there is a real one, otherwise the normal price.
function effectivePrice(o) { const sale = Number(o?.sale_price), disc = Number(o?.discount_price); return o?.discount_price != null && disc > 0 && (!Number.isFinite(sale) || disc < sale) ? disc : (o?.sale_price != null ? sale : null); }
function priceHeroInner(o, suffix) {
  const now = effectivePrice(o), was = Number(o?.sale_price);
  const off = now != null && Number.isFinite(was) && now < was;
  return `<span class="pph-now">${naira(now)}${esc(suffix || "")}</span>${off ? `<span class="pph-was">${naira(was)}</span><span class="pph-save">Save ${naira(was - now)} · ${Math.round((1 - now / was) * 100)}% off</span>` : ""}`;
}
// iPhones only open the keyboard for a focus() made inside the tap itself. The search page
// doesn't exist yet at that moment, so focus a throw-away input first, then hand focus over
// to the real search box the instant it renders -- one tap, keyboard up.
function openSearchFromHeader() {
  // The search page is drawn straight away, inside the tap itself (iPhones only open the keyboard for a focus() made
  // inside the tap), so there is no wait and no throw-away input. The normal navigation then runs behind it.
  try {
    const host = byId("app");
    if (host && typeof renderSearchPage === "function" && currentView !== "search") {
      document.body.classList.add("search-full-page");
      window.__lvForceSlide = true;   // the search page glides in from the right
      host.innerHTML = renderSearchPage();
      const real = byId("searchPageInput");
      if (real) real.focus({ preventScroll: true });
    }
  } catch (_) {}
  const finish = () => { const real = byId("searchPageInput"); if (real && document.activeElement !== real) { real.focus(); try { real.setSelectionRange(real.value.length, real.value.length); } catch (_) {} } };
  Promise.resolve(navigate("search")).then(() => { finish(); setTimeout(finish, 120); }).catch(finish);
}
function servicePriceSuffix(p) { return p.is_service && p.service_price_unit && p.service_price_unit !== "flat" ? "/" + p.service_price_unit : ""; }
// Escapes text for HTML. Quotes are escaped too: this is used inside attribute values (aria-label="...", alt="...",
// data-...='...'), and an unescaped " or ' in a name from the database would end the attribute and let the rest of the
// text add attributes of its own (for example onmouseover=...). innerHTML already escapes & < >.
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

// Swaps a plain <select>'s open state for a styled popup matching the rest
// of the app, instead of the bare OS picker (the native list of radio
// circles you get on Android/iOS) - the closed-state look was already
// fine, this only replaces what happens when you tap it. The original
// <select> stays in the DOM (invisible) so existing value/onchange code
// keeps working untouched.
function enhanceSelect(sel) {
  if (!sel || sel.dataset.msEnhanced) return;
  sel.dataset.msEnhanced = "1";
  const wrap = document.createElement("div");
  wrap.className = "ms-wrap";
  const inlineStyle = sel.getAttribute("style");
  if (inlineStyle) wrap.setAttribute("style", inlineStyle);
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0;margin:0;padding:0;";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ms-btn";
  const list = document.createElement("div");
  list.className = "ms-list hidden";
  wrap.appendChild(btn);
  wrap.appendChild(list);

  // Long lists (a category picker with 20-30 entries across several
  // groups, say) are unusable as a plain scroll - a search box to filter
  // as you type, plus keeping each <optgroup>'s label visible as a
  // section header, makes a big list navigable instead of just long.
  const searchThreshold = 8;
  let searchTerm = "";

  function optionRows() {
    // Flattens <optgroup>s into {opt, index, groupLabel} rows, since
    // sel.options itself has no notion of group boundaries.
    const rows = [];
    let index = 0;
    [...sel.children].forEach((child) => {
      if (child.tagName === "OPTGROUP") {
        [...child.children].forEach((opt) => { rows.push({ opt, index, groupLabel: child.label }); index++; });
      } else if (child.tagName === "OPTION") {
        rows.push({ opt: child, index, groupLabel: null });
        index++;
      }
    });
    return rows;
  }

  function renderList() {
    list.innerHTML = "";
    const showSearch = sel.options.length > searchThreshold;
    if (showSearch) {
      const searchWrap = document.createElement("div");
      searchWrap.className = "ms-search-wrap";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ms-search";
      input.placeholder = "Search…";
      input.value = searchTerm;
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => { searchTerm = input.value; renderItems(); });
      searchWrap.appendChild(input);
      list.appendChild(searchWrap);
      setTimeout(() => input.focus(), 0);
    }
    const itemsWrap = document.createElement("div");
    list.appendChild(itemsWrap);
    renderItems(itemsWrap);

    function renderItems(container) {
      const target = container || itemsWrap;
      target.innerHTML = "";
      const term = searchTerm.trim().toLowerCase();
      const rows = optionRows().filter((r) => !term || r.opt.text.toLowerCase().includes(term));
      if (!rows.length) { target.innerHTML = `<div class="ms-empty">No matches.</div>`; return; }
      let lastGroup;
      rows.forEach(({ opt, index, groupLabel }) => {
        if (groupLabel && groupLabel !== lastGroup) {
          const label = document.createElement("div");
          label.className = "ms-group-label";
          label.textContent = groupLabel;
          target.appendChild(label);
        }
        lastGroup = groupLabel;
        const item = document.createElement("div");
        item.className = "ms-item" + (index === sel.selectedIndex ? " selected" : "");
        item.textContent = opt.text;
        item.addEventListener("click", () => {
          sel.selectedIndex = index;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        });
        target.appendChild(item);
      });
    }
  }
  function sync() {
    btn.textContent = sel.options[sel.selectedIndex]?.text || "";
    renderList();
  }
  sync();
  sel.addEventListener("change", sync);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = list.classList.contains("hidden");
    document.querySelectorAll(".ms-list").forEach((l) => l.classList.add("hidden"));
    document.querySelectorAll(".ms-btn.open").forEach((b) => b.classList.remove("open"));
    if (willOpen) { searchTerm = ""; renderList(); list.classList.remove("hidden"); btn.classList.add("open"); }
  });
}
function enhanceSelectsIn(root) {
  (root || document).querySelectorAll("select").forEach(enhanceSelect);
}
// Generic small overflow menu (reuses the .ms-list/.ms-item dropdown look)
// for grouping secondary actions behind a single "More" button instead of
// a row of same-weight buttons - the global outside-click handler below
// already closes any .ms-list, so this needs no extra wiring.
function toggleStorefrontBio(btn) {
  const wrap = btn.closest(".storefront-bio-wrap");
  if (!wrap) return;
  const expanded = wrap.classList.toggle("expanded");
  btn.textContent = expanded ? "Show less" : "Read more";
}
function toggleInlineMenu(id, evt) {
  evt?.stopPropagation();
  const list = byId(id);
  if (!list) return;
  const willOpen = list.classList.contains("hidden");
  document.querySelectorAll(".ms-list").forEach((l) => l.classList.add("hidden"));
  if (willOpen) list.classList.remove("hidden");
}
document.addEventListener("click", (event) => {
  // Info controls and the floating popover own their clicks. Do not let this
  // global outside-click handler immediately close a popover that just opened.
  if (event.target.closest?.(".info-btn, .info-popover")) return;
  document.querySelectorAll(".ms-list").forEach((l) => l.classList.add("hidden"));
  document.querySelectorAll(".ms-btn.open").forEach((b) => b.classList.remove("open"));
  document.querySelectorAll(".info-popover").forEach((p) => {
    p.classList.add("hidden");
    p.style.left = "";
    p.style.top = "";
    if (p._infoOriginParent && p.parentElement === document.body) {
      if (p._infoOriginNext && p._infoOriginNext.parentNode === p._infoOriginParent) {
        p._infoOriginParent.insertBefore(p, p._infoOriginNext);
      } else {
        p._infoOriginParent.appendChild(p);
      }
    }
  });
  const openReaction = document.querySelector('.reaction-picker');
  if (openReaction && Date.now() >= (window.chatSuppressClickUntil || 0) && !event.target?.closest?.('.reaction-picker')) {
    const insideAnchor = event.target?.closest?.('.chat-bubble[data-msg-id]');
    if (!insideAnchor || !openReaction.contains(insideAnchor)) {
      openReaction.remove();
    }
  }
});
// Small "i" button + floating bubble, for swapping a paragraph of helper
// text out of the page flow and behind a tap - keeps cards short by
// default while still putting the full explanation one tap away.
function infoPopoverHtml(id, text) {
  return `<span class="info-popover-wrap"><button type="button" class="info-btn" onclick="toggleInfoPopover('${id}',event)">i</button><div class="info-popover hidden" id="${id}">${text}</div></span>`;
}
// A long product description used to either run in full down the page or
// hide completely behind an unlabeled "i" icon -- neither matched the
// familiar "show a preview, tap Read more to expand" pattern. This clamps
// to a few lines by default and toggles a plain text button, in place.
function readMoreHtml(id, text, opts = {}) {
  const maxChars = opts.maxChars || 160;
  const safe = esc(text);
  if (String(text || "").length <= maxChars) return `<span id="${id}">${safe}</span>`;
  return `<span class="read-more-wrap" id="${id}"><span class="read-more-text clamped">${safe}</span> <button type="button" class="read-more-toggle" onclick="toggleReadMore('${id}')">Read more</button></span>`;
}
function toggleReadMore(id) {
  const wrap = byId(id);
  if (!wrap) return;
  const textEl = wrap.querySelector(".read-more-text");
  const btn = wrap.querySelector(".read-more-toggle");
  if (!textEl || !btn) return;
  const collapsing = !textEl.classList.contains("clamped");
  textEl.classList.toggle("clamped", collapsing);
  btn.textContent = collapsing ? "Read more" : "Read less";
}
// Collapsed by default so a well-reviewed vendor's storefront doesn't open
// with a long scroll of review cards before you even reach the products.
function toggleReviewsList() {
  const list = byId("reviewsList");
  const chevron = byId("reviewsChevron");
  if (!list) return;
  const willOpen = list.classList.contains("hidden");
  list.classList.toggle("hidden");
  if (chevron) chevron.style.transform = willOpen ? "rotate(180deg)" : "rotate(0deg)";
}
function toggleInfoPopover(id, evt) {
  evt?.preventDefault?.();
  evt?.stopPropagation?.();
  const el = byId(id);
  if (!el) return;
  const sourceButton = evt?.currentTarget || evt?.target?.closest?.(".info-btn");
  const willOpen = el.classList.contains("hidden");
  document.querySelectorAll(".info-popover").forEach((p) => {
    if (p !== el) { p.classList.add("hidden"); p.style.left = ""; p.style.top = ""; }
  });
  document.querySelectorAll(".ms-list").forEach((l) => l.classList.add("hidden"));
  if (!willOpen) {
    el.classList.add("hidden");
    return;
  }
  if (!el._infoOriginParent) { el._infoOriginParent = el.parentElement; el._infoOriginNext = el.nextSibling; }
  el._infoButton = sourceButton || el._infoButton || el._infoOriginParent?.querySelector?.(".info-btn");
  if (el.parentElement !== document.body) document.body.appendChild(el);
  el.classList.remove("hidden");
  positionInfoPopover(el);
}
function closeAllInfoPopovers() {
  document.querySelectorAll(".info-popover").forEach((p) => {
    p.classList.add("hidden");
    p.style.left = "";
    p.style.top = "";
    if (p._infoOriginParent && p.parentElement === document.body) {
      if (p._infoOriginNext && p._infoOriginNext.parentNode === p._infoOriginParent) p._infoOriginParent.insertBefore(p, p._infoOriginNext);
      else p._infoOriginParent.appendChild(p);
    }
  });
}

let infoPopoverScrollBound = false;
function bindInfoPopoverScrollDismiss() {
  if (infoPopoverScrollBound) return;
  infoPopoverScrollBound = true;
  const dismiss = () => closeAllInfoPopovers();
  window.addEventListener("scroll", dismiss, { passive: true });
  window.addEventListener("wheel", dismiss, { passive: true });
  window.addEventListener("touchmove", dismiss, { passive: true });
}
bindInfoPopoverScrollDismiss();

function positionInfoPopover(el) {
  const btn = el?._infoButton;
  if (!el || !btn || !btn.isConnected) return;
  const margin = 12;
  const btnRect = btn.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - margin * 2);
  el.classList.remove("info-popover-above");
  el.style.position = "fixed"; el.style.width = `${width}px`; el.style.maxWidth = `calc(100vw - ${margin * 2}px)`; el.style.zIndex = "10000";
  let left = btnRect.left;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
  if (left < margin) left = margin;
  el.style.left = `${left}px`;
  el.style.top = `${btnRect.bottom + 8}px`;
  const r = el.getBoundingClientRect();
  if (r.bottom > window.innerHeight - margin) {
    el.classList.add("info-popover-above");
    el.style.top = `${Math.max(margin, btnRect.top - r.height - 8)}px`;
  }
}

function byId(id) { return document.getElementById(id); }

// Splash screen shown on load/reload: brief, branded, and - unlike the
// earlier version - impossible to leave stuck on screen. Three independent
// triggers can hide it (first successful navigate(), init()'s finally
// block, and a hard 4s timeout in init()); whichever fires first wins.
// __levroSplashShownAt enforces a minimum visible time so a fast load
// doesn't just flash the logo for a few milliseconds.
window.__levroSplashShownAt = 0;
window.__levroSplashHidden = false;
function prepareLevromartSplash() {
  const splash = byId("levromartSplash");
  if (!splash) return;
  const logo = splash.querySelector(".levromart-splash-logo");
  if (logo) {
    if (typeof LEVROMART_LOGO_CIRCLE !== "undefined") logo.src = LEVROMART_LOGO_CIRCLE;
    else if (typeof MEDRIS_LOGO !== "undefined") logo.src = MEDRIS_LOGO;
  }
  window.__levroSplashShownAt = Date.now();
  window.__levroSplashHidden = false;
}
function lvPageStyled() {
  try {
    if (document.readyState === "loading") return false;
    const fa = document.querySelector('link[rel="stylesheet"][href*="font-awesome"]');
    if (fa && !fa.sheet && navigator.onLine !== false) return false;
    // our own five style files: the last three sit lower in the page, so on a slow connection the app can be parsed
    // before they arrive. Showing the page then is the unstyled "half-built" screen people must never see.
    const own = document.querySelectorAll('link[rel="stylesheet"][href*="/assets/css/"]');
    for (let i = 0; i < own.length; i++) if (!own[i].sheet && navigator.onLine !== false) return false;
    if (own.length < 5 && document.readyState !== "complete") return false;
    return true;
  } catch (_) { return true; }
}
function hideLevromartSplash() {
  const splash = byId("levromartSplash");
  if (!splash || window.__levroSplashHidden) return;
  const minVisibleMs = 150;
  const elapsed = Date.now() - (window.__levroSplashShownAt || 0);
  if (elapsed < minVisibleMs) {
    setTimeout(() => hideLevromartSplash(), minVisibleMs - elapsed);
    return;
  }
  // Never reveal the app until the whole page has been parsed (the later style blocks are what make cards, buttons and
  // images look right) and the icon stylesheet has arrived; otherwise people briefly see grey, unstyled controls and
  // oversized images. A hard cap keeps a dead CDN from holding the splash forever.
  // Also wait (up to ~4 s) until the first screen has real content instead of grey placeholder blocks.
  try {
    const a = byId("app");
    if (elapsed < 4000 && a && a.querySelector("[class*='skel'], .lv-svc-skel")) { setTimeout(() => hideLevromartSplash(), 120); return; }
  } catch (_) {}
  if (!lvPageStyled() && elapsed < 9000) {
    setTimeout(() => hideLevromartSplash(), 100);
    return;
  }
  window.__levroSplashHidden = true;
  splash.classList.add("is-hidden");
}

