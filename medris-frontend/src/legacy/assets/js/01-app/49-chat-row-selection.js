// ---------- CHAT ROW SELECTION ----------
function handleConvRowClick(event, conversationId) {
  if (event) event.preventDefault();
  const clicked = event?.currentTarget;
  if (clicked?.dataset.longPressConsumed === '1') { delete clicked.dataset.longPressConsumed; return; }
  if (msgSelectMode) {
    toggleMsgSelected(conversationId);
    return;
  }
  navigate("messages", { conversationId });
}

function setMsgListFilter(f) {
  msgListFilter = f;
  navigate("messages", {}, false);
}

function backFromMessagesInbox() {
  const target = (lastNonSettingsView && lastNonSettingsView !== "messages") ? lastNonSettingsView : "home";
  navigate(target, {}, false);
}

function filterMsgList() {
  cleanupExpiredChatPins().catch(()=>{});
  const wrap = byId("convListWrap");
  if (!wrap) return;
  const deletedIds = getDeletedChatIds();
  const convs = (window.__conversations || []).filter((c) => !deletedIds.has(String(c.conversation_id)));
  const q = (byId("msgSearchInput")?.value || "").trim().toLowerCase();
  let shown = convs;
  let emptyReason = "No conversations yet.";
  const archivedIds = getArchivedChatIds();
  if (msgListFilter === "unread") {
    shown = convs.filter((c) => c.unread_count > 0 && !archivedIds.has(c.conversation_id));
    emptyReason = "Nothing unread.";
  } else if (msgListFilter === "archived") {
    shown = convs.filter((c) => archivedIds.has(c.conversation_id));
    emptyReason = "No archived chats.";
  } else if (msgListFilter.startsWith("list:")) {
    const listId = msgListFilter.slice(5);
    const list = myChatLists.find((l) => l.id === listId);
    shown = list ? convs.filter((c) => list.conversation_ids.includes(c.conversation_id) && !archivedIds.has(c.conversation_id)) : [];
    emptyReason = `No chats in "${list?.name || "this list"}" yet - tap the list icon on a chat to add it.`;
  }
  if (msgListFilter === "all") shown = shown.filter((c) => !archivedIds.has(c.conversation_id));
  if (q) shown = shown.filter((c) => (c.other_name || "").toLowerCase().includes(q) || (c.last_message || "").toLowerCase().includes(q));
  shown = [...shown].sort((a,b) => Number(isConversationPinned(b)) - Number(isConversationPinned(a)));
  wrap.innerHTML = shown.length ? shown.map(convRowHtml).join("") : `<div class="empty-state">${q ? "No conversations match that search." : emptyReason}</div>`;
}

// Refresh the cached conversation list without blocking navigation.
let conversationInboxRefreshPromise = null;
async function refreshConversationInboxInBackground() {
  if (conversationInboxRefreshPromise) return conversationInboxRefreshPromise;
  conversationInboxRefreshPromise = sb.rpc("list_my_conversations").then(({ data, error }) => {
    if (error) throw error;
    window.__convRaw = data; window.__convRawAt = Date.now();
    applyConversationsList(data);
    if (currentView === "messages" && !currentViewParams?.conversationId && byId("convListWrap")) {
      filterMsgList();
      updateMsgSelectionBar();
    }
  }).catch(() => {}).finally(() => { conversationInboxRefreshPromise = null; });
  return conversationInboxRefreshPromise;
}

