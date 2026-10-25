// ---------- SUGGESTION BOX ----------
// Free-form feedback, either to Levromart itself or to a specific vendor,
// with an optional anonymous toggle enforced at read time (see
// get_platform_suggestions/get_vendor_suggestions) so the recipient never
// sees who sent an anonymous one.
let suggestionTarget = { type: "platform", vendorId: null };
function lvSuggestionCount() {
  const t = byId("suggestionText"), c = byId("suggestionCount");
  if (t && c) c.textContent = `${t.value.length} / 2000`;
}
async function showSuggestionModal(type, vendorId) {
  if (!session) { showLogin(); return; }
  suggestionTarget = { type, vendorId: vendorId || null };
  byId("suggestionText").value = "";
  byId("suggestionAnon").checked = false;
  byId("suggestionError").classList.add("hidden");
  byId("suggestionModalTitle").textContent = "Suggest something to Levromart";
  byId("suggestionModalSub").textContent = "Your idea goes straight to the Levromart team.";
  lvSuggestionCount();
  byId("suggestionModal").classList.remove("hidden");
  trackModalOpened("suggestionModal");
  setTimeout(() => { try { byId("suggestionText").focus({ preventScroll: true }); } catch (_) {} }, 120);
  if (type === "vendor" && vendorId) {
    const { data } = await sb.from("vendors").select("business_name").eq("id", vendorId).maybeSingle();
    byId("suggestionModalTitle").textContent = `Suggest something to ${data?.business_name || "this vendor"}`;
    byId("suggestionModalSub").textContent = "Help this shop get better. They can reply to you.";
  }
}
function closeSuggestionModal() {
  byId("suggestionModal").classList.add("hidden");
  if (dismissibleModalId === "suggestionModal") dismissibleModalId = null;
}
async function submitSuggestion() {
  const errorEl = byId("suggestionError");
  errorEl.classList.add("hidden");
  const message = byId("suggestionText").value.trim();
  if (!message) { errorEl.textContent = "Write something first."; errorEl.classList.remove("hidden"); return; }
  const btn = byId("suggestionSubmitBtn");
  btn.disabled = true;
  const { error } = await sb.rpc("submit_suggestion", {
    p_target_type: suggestionTarget.type,
    p_target_vendor_id: suggestionTarget.vendorId,
    p_message: message,
    p_is_anonymous: byId("suggestionAnon").checked,
  });
  btn.disabled = false;
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  closeSuggestionModal();
  showToast("Sent. Thank you!", "success");
}

// Admin-only: jump to the (read-only) chat thread between the two parties
// on a disputed order, as evidence. Doesn't create a conversation if none
// exists yet - an admin viewing a dispute shouldn't be the one starting a
// buyer-vendor thread.
async function openDisputeChat(buyerId, vendorId) {
  const { data: conversationId, error } = await sb.rpc("admin_find_conversation", { p_buyer_id: buyerId, p_vendor_id: vendorId });
  if (error) { showToast(error.message, "error"); return; }
  if (!conversationId) { showToast("No messages between this buyer and vendor.", "info"); return; }
  navigate("messages", { conversationId });
}

let msgListFilter = "all"; // all | unread | archived | list:<listId>
let myChatLists = []; // [{id, name, conversation_ids}]

// The database should contain one buyer↔vendor thread, but older data can
// contain duplicate conversation rows for the same participant pair. Keep the
// inbox clean at the UI boundary while preserving the newest thread and the
// combined unread count. Prefer stable participant IDs when the RPC exposes
// them; fall back to name/avatar only for legacy RPC shapes.
function dedupeConversationRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byKey = new Map();
  const identity = (c) => {
    const meId = session?.user?.id;
    // Prefer the actual buyer↔vendor pair over a legacy other_user_id. Older
    // conversation RPCs can expose inconsistent participant ids for duplicate
    // rows; buyer_id/vendor_id are the canonical relationship.
    if (c.vendor_id && meId && String(c.buyer_id) === String(meId)) return `vendor:${c.vendor_id}`;
    if (c.buyer_id && meId && String(c.vendor_id) === String(vendor?.id)) return `buyer:${c.buyer_id}`;
    const stable = c.other_user_id || c.other_id || c.other_party_id || c.participant_id;
    if (stable) return `id:${stable}`;
    // list_my_conversations may expose the vendor id rather than the vendor's
    // user id. For a buyer, the vendor id is the stable counterpart; for a
    // vendor, the buyer id is the stable counterpart. This collapses legacy
    // duplicate threads without merging unrelated people.
    if (c.vendor_id && c.buyer_id) return `pair:${c.buyer_id}|${c.vendor_id}`;
    const name = String(c.other_name || "").trim().toLowerCase();
    const avatar = String(c.other_avatar || "").trim();
    const phone = String(c.other_phone || "").trim();
    return `legacy:${name}|${avatar}|${phone}`;
  };
  source.forEach((c) => {
    if (!c?.conversation_id) return;
    const key = identity(c);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c, mergedConversationIds: [c.conversation_id] });
      return;
    }
    const prevTime = new Date(prev.updated_at || prev.last_message_at || prev.created_at || 0).getTime();
    const nextTime = new Date(c.updated_at || c.last_message_at || c.created_at || 0).getTime();
    const winner = nextTime >= prevTime ? { ...c } : { ...prev };
    winner.unread_count = Number(prev.unread_count || 0) + Number(c.unread_count || 0);
    // Legacy duplicate threads for the same person are merged into one row
    // for display, but each raw conversation_id still needs to be marked
    // opened server-side when the user opens this thread - otherwise a
    // duplicate's unread messages never clear and keep re-summing into a
    // badge that won't go away.
    winner.mergedConversationIds = [...new Set([...(prev.mergedConversationIds || [prev.conversation_id]), ...(c.mergedConversationIds || [c.conversation_id])])];
    byKey.set(key, winner);
  });
  return [...byKey.values()].sort((a,b) => {
    const at = new Date(a.updated_at || a.last_message_at || a.created_at || 0).getTime();
    const bt = new Date(b.updated_at || b.last_message_at || b.created_at || 0).getTime();
    return bt - at;
  });
}

function chatArchiveKey() { return `levromart-archived-chats:${session?.user?.id || "guest"}`; }
function getArchivedChatIds() { try { const x = JSON.parse(localStorage.getItem(chatArchiveKey()) || "[]"); return new Set(Array.isArray(x) ? x : []); } catch (e) { return new Set(); } }
function setArchivedChatIds(set) { try { localStorage.setItem(chatArchiveKey(), JSON.stringify([...set])); } catch (e) {} }
function isChatArchived(id) { return getArchivedChatIds().has(id); }

// Deleted chats: hidden from every list (unlike Archive, there is no
// "deleted" tab to restore from) - a new incoming message un-deletes the
// thread automatically, same spirit as WhatsApp.
function chatDeletedKey() { return `levromart-deleted-chats:${session?.user?.id || "guest"}`; }
function getDeletedChatIds() { try { const x = JSON.parse(localStorage.getItem(chatDeletedKey()) || "[]"); return new Set(Array.isArray(x) ? x : []); } catch (e) { return new Set(); } }
function setDeletedChatIds(set) { try { localStorage.setItem(chatDeletedKey(), JSON.stringify([...set])); } catch (e) {} }
async function deleteChatConversation(conversationId) {
  const confirmed = await showConfirmDialog("Delete this chat? It will be removed from your messages. It comes back automatically if the other person sends a new message.", { title: "Delete chat", okLabel: "Delete", danger: true });
  if (!confirmed) return;
  const ids = getDeletedChatIds();
  ids.add(String(conversationId));
  setDeletedChatIds(ids);
  closeChatMenu();
  showToast("Chat deleted.", "success");
  navigate("messages", {}, false);
}
function applyConversationsList(rows) {
  const deduped = dedupeConversationRows(rows || []);
  // A deleted chat comes back on its own once a new, unread message arrives -
  // same as the archived-then-new-message convention elsewhere in the app.
  const deletedIds = getDeletedChatIds();
  if (deletedIds.size) {
    let changed = false;
    deduped.forEach((c) => { if (c.unread_count > 0 && deletedIds.delete(String(c.conversation_id))) changed = true; });
    if (changed) setDeletedChatIds(deletedIds);
  }
  window.__conversations = deduped;
  try { window.__lvSetChatIcon && window.__lvSetChatIcon(deduped.length > 0); } catch (_) {}
  try { if (session?.user?.id) localStorage.setItem("levro-convs-v1:" + session.user.id, JSON.stringify(deduped.slice(0, 80))); } catch (_) {}
  return deduped;
}
async function toggleChatArchived(conversationId) {
  const ids = getArchivedChatIds();
  if (ids.has(conversationId)) { ids.delete(conversationId); showToast("Chat restored.", "success"); }
  else { ids.add(conversationId); showToast("Chat archived.", "success"); }
  setArchivedChatIds(ids);
  navigate("messages", {}, false);
}
async function isUserBlocked(otherUserId) {
  if (!session?.user?.id || !otherUserId) return false;
  const { data } = await sb.from("blocked_users").select("blocked_id").eq("blocker_id", session.user.id).eq("blocked_id", otherUserId).maybeSingle();
  return !!data;
}
async function toggleBlockChatUser(otherUserId, otherName, conversationId) {
  closeChatMenu();
  const blocked = await isUserBlocked(otherUserId);
  if (blocked) {
    const { error } = await sb.from("blocked_users").delete().eq("blocker_id", session.user.id).eq("blocked_id", otherUserId);
    if (error) { showToast(error.message, "error"); return; }
    showToast(`${otherName} unblocked.`, "success");
  } else {
    const confirmed = await showConfirmDialog(`Block ${otherName}? They won't be able to message you, and you won't be able to message them.`, { title: "Block user", okLabel: "Block", danger: true });
    if (!confirmed) return;
    const { error } = await sb.from("blocked_users").insert({ blocker_id: session.user.id, blocked_id: otherUserId });
    if (error) { showToast(error.message, "error"); return; }
    showToast(`${otherName} blocked.`, "success");
  }
  navigate("messages", { conversationId }, false);
}
function convRowHtml(c) {
  const name = c.other_name || "User";
  const isUnread = c.unread_count > 0;
  const archived = isChatArchived(c.conversation_id);
  const pinned = isConversationPinned(c);
  const selected = msgSelectMode && msgSelectedIds.has(c.conversation_id);
  const timeLabel = convRowTimeLabel(c.updated_at || c.last_message_at || c.created_at);
  // Pin/archive/add-to-list/mark-unread used to sit as three permanent
  // buttons on every row -- cluttered, and mostly-unused actions competing
  // for space with the actual message preview. A long press now enters the
  // multi-select mode (checkboxes, see setupBatchLongPressSelection) and
  // those actions live in the selection toolbar / a single chat's own menu.
  return `<div class="conv-row-wrap ${selected ? "selected" : ""}">
    <div class="conv-list-item ${selected ? "selected" : ""}" data-conversation-id="${c.conversation_id}" data-pinned="${pinned ? "1" : "0"}" data-archived="${archived ? "1" : "0"}" data-unread="${isUnread ? "1" : "0"}" onclick="handleConvRowClick(event,'${c.conversation_id}')">
      ${msgSelectMode ? `<span class="conv-select-check ${selected ? "active" : ""}" aria-hidden="true"><i class="fa-solid fa-check"></i></span>` : ""}
      ${profileAvatarHtml(c.other_avatar, name, "2.6rem", { lightbox: !!c.other_avatar && !msgSelectMode })}
      <div class="conv-meta">
        <div class="conv-name-row"><strong>${pinned ? `<i class="fa-solid fa-thumbtack conv-pinned-icon"></i> ` : ""}${esc(name)}</strong><span class="conv-time">${esc(timeLabel)}</span></div>
        <div class="conv-preview">${c.last_message ? esc(maskSensitiveNumbers(c.last_message)) : "No messages yet"}</div>
      </div>
      ${isUnread ? `<span class="conv-unread-badge" title="${c.unread_count} unread">${c.unread_count > 99 ? "99+" : c.unread_count}</span>` : ""}
      <i class="fa-solid fa-chevron-right conv-chev" aria-hidden="true"></i>
    </div>
  </div>`;
}
// A compact WhatsApp-style timestamp: clock time for today, weekday name
// for the last week, short date otherwise.
function convRowTimeLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
let msgSelectMode = false;
let msgSelectedIds = new Set();

function enterMsgSelectMode(id) {
  msgSelectMode = true;
  msgSelectedIds = id ? new Set([id]) : new Set();
  filterMsgList();
  updateMsgSelectionBar();
}
function exitMsgSelectMode() {
  msgSelectMode = false;
  msgSelectedIds.clear();
  filterMsgList();
}
function toggleMsgSelected(id) {
  if (!msgSelectMode) return;
  if (msgSelectedIds.has(id)) msgSelectedIds.delete(id); else msgSelectedIds.add(id);
  if (!msgSelectedIds.size) { msgSelectMode = false; }
  filterMsgList();
  updateMsgSelectionBar();
}
function toggleSelectAllChats() {
  const ids = getVisibleChatIds();
  if (!ids.length) return;
  if (ids.every((id) => msgSelectedIds.has(id))) msgSelectedIds.clear();
  else msgSelectedIds = new Set(ids);
  filterMsgList();
  updateMsgSelectionBar();
}
async function batchArchiveChats() {
  const ids = [...msgSelectedIds];
  if (!ids.length) return;
  const archivedIds = getArchivedChatIds();
  const restoring = msgListFilter === "archived";
  if (!(await showConfirmDialog(`${restoring ? "Restore" : "Archive"} ${ids.length} selected chat${ids.length === 1 ? "" : "s"}?`, {
    title: restoring ? "Restore chats" : "Archive chats",
    okLabel: restoring ? "Restore" : "Archive",
    danger: false
  }))) return;
  ids.forEach((id) => restoring ? archivedIds.delete(id) : archivedIds.add(id));
  setArchivedChatIds(archivedIds);
  exitMsgSelectMode();
  showToast(restoring ? `${ids.length} chat${ids.length === 1 ? "" : "s"} restored.` : `${ids.length} chat${ids.length === 1 ? "" : "s"} archived.`, "success");
}
function getVisibleChatIds() {
  const convs = window.__conversations || [];
  const archivedIds = getArchivedChatIds();
  let shown = convs;
  if (msgListFilter === "unread") {
    shown = convs.filter((c) => c.unread_count > 0 && !archivedIds.has(c.conversation_id));
  } else if (msgListFilter === "archived") {
    shown = convs.filter((c) => archivedIds.has(c.conversation_id));
  } else if (msgListFilter.startsWith("list:")) {
    const list = myChatLists.find((l) => l.id === msgListFilter.slice(5));
    shown = list ? convs.filter((c) => list.conversation_ids.includes(c.conversation_id) && !archivedIds.has(c.conversation_id)) : [];
  } else {
    shown = convs.filter((c) => !archivedIds.has(c.conversation_id));
  }
  const q = (byId("msgSearchInput")?.value || "").trim().toLowerCase();
  if (q) shown = shown.filter((c) => (c.other_name || "").toLowerCase().includes(q) || (c.last_message || "").toLowerCase().includes(q));
  return shown.map((c) => c.conversation_id);
}
async function batchMarkChatsRead(read) {
  const ids = msgSelectedIds.size ? [...msgSelectedIds] : getVisibleChatIds();
  if (!ids.length) { showToast(`No chats to mark as ${read ? "read" : "unread"}.`, "info"); return; }
  if (!(await showConfirmDialog(`Mark ${ids.length} chat${ids.length === 1 ? "" : "s"} as ${read ? "read" : "unread"}?`, {
    title: read ? "Mark as read" : "Mark as unread", okLabel: read ? "Mark read" : "Mark unread"
  }))) return;
  const convs = window.__conversations || [];
  const idsSet = new Set(ids);
  const work = ids.map((id) => {
    const c = convs.find((x) => x.conversation_id === id);
    const currentlyUnread = Number(c?.unread_count || 0) > 0;
    return currentlyUnread === !read ? Promise.resolve({ data: true }) : sb.rpc("toggle_conversation_unread", { p_conversation_id: id });
  });

  // Paint immediately; the server remains authoritative and is reconciled in
  // the background. This removes the visible 1 - 3 second pause after tapping.
  convs.forEach((c) => { if (idsSet.has(c.conversation_id)) c.unread_count = read ? 0 : Math.max(1, Number(c.unread_count || 0)); });
  msgSelectMode = false; msgSelectedIds.clear();
  filterMsgList(); updateMsgSelectionBar(); renderBottomNav();
  showToast(`${ids.length} chat${ids.length === 1 ? "" : "s"} marked ${read ? "read" : "unread"}.`, "success");

  Promise.allSettled(work).then((results) => {
    const failed = results.filter((r) => r.status === "rejected" || r.value?.error).length;
    if (failed) showToast(`${failed} chat${failed === 1 ? "" : "s"} could not be updated.`, "error");
    refreshNotifications(false).catch(() => {});
  });
}
function msgSelectionHeaderHtml() {
  if (!msgSelectMode) {
    return `<div class="messages-toolbar">
      <div class="messages-toolbar-title">
        <button type="button" class="messages-inbox-back" onclick="backFromMessagesInbox()" aria-label="Back" title="Back"><i class="fa-solid fa-arrow-left"></i></button>
        <h2><i class="fa-solid fa-comments"></i> Messages</h2>
      </div>
      <button type="button" class="icon-btn messages-more-btn" onclick="toggleInlineMenu('messagesMoreMenu',event)" aria-label="Message actions"><i class="fa-solid fa-ellipsis"></i></button>
      <div class="ms-list hidden messages-more-menu" id="messagesMoreMenu">
        <div class="lm-sheet-head"><strong>Chat actions</strong><button type="button" class="lm-x" onclick="toggleInlineMenu('messagesMoreMenu',event)" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <button type="button" class="ms-item" onclick="toggleInlineMenu('messagesMoreMenu',event);createChatListPrompt()"><i class="fa-solid fa-folder-plus"></i> New list</button>
        <button type="button" class="ms-item" onclick="enterMsgSelectMode();toggleInlineMenu('messagesMoreMenu',event)"><i class="fa-solid fa-check-double"></i> Select chats</button>
        <button type="button" class="ms-item" onclick="enterMsgSelectMode();toggleSelectAllChats();toggleInlineMenu('messagesMoreMenu',event)"><i class="fa-solid fa-square-check"></i> Select all chats</button>
        <button type="button" class="ms-item" onclick="batchMarkChatsRead(true);toggleInlineMenu('messagesMoreMenu',event)"><i class="fa-solid fa-envelope-open"></i> Mark all as read</button>
        <button type="button" class="ms-item" onclick="batchMarkChatsRead(false);toggleInlineMenu('messagesMoreMenu',event)"><i class="fa-solid fa-envelope"></i> Mark all as unread</button>
      </div>
    </div>`;
  }
  const visibleIds = getVisibleChatIds();
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => msgSelectedIds.has(id));
  const hasSel = msgSelectedIds.size > 0;
  const single = msgSelectedIds.size === 1;
  const onlyId = single ? [...msgSelectedIds][0] : "";
  const selConvs = (window.__conversations || []).filter((c) => msgSelectedIds.has(c.conversation_id));
  const anyUnread = selConvs.some((c) => Number(c.unread_count || 0) > 0);
  return `<div class="messages-selection-toolbar">
    <button type="button" class="icon-btn" onclick="exitMsgSelectMode()" aria-label="Cancel selection"><i class="fa-solid fa-xmark"></i></button>
    <strong class="msg-sel-count">${msgSelectedIds.size} selected</strong>
    <button type="button" class="icon-btn" onclick="toggleSelectAllChats()" aria-label="Select all"><i class="fa-solid ${allVisible ? "fa-square-minus" : "fa-square-check"}"></i></button>
    <button type="button" class="icon-btn" ${single ? `onclick="togglePinConversation('${onlyId}')"` : "disabled"} aria-label="Pin chat" title="${single ? "Pin chat" : "Select one chat to pin"}"><i class="fa-solid fa-thumbtack"></i></button>
    <button type="button" class="icon-btn" ${single ? `onclick="openChatListPicker('${onlyId}')"` : "disabled"} aria-label="Add to a list" title="${single ? "Add to a list" : "Select one chat to add to a list"}"><i class="fa-solid fa-layer-group"></i></button>
    <button type="button" class="icon-btn" onclick="batchMarkChatsRead(${anyUnread ? "true" : "false"})" ${hasSel ? "" : "disabled"} aria-label="${anyUnread ? "Mark as read" : "Mark as unread"}" title="${anyUnread ? "Mark as read" : "Mark as unread"}"><i class="fa-solid ${anyUnread ? "fa-envelope-open" : "fa-envelope"}"></i></button>
    <button type="button" class="icon-btn" onclick="batchArchiveChats()" ${hasSel ? "" : "disabled"} aria-label="${msgListFilter === "archived" ? "Restore" : "Archive"}"><i class="fa-solid ${msgListFilter === "archived" ? "fa-box-open" : "fa-box-archive"}"></i></button>
  </div>`;
}

function updateMsgSelectionBar() {
  const el = byId("messagesSelectionBar");
  if (el) el.innerHTML = msgSelectionHeaderHtml();
}

