// ---------- FLOATING AI CHAT (draggable) ----------
let aiChatMessages = [];
let currentAiConversationId = null;
let aiChatResumeAttempted = false;
let aiChatLastDateKey = null;
function toggleAiChat() {
  if (!session) { showLogin(); return; }
  const panel = byId("aiChatPanel");
  const wasHidden = panel.classList.contains("hidden");
  panel.style.removeProperty("visibility");
  panel.style.removeProperty("pointer-events");
  panel.classList.toggle("hidden");
  const isOpen = !panel.classList.contains("hidden");
  // The FAB follows the panel state, while still respecting the user's Levi visibility preference.
  syncLeviFabVisibility();
  updateCartFab();
  if (isOpen) {
    setupAiChatBottomButton();
    playSound("open");
    let wasExpanded = false;
    try { wasExpanded = localStorage.getItem("levromart-ai-chat-expanded") === "1"; } catch (e) {}
    panel.classList.toggle("expanded", wasExpanded);
    const expandBtn = byId("aiChatExpandBtn");
    if (expandBtn) { expandBtn.title = wasExpanded ? "Shrink" : "Expand"; expandBtn.querySelector("i").className = wasExpanded ? "fa-solid fa-compress" : "fa-solid fa-expand"; }
    if (aiChatMessages.length === 0) {
      if (!aiChatResumeAttempted) { aiChatResumeAttempted = true; resumeLastAiConversation(); }
      else showAiChatGreeting();
    }
  }
}
function scrollAiChatToBottom() {
  const el = byId("aiChatMessages");
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  setTimeout(updateAiChatBottomButton, 260);
}
function updateAiChatBottomButton() {
  const el = byId("aiChatMessages");
  const btn = byId("aiChatBottomBtn");
  if (!el || !btn) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  btn.classList.toggle("hidden", distance < 90);
}
function setupAiChatBottomButton() {
  const el = byId("aiChatMessages");
  if (!el || el.dataset.bottomButtonReady === "1") return;
  el.dataset.bottomButtonReady = "1";
  el.addEventListener("scroll", updateAiChatBottomButton, { passive: true });
  updateAiChatBottomButton();
}
function showAiChatGreeting() {
  const firstName = (profile?.name || "").trim().split(/\s+/)[0] || "";
  const greet = firstName ? `${greetingWord()}, ${firstName}! I'm Levi.` : "Hi, I'm Levi!";
  appendAiChatMessage("assistant", vendor
    ? `${greet} Ask me what buyers are searching for, how your store's visibility compares to other vendors, or anything about running your shop on Levromart.`
    : `${greet} Ask me what you're looking for (healthcare equipment, food, electronics, and more), how renting, buying or requesting works, or anything else about the marketplace.`);
}
// Chats persist across sessions: reopening the app resumes wherever you
// left off, same as the last conversation being one continuous thread.
// Starting a genuinely new chat (the + button) is what actually clears it.
async function resumeLastAiConversation() {
  const savedId = localStorage.getItem("medris-ai-last-conversation");
  if (!savedId) { showAiChatGreeting(); return; }
  const { data: msgs, error } = await sb.from("ai_messages").select("id, role, content, reaction, created_at").eq("conversation_id", savedId).order("created_at", { ascending: true });
  if (error || !msgs || msgs.length === 0) { localStorage.removeItem("medris-ai-last-conversation"); showAiChatGreeting(); return; }
  currentAiConversationId = savedId;
  msgs.forEach((m) => appendAiChatMessage(m.role, m.content, false, true, m.id, m.reaction, m.created_at));
}
function startNewAiChat() {
  currentAiConversationId = null;
  aiConversationCreatePromise = null;
  localStorage.removeItem("medris-ai-last-conversation");
  aiChatMessages = [];
  aiChatLastDateKey = null;
  byId("aiChatMessages").innerHTML = "";
  exitAiChatHistoryMode();
  showAiChatGreeting();
}
// Guarded against firing twice for the same conversation -- two messages
// sent in quick succession (before the first insert resolves) would
// otherwise each see currentAiConversationId still null and create two
// separate conversation rows for what should be one thread.
let aiConversationCreatePromise = null;
async function ensureAiConversation(firstMessageText) {
  if (currentAiConversationId) return currentAiConversationId;
  if (aiConversationCreatePromise) return aiConversationCreatePromise;
  aiConversationCreatePromise = (async () => {
    const title = firstMessageText.length > 60 ? firstMessageText.slice(0, 57) + "…" : firstMessageText;
    const { data, error } = await sb.from("ai_conversations").insert({ user_id: session.user.id, title }).select("id").single();
    if (error || !data) { aiConversationCreatePromise = null; return null; }
    currentAiConversationId = data.id;
    localStorage.setItem("medris-ai-last-conversation", data.id);
    return data.id;
  })();
  return aiConversationCreatePromise;
}
async function persistAiMessage(role, content) {
  const convId = await ensureAiConversation(content);
  if (!convId) return null;
  const { data } = await sb.from("ai_messages").insert({ conversation_id: convId, role, content }).select("id").single();
  return data?.id || null;
}
function toggleAiChatExpanded() {
  const panel = byId("aiChatPanel");
  const expanded = panel.classList.toggle("expanded");
  const btn = byId("aiChatExpandBtn");
  btn.title = expanded ? "Shrink" : "Expand";
  btn.querySelector("i").className = expanded ? "fa-solid fa-compress" : "fa-solid fa-expand";
  try { localStorage.setItem("levromart-ai-chat-expanded", expanded ? "1" : "0"); } catch (e) {}
}
function toggleAiChatHistory() {
  const panel = byId("aiChatPanel");
  const entering = !panel.classList.contains("history-mode");
  panel.classList.toggle("history-mode", entering);
  byId("aiChatHistoryToggleBtn")?.classList.toggle("active", entering);
  if (entering) {
    byId("aiChatHistorySearch").value = "";
    loadAiChatHistoryList();
  }
}
function exitAiChatHistoryMode() {
  byId("aiChatPanel")?.classList.remove("history-mode");
  byId("aiChatHistoryToggleBtn")?.classList.remove("active");
}
async function loadAiChatHistoryList() {
  const listEl = byId("aiChatHistoryList");
  listEl.innerHTML = `<p class="muted" style="font-size:0.82rem;">Loading…</p>`;
  const { data, error } = await sb.from("ai_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(50);
  if (error) { listEl.innerHTML = `<p class="muted" style="font-size:0.82rem;">Couldn't load your chats.</p>`; return; }
  renderAiChatHistoryList(data || []);
}
let aiHistorySelectMode=false;
let aiHistorySelectedIds=new Set();
function exitAiHistorySelectMode(){aiHistorySelectMode=false;aiHistorySelectedIds.clear();renderAiChatHistoryList(window.__aiHistoryRows||[]);}
function toggleAiHistorySelection(id){id=String(id);if(aiHistorySelectedIds.has(id))aiHistorySelectedIds.delete(id);else aiHistorySelectedIds.add(id);if(!aiHistorySelectedIds.size)aiHistorySelectMode=false;renderAiChatHistoryList(window.__aiHistoryRows||[]);}
function toggleAiHistorySelectAll(){const rows=window.__aiHistoryRows||[];aiHistorySelectedIds=(rows.length&&aiHistorySelectedIds.size===rows.length)?new Set():new Set(rows.map(x=>String(x.id)));aiHistorySelectMode=true;renderAiChatHistoryList(rows);}
async function deleteSelectedAiConversations(){const ids=[...aiHistorySelectedIds];if(!ids.length)return;if(!(await showConfirmDialog(`Delete ${ids.length} selected chat${ids.length===1?'':'s'}? This can't be undone.`,{title:'Delete chats',okLabel:'Delete',danger:true})))return;const {error}=await sb.from('ai_conversations').delete().in('id',ids);if(error){showToast(error.message||"Couldn't delete chats.",'error');return;}if(ids.includes(String(currentAiConversationId))){currentAiConversationId=null;aiConversationCreatePromise=null;localStorage.removeItem('medris-ai-last-conversation');aiChatMessages=[];aiChatLastDateKey=null;byId('aiChatMessages')?.replaceChildren();}
  // Drop the deleted rows from the already-loaded local list and re-render
  // in place, instead of re-fetching from the network -- a full reload here
  // flashed "Loading..." and made the whole panel appear to collapse after
  // every delete, when it should just stay put on the history page until
  // the user explicitly closes it.
  const deletedIds=new Set(ids.map(String));
  window.__aiHistoryRows=(window.__aiHistoryRows||[]).filter(c=>!deletedIds.has(String(c.id)));
  aiHistorySelectedIds.clear();aiHistorySelectMode=true;renderAiChatHistoryList(window.__aiHistoryRows);showToast(`${ids.length} chat${ids.length===1?'':'s'} deleted.`,'success');}
function renderAiChatHistoryList(convos) {
  const listEl=byId("aiChatHistoryList");window.__aiHistoryRows=Array.isArray(convos)?convos:[];const rows=window.__aiHistoryRows;if(!listEl)return;
  const toolbar=`<div class="ai-history-select-toolbar">${aiHistorySelectMode?`<button type="button" class="icon-btn" onclick="exitAiHistorySelectMode()" aria-label="Cancel selection"><i class="fa-solid fa-xmark"></i></button><strong>${aiHistorySelectedIds.size} selected</strong><button type="button" class="icon-btn" onclick="toggleAiHistorySelectAll()" aria-label="Select all"><i class="fa-solid ${aiHistorySelectedIds.size===rows.length&&rows.length?'fa-square-minus':'fa-square-check'}"></i></button><button type="button" class="icon-btn ai-history-danger" ${aiHistorySelectedIds.size?'':'disabled'} onclick="deleteSelectedAiConversations()" aria-label="Delete selected"><i class="fa-solid fa-trash"></i></button>`:`<span></span><button type="button" class="ai-history-batch-btn" onclick="aiHistorySelectMode=true;renderAiChatHistoryList(window.__aiHistoryRows||[])" title="Select chats"><i class="fa-solid fa-check-double"></i> Select</button>`}</div>`;
  if(!rows.length){listEl.innerHTML=toolbar+`<p class="muted" style="font-size:0.82rem;">No past chats yet.</p>`;return;}
  listEl.innerHTML=toolbar+rows.map(c=>{const selected=aiHistorySelectedIds.has(String(c.id));return `<div class="ai-chat-history-item ${selected?'selected':''}" data-id="${esc(c.id)}" onclick="${aiHistorySelectMode?`toggleAiHistorySelection('${esc(c.id)}')`:`openAiConversation('${esc(c.id)}')`}">${aiHistorySelectMode?`<span class="ai-history-check ${selected?'active':''}"><i class="fa-solid fa-check"></i></span>`:''}<div class="ai-chat-history-item-main"><div class="ai-chat-history-item-title">${esc(c.title||'Chat')}</div><div class="ai-chat-history-item-date">${new Date(c.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div></div>${!aiHistorySelectMode?`<button class="ai-chat-history-delete" onclick="deleteAiConversation('${esc(c.id)}',event)" title="Delete"><i class="fa-solid fa-trash"></i></button>`:''}</div>`}).join('');
}
let aiChatSearchTimer = null;
function searchAiChatHistory() {
  clearTimeout(aiChatSearchTimer);
  aiChatSearchTimer = setTimeout(async () => {
    const q = byId("aiChatHistorySearch").value.trim();
    if (!q) { loadAiChatHistoryList(); return; }
    const { data, error } = await sb.rpc("search_ai_conversations", { p_query: q });
    if (error) return;
    renderAiChatHistoryList(data || []);
  }, 250);
}
async function openAiConversation(id) {
  const { data: msgs, error } = await sb.from("ai_messages").select("id, role, content, reaction, created_at").eq("conversation_id", id).order("created_at", { ascending: true });
  if (error || !msgs) { showToast("Couldn't open that chat.", "error"); return; }
  currentAiConversationId = id;
  aiConversationCreatePromise = null;
  localStorage.setItem("medris-ai-last-conversation", id);
  aiChatMessages = [];
  aiChatLastDateKey = null;
  byId("aiChatMessages").innerHTML = "";
  msgs.forEach((m) => appendAiChatMessage(m.role, m.content, false, true, m.id, m.reaction, m.created_at));
  exitAiChatHistoryMode();
}
async function deleteAiConversation(id,evt){evt?.stopPropagation?.();if(!(await showConfirmDialog("Delete this chat? This can't be undone.",{title:"Delete chat",okLabel:"Delete",danger:true})))return;const {error}=await sb.from("ai_conversations").delete().eq("id",id);if(error){showToast(error.message||"Couldn't delete this chat.","error");return;}const panel=byId("aiChatPanel"),wasHistory=!!panel&&panel.classList.contains("history-mode");if(currentAiConversationId===id){currentAiConversationId=null;aiConversationCreatePromise=null;localStorage.removeItem("medris-ai-last-conversation");aiChatMessages=[];aiChatLastDateKey=null;byId("aiChatMessages")?.replaceChildren();if(!wasHistory)showAiChatGreeting();}
  // Same reasoning as the batch delete above: remove locally and re-render
  // in place rather than re-fetching, so the history list doesn't flash
  // "Loading..." and appear to collapse after every single delete.
  if(wasHistory){const deletedId=String(id);window.__aiHistoryRows=(window.__aiHistoryRows||[]).filter(c=>String(c.id)!==deletedId);panel?.classList.add("history-mode");byId("aiChatHistoryToggleBtn")?.classList.add("active");renderAiChatHistoryList(window.__aiHistoryRows);}showToast("Chat deleted.","success");}
async function renderSharedAiChat(token) {
  const { data: rows, error } = await sb.rpc("get_shared_ai_conversation", { p_token: token });
  if (error || !rows || rows.length === 0) {
    return `<div class="empty-state"><i class="fa-solid fa-link-slash"></i> This chat link is no longer available.</div>
      <div style="text-align:center;margin-top:1rem;"><button class="btn btn-sm" onclick="navigate('home')">Go to Levromart</button></div>`;
  }
  let html = `<div class="flex" style="align-items:center;gap:0.6rem;margin-bottom:0.3rem;"><img src="${MEDRIS_LOGO}" alt="" style="width:2.2rem;height:2.2rem;border-radius:50%;" /><div><strong>${esc(rows[0].title || "Shared chat")}</strong><p class="muted" style="margin:0;font-size:0.78rem;">Shared conversation with Levi &middot; read-only</p></div></div>`;
  html += `<div class="card shared-ai-chat">${chatMessagesWithDatesHtml(rows, (m) => {
    const clean = m.role === "assistant" ? parseAiRemoveCartTags(parseAiAddCartTags(parseAiDraftMsgTag(parseAiNavTag(m.content).text).text).text).text : m.content;
    return `<div class="ai-chat-msg ${m.role === "user" ? "user" : "assistant"}" style="align-self:${m.role === "user" ? "flex-end" : "flex-start"};">${esc(clean)}</div>`;
  })}</div>`;
  html += `<div style="text-align:center;margin-top:1rem;"><button class="btn btn-sm" onclick="navigate('home')"><i class="fa-solid fa-arrow-right"></i> Try Levromart</button></div>`;
  return html;
}
async function shareCurrentAiChat() {
  if (!currentAiConversationId) { showToast("Send a message first, then you can share this chat.", "info"); return; }
  const { data: token, error } = await sb.rpc("set_ai_conversation_shared", { p_conversation_id: currentAiConversationId, p_shared: true });
  if (error) { showToast(error.message, "error"); return; }
  const link = `${location.origin}${location.pathname}?share=${token}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast("Link copied. Anyone with it can view this chat (read-only).", "success");
  } catch (e) {
    await showConfirmDialog(link, { title: "Share link", okLabel: "Close" });
  }
}
document.addEventListener("contextmenu", (e) => {
  if (e.target?.closest?.(".chat-image-attachment img")) e.preventDefault();
}, { capture:true });

window.addEventListener("scroll", () => { closeAllInfoPopovers(); }, { passive:true });

document.addEventListener("click", (e) => {
  const panel = byId("aiChatPanel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (e.target.closest("#aiChatPanel, #aiChatFab")) return;
  panel.classList.add("hidden");
  syncLeviFabVisibility();
});
// Tapping the empty space around an open conversation (not the chat thread,
// input, or header - those all have their own click handlers already)
// closes it back to the conversation list, instead of only the explicit
// "All conversations" button.
document.addEventListener("click", (e) => {
  if (currentView !== "messages" || !activeConversationId) return;
  if (e.target.id !== "app") return;
  navigate("messages");
});
// Levi ends a reply with an invisible [[NAV:view|param=value]] tag when it
// wants to offer taking the person somewhere - this splits that off from
// the text that actually gets displayed/spoken/re-sent as history.
// Not anchored to the end of the string and tolerates stray backticks
// around it - the model is told to emit this silently with nothing else,
// but occasionally narrates it instead ("tag: `[[NAV:vendors]]` since...").
// Finding it anywhere (not just as the literal last characters) and
// stripping just the matched tag keeps that kind of slip from ever
// surfacing as raw bracket syntax in the chat.
// Matches just the outer [[NAV: ... ]] wrapper (plus optional stray
// backticks) and leaves the inside as one blob to parse separately below --
// deliberately loose, because the model doesn't always get the internal
// format exactly right (extra "view|" prefix, wrong param order, etc.) and
// a strict positional regex just fails closed, leaking the raw tag as
// visible text. Parsing the pieces out by content instead of position
// tolerates those slips.
const AI_NAV_TAG_RE = /`?\[\[NAV:([^\]]*)\]\]`?/;
const AI_NAV_ALLOWED_VIEWS = new Set([
  "home", "profile", "buyerProfile", "vendors", "storefront", "productDetail", "packageDetail", "wishlist", "cart", "requestEquipment", "buyerOrders", "messages", "settings", "customerFollowing",
  "vendorDashboard", "vendorProducts", "vendorPackages", "vendorOrders", "vendorEditProfile", "vendorRequests", "vendorSuggestionsInbox", "supportRequest",
  "adminPanel", "adminCarousel", "adminLinkLibrary", "adminPeople", "adminFinance", "adminDisputes", "adminSupportRequests", "adminFeedback", "adminUsers", "adminLog",
]);
function parseAiNavTag(content) {
  const str = String(content || "");
  const m = AI_NAV_TAG_RE.exec(str);
  if (!m) return { text: content, nav: null };
  const params = {};
  let view = null;
  (m[1] || "").split("|").map((s) => s.trim()).filter(Boolean).forEach((part) => {
    const eq = part.indexOf("=");
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (key.toLowerCase() === "view") view = val; // model wrote view=X instead of just X
      else params[key] = val;
    } else if (!view && AI_NAV_ALLOWED_VIEWS.has(part)) {
      view = part;
    }
  });
  const text = (str.slice(0, m.index) + str.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim();
  if (!view || !AI_NAV_ALLOWED_VIEWS.has(view)) return { text: text || content, nav: null };
  return { text: text || "Here, let me show you.", nav: { view, params } };
}
// [[DRAFTMSG vendorId=<id>]]message text[[/DRAFTMSG]] - a message drafted
// for review, never auto-sent. Uses an open/close pair rather than the
// single-line NAV format since a message body can contain any characters
// (|, ], quotes, newlines) that would otherwise need escaping.
const AI_DRAFTMSG_TAG_RE = /\[\[DRAFTMSG vendorId=([a-zA-Z0-9-]+)\]\]([\s\S]*?)\[\[\/DRAFTMSG\]\]/;
function parseAiDraftMsgTag(content) {
  const m = AI_DRAFTMSG_TAG_RE.exec(String(content || ""));
  if (!m) return { text: content, draft: null };
  const text = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
  return { text, draft: { vendorId: m[1], message: m[2].trim() } };
}
// [[ADDCART productId=<id> quantity=<n>]] -- self-closing, can repeat for
// several products in one reply. Executed right away rather than staged
// for a confirm tap like DRAFTMSG -- adding a cart line is low-stakes and
// trivially undone (just remove it), unlike sending a message to someone.
const AI_ADDCART_TAG_RE = /\[\[ADDCART productId=([a-zA-Z0-9-]+)(?:\s+quantity=(\d+))?\]\]/g;
function parseAiAddCartTags(content) {
  const str = String(content || "");
  const items = [];
  let m;
  AI_ADDCART_TAG_RE.lastIndex = 0;
  while ((m = AI_ADDCART_TAG_RE.exec(str))) items.push({ productId: m[1], quantity: m[2] ? parseInt(m[2]) : 1 });
  const text = str.replace(AI_ADDCART_TAG_RE, "").replace(/\s{2,}/g, " ").trim();
  return { text: text || content, items };
}
async function applyAiAddCartItems(items) {
  let added = 0, failed = 0;
  for (const it of items) {
    const { error } = await levroData.cart.add(it.productId, it.quantity);
    if (error) failed++; else added++;
  }
  if (added) refreshNotifications();
  return { added, failed };
}
// [[REMOVECART productId=<id>]] -- same self-closing, repeatable shape as
// ADDCART. Levi is told to only ever use product ids from the customer's own
// "Current cart" context (see buildCustomerContext in api/chat.js), so this
// is just a plain delete scoped to the signed-in buyer's own cart row.
const AI_CARTSYNC_TAG_RE = /\[\[CARTSYNC\]\]/g;
function parseAiCartSyncTag(content){
  const str=String(content||"");
  AI_CARTSYNC_TAG_RE.lastIndex=0;
  const found=AI_CARTSYNC_TAG_RE.test(str);
  AI_CARTSYNC_TAG_RE.lastIndex=0;
  const text=str.replace(AI_CARTSYNC_TAG_RE,"").replace(/\s{2,}/g," ").trim();
  return {text:text||content,sync:found};
}
const AI_CLEARCART_TAG_RE = /\[\[CLEARCART\]\]/g;
function parseAiClearCartTag(content){
  const str=String(content||"");
  AI_CLEARCART_TAG_RE.lastIndex=0;
  const found=AI_CLEARCART_TAG_RE.test(str);
  AI_CLEARCART_TAG_RE.lastIndex=0;
  const text=str.replace(AI_CLEARCART_TAG_RE,"").replace(/\s{2,}/g," ").trim();
  return {text:text||content,clear:found};
}
const AI_CLEARCART_CONFIRM_TAG_RE = /\[\[CLEARCART_CONFIRM\]\]/g;
function parseAiClearCartConfirmTag(content){
  const str=String(content||"");
  AI_CLEARCART_CONFIRM_TAG_RE.lastIndex=0;
  const found=AI_CLEARCART_CONFIRM_TAG_RE.test(str);
  AI_CLEARCART_CONFIRM_TAG_RE.lastIndex=0;
  const text=str.replace(AI_CLEARCART_CONFIRM_TAG_RE,"").replace(/\s{2,}/g," ").trim();
  return {text:text||content,confirm:found};
}
const AI_REMOVECART_TAG_RE = /\[\[REMOVECART productId=([a-zA-Z0-9-]+)\]\]/g;
function parseAiRemoveCartTags(content) {
  const str = String(content || "");
  const items = [];
  let m;
  AI_REMOVECART_TAG_RE.lastIndex = 0;
  while ((m = AI_REMOVECART_TAG_RE.exec(str))) items.push({ productId: m[1] });
  const text = str.replace(AI_REMOVECART_TAG_RE, "").replace(/\s{2,}/g, " ").trim();
  return { text: text || content, items };
}
async function applyAiRemoveCartItems(items) {
  let removed = 0;
  for (const it of items) {
    const { error } = await sb.from("cart_items").delete().eq("buyer_id", session.user.id).eq("product_id", it.productId);
    if (!error) removed++;
  }
  if (removed) refreshNotifications();
  return { removed };
}
async function sendAiDraftMessage(vendorId, btn) {
  const card = btn.closest(".ai-chat-draft-card");
  let text = card.querySelector(".ai-chat-draft-text").value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const { data: v } = await sb.from("vendors").select("business_name, business_hours, allow_after_hours_messages").eq("id", vendorId).maybeSingle();
    if (v && !canMessageVendorNow(v)) {
      const status = vendorHoursStatus(v);
      showToast(`${v.business_name || "This vendor"} is outside working hours right now${status.todayText ? ` (${status.todayLabel}: ${status.todayText})` : ""}.`, "info");
      btn.disabled = false;
      return;
    }
    if (!(await ensureCustomerProfile())) throw new Error("Your account profile could not be repaired. Please refresh the app and try again.");
    let { data: conversationId, error } = await sb.rpc("get_or_create_conversation", { p_vendor_id: vendorId });
    if (error && /foreign key|buyer_id|vendor_id/i.test(error.message || "")) {
      await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure-profile", accessToken: session.access_token })
      }).catch(() => {});
      ({ data: conversationId, error } = await sb.rpc("get_or_create_conversation", { p_vendor_id: vendorId }));
    }
    if (error) throw new Error(/once you have placed an order/i.test(error.message || "") ? error.message : "We couldn't start this conversation. Please try again.");
    if (!(await conversationHasCompletedOrder(conversationId))) {
      if (messageContinuesDigitFragmentPattern(conversationId, text)) {
        throw new Error("Phone numbers and outside contact details can't be shared here until an order between you has completed.");
      }
      const masked = maskOrBlockContactInfo(text);
      if (masked === null) {
        throw new Error("Phone numbers and outside contact details can't be shared here until an order between you has completed.");
      }
      text = masked;
    }
    const { error: msgErr } = await sb.from("messages").insert({ conversation_id: conversationId, sender_id: session.user.id, body: text });
    if (msgErr) throw new Error(msgErr.message);
    card.innerHTML = `<div class="ai-chat-draft-label"><i class="fa-solid fa-check"></i> Sent</div>`;
    showToast("Message sent.", "success");
  } catch (err) {
    showToast(err.message, "error");
    btn.disabled = false;
  }
}
async function goToAiChatNav(nav) {
  if (!nav || !AI_NAV_ALLOWED_VIEWS.has(nav.view)) return;
  const closeLeviPanelHard = () => {
    try {
      const panel = byId("aiChatPanel");
      if (panel) {
        panel.classList.add("hidden");
        panel.classList.remove("expanded", "history-mode");
        panel.setAttribute("aria-hidden", "true");
        panel.style.setProperty("visibility", "hidden", "important");
        panel.style.setProperty("pointer-events", "none", "important");
      }
      syncLeviFabVisibility();
    } catch (_) {}
  };
  closeLeviPanelHard();

  try {
    if (nav.view === "profile") {
      openProfileOrShop();
      return;
    }
    if (nav.view === "settings") {
      await navigate("settings", {}, true);
      return;
    }
    const params = { ...(nav.params || {}) };
    if (nav.view === "productDetail") leviPendingProductRequest = null;
    if (nav.view === "requestEquipment" && params.prefill) {
      const title = decodeURIComponent(String(params.prefill));
      delete params.prefill;
      await navigate("requestEquipment", params, true);
      setTimeout(() => {
        const el = byId("reqTitle");
        if (el && !el.value) el.value = title.charAt(0).toUpperCase() + title.slice(1);
      }, 150);
      return;
    }
    await navigate(nav.view, params, true);
    if (nav.view === "vendors" && String(params.map || "").toLowerCase() === "true") {
      setTimeout(async () => {
        try {
          switchVendorsView("map");
          if (params.vendorId && typeof vendorsMap !== "undefined" && vendorsMap) {
            const marker = Array.isArray(vendorsMapMarkers) ? vendorsMapMarkers.find(m => String(m?.options?.vendorId || m?._levromartVendorId || "") === String(params.vendorId)) : null;
            if (marker) { vendorsMap.setView(marker.getLatLng(), 15, { animate:true }); marker.openPopup?.(); }
          }
        } catch (_) {}
      }, 120);
    }
    if (nav.view === "home" && params.section) {
      requestAnimationFrame(() => {
        const target = params.section === "vendors"
          ? document.querySelector("#app .top-rated-vendors-scroll")
          : document.querySelector("#app #browseSection");
        target?.scrollIntoView({ behavior:"smooth", block:"start" });
      });
    }
  } catch (err) {
    console.warn("Levi navigation failed:", err);
  } finally {
    closeLeviPanelHard();
    syncLeviFabVisibility();
    try { animateAiFabPointing(); } catch (_) {}
  }
}
// A little flourish so tapping "Take me there" feels like Levi is
// physically pointing the way rather than just silently redirecting.
function animateAiFabPointing() {
  return new Promise((resolve) => {
    const fab = byId("aiChatFab");
    const logo = byId("aiChatFabLogo");
    if (!fab || !logo) { resolve(); return; }
    fab.classList.add("directing");
    logo.classList.add("hidden");
    const hand = document.createElement("i");
    hand.className = "fa-solid fa-hand-point-right ai-chat-fab-hand";
    fab.appendChild(hand);
    setTimeout(() => {
      fab.classList.remove("directing");
      hand.remove();
      logo.classList.remove("hidden");
      resolve();
    }, 650);
  });
}
const AI_PRODUCTS_TAG_RE=/\[\[PRODUCTS:([a-zA-Z0-9,-]+)\]\]/;
function parseAiProductTags(content){const str=String(content||"");const m=AI_PRODUCTS_TAG_RE.exec(str);if(!m)return{text:str,ids:[]};return{text:(str.slice(0,m.index)+str.slice(m.index+m[0].length)).replace(/\s{2,}/g," ").trim(),ids:m[1].split(",").filter(Boolean).slice(0,6)};}
async function renderLeviSuggestedProducts(el, ids){
  if(!el||!ids?.length)return; const {data}=await sb.from("products").select("id,name,sale_price,discount_price,quantity_available,photos,vendor:vendors(business_name)").in("id",ids).eq("status","active").eq("is_service",false); const rows=(data||[]).filter(p=>Number(p.quantity_available??0)>0); if(!rows.length)return;
  const box=document.createElement("div");box.className="ai-product-suggestions";box.innerHTML=`<div class="ai-product-suggestions-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Maybe you meant:</div><div class="ai-product-suggestions-grid">${rows.map(p=>`<button type="button" class="ai-product-suggestion" onclick="goToAiChatNav({view:'productDetail',params:{productId:'${p.id}'}})">${p.photos?.[0]?`<img src="${esc(p.photos[0])}" alt="" loading="lazy">`:`<span class="ai-product-suggestion-img"><i class="fa-solid fa-box"></i></span>`}<span class="ai-product-suggestion-copy"><strong>${esc(p.name)}</strong><small>${p.discount_price&&Number(p.discount_price)<Number(p.sale_price||Infinity)?naira(p.discount_price):p.sale_price!=null?naira(p.sale_price):"View product"}</small><em>${Number(p.quantity_available)} available</em></span></button>`).join("")}</div>`;el.appendChild(box);
}

function appendAiChatMessage(role, content, autoSpeak, isReplay, msgId, existingReaction, createdAt) {
  let displayText = content;
  let nav = null;
  let draft = null;
  let cartItems = null;
  let removeCartItems = null;
  let clearCart = false;
  let clearCartConfirm = false;
  let suggestedProducts = null;
  if (role === "assistant") {
    const parsedNav = parseAiNavTag(content);
    const parsedDraft = parseAiDraftMsgTag(parsedNav.text);
    const parsedCart = parseAiAddCartTags(parsedDraft.text);
    const parsedRemoveCart = parseAiRemoveCartTags(parsedCart.text);
    const parsedSync = parseAiCartSyncTag(parsedRemoveCart.text);
    const parsedClearCart = parseAiClearCartTag(parsedSync.text);
    const parsedClearConfirm = parseAiClearCartConfirmTag(parsedClearCart.text);
    const parsedProducts = parseAiProductTags(parsedClearConfirm.text);
    displayText = parsedProducts.text;
    if (!isReplay && parsedSync.sync) { try { updateCartFab(); refreshNotifications(); } catch (_) {} }
    clearCart = isReplay ? false : parsedClearCart.clear;
    clearCartConfirm = isReplay ? false : parsedClearConfirm.confirm;
    suggestedProducts = isReplay ? [] : parsedProducts.ids;
    // Re-showing a past conversation shouldn't replay its side effects --
    // an old "take you there" tag (or an old cart add/remove) firing again
    // would yank someone away, or re-apply a cart change, on a conversation
    // they're just re-reading.
    nav = parsedNav.nav;
    draft = parsedDraft.draft;
    cartItems = isReplay ? [] : parsedCart.items;
    removeCartItems = isReplay ? [] : parsedRemoveCart.items;
  }
  if (role !== "typing") aiChatMessages.push({ role, content: displayText });
  const wrap = byId("aiChatMessages");
  if (role !== "typing") {
    const ts = createdAt || Date.now();
    const key = chatDateKey(ts);
    if (key !== aiChatLastDateKey) {
      const sep = document.createElement("div");
      sep.className = "conv-date-sep";
      sep.textContent = chatDateLabel(ts);
      wrap.appendChild(sep);
      aiChatLastDateKey = key;
    }
  }
  const el = document.createElement("div");
  el.className = `ai-chat-msg ${role === "typing" ? "assistant" : role}`;
  if (msgId) el.dataset.msgId = msgId;
  if (role === "typing") { el.id = "aiChatTyping"; el.innerHTML = `<i class="fa-solid fa-ellipsis" style="opacity:.6;"></i>`; }
  else {
    el.textContent = displayText;
    // Copy is long-press only now (matches the vendor/buyer messaging chat's
    // own long-press-to-copy), not a persistent visible button under every
    // message.
    bindAiChatMessageLongPressCopy(el, displayText);
    if (role === "assistant" && "speechSynthesis" in window) {
      const speakBtn = document.createElement("button");
      speakBtn.className = "ai-chat-msg-speak";
      speakBtn.title = "Read aloud";
      speakBtn.innerHTML = `<i class="fa-solid fa-volume-high"></i>`;
      speakBtn.onclick = () => speakAiChatMessage(displayText, speakBtn);
      el.appendChild(speakBtn);
      // Levi never reads replies automatically. Voice input only transcribes;
      // the user explicitly taps the speaker button when they want audio.
    }
    if (role === "assistant" && msgId) attachAiReactionUI(el, msgId, existingReaction);
    if (nav) {
      const navHint = document.createElement("button");
      navHint.type = "button";
      navHint.className = "ai-chat-nav-btn";
      navHint.innerHTML = `<i class="fa-solid fa-arrow-right"></i> Take me there`;
      navHint.title = "Open this destination";
      navHint.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        goToAiChatNav(nav);
      });
      el.appendChild(navHint);
    }
    if (draft) {
      const card = document.createElement("div");
      card.className = "ai-chat-draft-card";
      card.innerHTML = `<div class="ai-chat-draft-label"><i class="fa-solid fa-pen"></i> Draft message to <span class="ai-chat-draft-vendor">a vendor</span></div>
        <textarea class="ai-chat-draft-text" rows="3">${esc(draft.message)}</textarea>
        <div class="ai-chat-draft-actions">
          <button class="btn btn-sm btn-outline" onclick="this.closest('.ai-chat-draft-card').remove()">Discard</button>
          <button class="btn btn-sm" onclick="sendAiDraftMessage('${draft.vendorId}', this)"><i class="fa-solid fa-paper-plane"></i> Send</button>
        </div>`;
      el.appendChild(card);
      sb.from("vendors").select("business_name").eq("id", draft.vendorId).maybeSingle().then(({ data }) => {
        const span = card.querySelector(".ai-chat-draft-vendor");
        if (span && data?.business_name) span.textContent = data.business_name;
      });
    }
    if (suggestedProducts && suggestedProducts.length) renderLeviSuggestedProducts(el, suggestedProducts);
    if (clearCartConfirm) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "ai-chat-nav-btn";
      clearBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Clear cart`;
      clearBtn.onclick = async () => {
        clearBtn.disabled = true;
        try {
          const { data: rows, error } = await sb.from("cart_items").select("id").eq("buyer_id", session.user.id);
          if (error) throw error;
          if (!rows?.length) { clearBtn.innerHTML = `<i class="fa-solid fa-check"></i> Cart already empty`; return; }
          const ok = await showConfirmDialog(`Remove all ${rows.length} item${rows.length === 1 ? "" : "s"} from your cart?`, { title:"Clear cart", okLabel:"Clear cart", danger:true });
          if (!ok) { clearBtn.disabled = false; return; }
          const { error: delErr } = await levroData.cart.clear(session.user.id);
          if (delErr) throw delErr;
          updateCartFab(); refreshNotifications();
          clearBtn.innerHTML = `<i class="fa-solid fa-check"></i> Cart cleared`;
        } catch (_) {
          clearBtn.disabled = false;
          clearBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Couldn't clear cart`;
        }
      };
      el.appendChild(clearBtn);
    }
    if (clearCart) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "ai-chat-nav-btn";
      clearBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Clear cart`;
      clearBtn.onclick = async () => {
        clearBtn.disabled = true;
        try {
          const { data: rows, error } = await sb.from("cart_items").select("id").eq("buyer_id", session.user.id);
          if (error) throw error;
          if (!rows?.length) { clearBtn.innerHTML = `<i class="fa-solid fa-check"></i> Cart already empty`; return; }
          const ok = await showConfirmDialog(`Remove all ${rows.length} item${rows.length===1?"":"s"} from your cart?`, { title:"Clear cart", okLabel:"Clear cart", danger:true });
          if (!ok) { clearBtn.disabled=false; return; }
          const { error: delErr } = await levroData.cart.clear(session.user.id);
          if (delErr) throw delErr;
          updateCartFab(); refreshNotifications();
          clearBtn.innerHTML = `<i class="fa-solid fa-check"></i> Cart cleared`;
          setTimeout(() => goToAiChatNav({view:"cart",params:{}}), 120);
        } catch (_) { clearBtn.disabled=false; clearBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Couldn't clear cart`; }
      };
      el.appendChild(clearBtn);
    }
    if ((cartItems && cartItems.length) || (removeCartItems && removeCartItems.length)) {
      const navHint = document.createElement("div");
      navHint.className = "ai-chat-cart-action";
      navHint.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Updating your cart…`;
      el.appendChild(navHint);
      Promise.all([
        cartItems && cartItems.length ? applyAiAddCartItems(cartItems) : Promise.resolve({ added: 0, failed: 0 }),
        removeCartItems && removeCartItems.length ? applyAiRemoveCartItems(removeCartItems) : Promise.resolve({ removed: 0 }),
      ]).then(([addResult, removeResult]) => {
        const parts = [];
        if (addResult.added) parts.push(`${addResult.added} added`);
        if (addResult.failed) parts.push(`${addResult.failed} couldn't be added`);
        if (removeResult.removed) parts.push(`${removeResult.removed} removed`);
        navHint.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> ${parts.join(", ") || "Cart updated"}`;
        updateCartFab();
        refreshNotifications();
        if (addResult.added || removeResult.removed) {
          const viewCartBtn = document.createElement("button");
          viewCartBtn.type = "button";
          viewCartBtn.className = "ai-chat-nav-btn";
          viewCartBtn.innerHTML = `<i class="fa-solid fa-arrow-right"></i> View cart`;
          viewCartBtn.onclick = () => goToAiChatNav({ view: "cart", params: {} });
          el.appendChild(viewCartBtn);
          setTimeout(() => goToAiChatNav({ view: "cart", params: {} }), 260);
        }
      });
    }
  }
  wrap.appendChild(el);
  if (nav && !isReplay && role === "assistant") {
    setTimeout(() => { goToAiChatNav(nav); }, 18);
  }
  // Both sides of a Levi conversation support a simple long-press Copy action.
  // Keep it on the message bubble itself so users can copy their own prompt
  // just as easily as Levi's reply.
  if (role !== "typing") attachAiLongPressCopyUI(el);
  wrap.scrollTop = wrap.scrollHeight;
  updateAiChatBottomButton();
  return el;
}

function attachAiLongPressCopyUI(el) {
  if (!el || el.dataset.aiLongPressCopyReady === "1") return;
  el.dataset.aiLongPressCopyReady = "1";
  el.style.webkitTouchCallout = "default";
  el.style.userSelect = "text";

  let timer = null;
  let startX = 0;
  let startY = 0;
  let longPressed = false;

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const messageText = () => {
    const text = el.classList.contains("assistant")
      ? displayTextForAiElement(el)
      : String(el.textContent || "").trim();
    return text;
  };

  const isInteractive = (target) => !!target?.closest?.(
    'button,a,input,textarea,select,.ai-chat-message-menu,.ai-chat-nav-hint,.ai-chat-draft-card,.ai-chat-msg-speak,.ai-chat-msg-user-copy,.reaction-picker,.ai-chat-copy-row'
  );

  const positionCopyMenu = (menu) => {
    const r = el.getBoundingClientRect();
    const gap = 8;
    // Measure the real fixed-position menu before choosing its side.
    menu.style.left = "0px";
    menu.style.top = "0px";
    const mr = menu.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom - gap;
    const roomAbove = r.top - gap;
    const openAbove = roomBelow < mr.height && roomAbove >= mr.height;
    let top = openAbove ? r.top - mr.height - gap : r.bottom + gap;
    let left = el.classList.contains("user") ? r.right - mr.width : r.left;
    const edge = 8;
    left = Math.max(edge, Math.min(left, window.innerWidth - mr.width - edge));
    top = Math.max(edge, Math.min(top, window.innerHeight - mr.height - edge));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const showCopyMenu = (evt) => {
    const text = messageText();
    if (!text || isInteractive(evt?.target)) return;
    clearTimer();
    longPressed = true;
    evt?.preventDefault?.();
    evt?.stopPropagation?.();
    closeAiMessageMenu();

    const menu = document.createElement("div");
    menu.className = "ai-chat-message-menu ai-chat-longpress-copy-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<button type="button" role="menuitem" aria-label="Copy message"><i class="fa-regular fa-copy"></i><span>Copy</span></button>`;
    const btn = menu.querySelector("button");
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await copyAiMessageText(e, text);
      closeAiMessageMenu();
    };
    document.body.appendChild(menu);
    requestAnimationFrame(() => positionCopyMenu(menu));
  };

  el.addEventListener("pointerdown", (evt) => {
    if (evt.pointerType === "mouse" && evt.button !== 0) return;
    if (isInteractive(evt.target)) return;
    clearTimer();
    longPressed = false;
    startX = evt.clientX;
    startY = evt.clientY;
    timer = setTimeout(() => showCopyMenu(evt), 520);
  }, { passive: false });

  el.addEventListener("pointermove", (evt) => {
    if (!timer) return;
    if (Math.hypot(evt.clientX - startX, evt.clientY - startY) > 10) clearTimer();
  }, { passive: true });

  el.addEventListener("pointerup", (evt) => {
    if (longPressed) {
      evt.preventDefault();
      evt.stopPropagation();
      longPressed = false;
    }
    clearTimer();
  }, { passive: false });

  el.addEventListener("pointercancel", clearTimer, { passive: true });

  el.addEventListener("contextmenu", (evt) => {
    if (isInteractive(evt.target)) return;
    showCopyMenu(evt);
  });
}

// A single-user conversation only ever needs one reaction per message
// (no need to aggregate across people, unlike buyer/vendor chat), so this
// is just a react button plus, once picked, a small pill showing the choice.
function attachAiReactionUI(el, msgId, existingReaction) {
  // Levi responses intentionally have no inline copy/thumbs-up/thumbs-down/
  // three-dot toolbar. The response surface remains normal selectable text,
  // while speech controls and the chat itself keep their existing behaviour.
  // This also prevents the old cramped controls from appearing under every
  // response on small screens.
  let lastTap = 0, lastTapX = 0, lastTapY = 0;
  const isMessageSurface = (target) => {
    if (!target || target.closest?.('button,a,input,textarea,select,.reaction-picker,.ai-chat-nav-hint,.ai-chat-draft-card,.ai-chat-message-menu')) return false;
    return target.closest?.('.ai-chat-msg') === el;
  };
  el.addEventListener('touchend', (evt) => {
    if (!isMessageSurface(evt.target)) return;
    const touch = evt.changedTouches?.[0];
    if (!touch) return;
    const now = Date.now();
    const dx = touch.clientX - lastTapX, dy = touch.clientY - lastTapY;
    if (now - lastTap < 360 && Math.hypot(dx, dy) < 34) {
      evt.preventDefault();
      lastTap = 0;
      // Preserve the existing double-tap feedback behaviour without exposing
      // the old inline action row.
      reactToAiMessage(evt, msgId, "👍");
    } else {
      lastTap = now; lastTapX = touch.clientX; lastTapY = touch.clientY;
    }
  }, { passive: false });
}

function displayTextForAiElement(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(".ai-chat-action-row,.ai-chat-message-menu,.ai-chat-nav-hint,.ai-chat-draft-card,.ai-chat-msg-speak,.ai-chat-msg-user-copy,.reaction-picker,.ai-chat-copy-row").forEach((n) => n.remove());
  return (clone.textContent || "").trim();
}
function bindAiChatMessageLongPressCopy(el, text) {
  const LONG_PRESS_MS = 460;
  const MOVE_TOLERANCE = 14;
  let timer = null, sx = 0, sy = 0, moved = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove("ai-chat-msg-long-pressing"); };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clear(); sx = e.clientX || 0; sy = e.clientY || 0; moved = false;
    timer = setTimeout(() => {
      if (moved) return;
      el.classList.remove("ai-chat-msg-long-pressing");
      if (navigator.vibrate) navigator.vibrate(12);
      copyAiMessageText(null, text);
      timer = null;
    }, LONG_PRESS_MS);
    if (e.pointerType === "touch" || e.pointerType === "pen") el.classList.add("ai-chat-msg-long-pressing");
  });
  el.addEventListener("pointermove", (e) => {
    if (!timer) return;
    if (Math.abs((e.clientX || 0) - sx) > MOVE_TOLERANCE || Math.abs((e.clientY || 0) - sy) > MOVE_TOLERANCE) { moved = true; clear(); }
  });
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointercancel", clear);
  el.addEventListener("pointerleave", clear);
}
async function copyAiMessageText(evt, text) {
  evt?.stopPropagation?.();
  const value = String(text || "").trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied.", "success");
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = value; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); showToast("Copied.", "success"); }
    catch (_) { showToast("Couldn't copy this response.", "error"); }
    ta.remove();
  }
}
function toggleAiMessageMenu(evt, msgId, el) {
  // Kept for compatibility with any older callers: Levi's message menu is
  // intentionally just one clean Copy action now.
  evt?.preventDefault?.();
  evt?.stopPropagation?.();
  const text = el?.classList?.contains("assistant") ? displayTextForAiElement(el) : String(el?.textContent || "").trim();
  if (!text || !el) return;
  document.querySelectorAll(".ai-chat-message-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "ai-chat-message-menu ai-chat-longpress-copy-menu";
  menu.innerHTML = `<button type="button" aria-label="Copy message"><i class="fa-regular fa-copy"></i><span>Copy</span></button>`;
  menu.querySelector("button").onclick = async (e) => { await copyAiMessageText(e, text); closeAiMessageMenu(); };
  el.appendChild(menu);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < rect.height + 10 && rect.top >= rect.height + 10) menu.classList.add("opens-up");
  });
}

function closeAiMessageMenu() { document.querySelectorAll(".ai-chat-message-menu").forEach((m) => m.remove()); }
// Dismiss the long-press Copy menu immediately when the user taps elsewhere,
// presses Escape, or opens another message menu. The menu never lingers just
// because the user decided not to copy anything.
if (!window.__leviCopyMenuDismissBound) {
  window.__leviCopyMenuDismissBound = true;
  document.addEventListener("pointerdown", (evt) => {
    // Any tap outside the floating menu dismisses it immediately, including
    // a tap on another message. This keeps the menu from lingering when the
    // user simply changes their mind or starts interacting elsewhere.
    if (!evt.target.closest?.(".ai-chat-message-menu.ai-chat-longpress-copy-menu")) closeAiMessageMenu();
  }, { capture: true, passive: true });
  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") closeAiMessageMenu();
  });
  window.addEventListener("resize", () => closeAiMessageMenu(), { passive: true });
  window.addEventListener("scroll", () => closeAiMessageMenu(), { passive: true, capture: true });
}

async function retryAiMessage(msgId) {
  closeAiMessageMenu();
  let prompt = "";
  try {
    if (msgId) {
      const { data: current } = await sb.from("ai_messages").select("conversation_id,created_at").eq("id", msgId).maybeSingle();
      if (current?.conversation_id) {
        const { data: rows } = await sb.from("ai_messages").select("role,content,created_at").eq("conversation_id", current.conversation_id).order("created_at", { ascending: true });
        const idx = (rows || []).findIndex((r) => String(r.created_at) === String(current.created_at) && r.role === "assistant");
        if (idx >= 0) prompt = [...(rows || [])].slice(0, idx).reverse().find((r) => r.role === "user")?.content || "";
      }
    }
  } catch (_) {}
  if (!prompt) prompt = [...aiChatMessages].reverse().find((m) => m.role === "user")?.content || "";
  const input = byId("aiChatInput");
  if (!prompt || !input) return showToast("I couldn't find the message to retry.", "error");
  input.value = prompt;
  autoGrowChatInput(input);
  await sendAiChatMessage();
}
async function searchFromLeviMenu() {
  closeAiMessageMenu();
  const q = await showTextPromptDialog("Search Levromart", "Search products, services, vendors or packages.", { placeholder: "What are you looking for?", okLabel: "Search" });
  if (!q || !q.trim()) return;
  toggleAiChat();
  await navigate("search", {}, true);
  setTimeout(() => {
    const input = byId("searchPageInput");
    if (input) { input.value = q.trim(); runSearchPageQuery(q.trim(), true); }
  }, 120);
}

async function toggleAiReactionPicker(evt, msgId, el) {
  evt.stopPropagation();
  if (evt.type === "dblclick") evt.preventDefault();
  const existing = el.querySelector(".reaction-picker");
  document.querySelectorAll(".reaction-picker").forEach((p) => p.remove());
  if (existing) return;
  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  picker.setAttribute("role", "toolbar");
  picker.setAttribute("aria-label", "Choose a reaction");
  picker.innerHTML = REACTION_EMOJIS.map((e) => `<button type="button" aria-label="React ${e}" onclick="reactToAiMessage(event,'${msgId}','${e}')">${e}</button>`).join("");
  el.appendChild(picker);
  requestAnimationFrame(() => positionReactionPicker(picker, el));
}
async function reactToAiMessage(evt, msgId, emoji) {
  evt.stopPropagation();
  document.querySelectorAll(".reaction-picker").forEach((p) => p.remove());
  const { data, error } = await sb.rpc("toggle_ai_message_reaction", { p_message_id: msgId, p_emoji: emoji });
  if (error) { showToast(error.message, "error"); return; }
  const messageEl = document.querySelector(`.ai-chat-msg[data-msg-id="${msgId}"]`);
  if (messageEl) {
    messageEl.querySelectorAll(".ai-feedback-btn").forEach((btn) => {
      const isUp = btn.getAttribute("aria-label") === "Thumbs up";
      const isDown = btn.getAttribute("aria-label") === "Thumbs down";
      btn.classList.toggle("active", (isUp && data === "👍") || (isDown && data === "👎"));
    });
  }
}
