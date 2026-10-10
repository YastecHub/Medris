// ---------- CUSTOM CHAT LISTS (WhatsApp-style user-made lists) ----------
async function refreshChatLists() {
  // A hiccup loading lists is a secondary-feature failure, not a reason to
  // take the whole Messages page down with a full-page error -- fail
  // quietly to "no lists yet" and let the actual conversation list render.
  try {
    const { data, error } = await sb.rpc("list_my_chat_lists");
    if (error) throw error;
    myChatLists = (data || []).map((l) => ({ ...l, conversation_ids: l.conversation_ids || [] }));
  } catch (e) {
    console.error("Could not load chat lists:", e);
    myChatLists = [];
  }
}
function archivedUnreadChatCount() {
  const archivedIds = getArchivedChatIds();
  return (window.__conversations || []).filter(c => archivedIds.has(c.conversation_id) && Number(c.unread_count || 0) > 0).length;
}
function chatListTabsHtml() {
  const archivedIds = getArchivedChatIds();
  const convs = window.__conversations || [];
  const unreadChats = convs.filter((c) => Number(c.unread_count || 0) > 0 && !archivedIds.has(c.conversation_id)).length;
  const badge = (n) => n ? `<span class="conv-unread-badge msg-tab-badge">${n > 99 ? "99+" : n}</span>` : "";
  const listTabs = myChatLists.map((l) => `<a role="tab" class="${msgListFilter === "list:" + l.id ? "active" : ""}" onclick="setMsgListFilter('list:${l.id}')">${esc(l.name)}</a>`).join("");
  const archivedUnread = archivedUnreadChatCount();
  return `<div class="msg-tabs-row"><div class="msg-tabs" role="tablist" aria-label="Conversation filter">
      <a role="tab" class="${msgListFilter === "all" ? "active" : ""}" onclick="setMsgListFilter('all')">All${badge(unreadChats)}</a>
      <a role="tab" class="${msgListFilter === "unread" ? "active" : ""}" onclick="setMsgListFilter('unread')">Unread${badge(unreadChats)}</a>
      <a role="tab" class="${msgListFilter === "archived" ? "active" : ""}" onclick="setMsgListFilter('archived')">Archived${badge(archivedUnread)}</a>
      ${listTabs}
      ${msgListFilter.startsWith("list:") ? `<a onclick="deleteChatListPrompt('${msgListFilter.slice(5)}')" title="Delete this list" aria-label="Delete this list" class="msg-tab-del"><i class="fa-solid fa-trash"></i></a>` : ""}
    </div></div>`;
}
async function createChatListPrompt() {
  const name = await showTextPromptDialog("New chat list", "Name this list (like WhatsApp's Favorites or Groups) to organize your own chats.", { placeholder: "e.g. Regular vendors", okLabel: "Create" });
  if (!name || !name.trim()) return;
  const { data: newId, error } = await sb.rpc("create_chat_list", { p_name: name.trim() });
  if (error) { showToast(error.message, "error"); return; }
  await refreshChatLists();
  msgListFilter = "list:" + newId;
  navigate("messages", {}, false);
}
async function deleteChatListPrompt(listId) {
  const list = myChatLists.find((l) => l.id === listId);
  if (!(await showConfirmDialog(`Delete the list "${list?.name || ""}"? Your chats themselves aren't affected.`, { title: "Delete list", okLabel: "Delete", danger: true }))) return;
  const { error } = await sb.rpc("delete_chat_list", { p_list_id: listId });
  if (error) { showToast(error.message, "error"); return; }
  msgListFilter = "all";
  await refreshChatLists();
  navigate("messages", {}, false);
}
async function openChatListPicker(conversationId) {
  if (!myChatLists.length) {
    const create = await showConfirmDialog("You don't have any lists yet. Create one now?", { title: "No lists yet", okLabel: "Create a list" });
    if (create) await createChatListPrompt();
    return;
  }
  const modal = byId("chatListPickerModal");
  byId("chatListPickerBody").innerHTML = myChatLists.map((l) => `<label class="flex" style="gap:0.6rem;padding:0.5rem 0;align-items:center;">
    <input type="checkbox" style="width:auto;" ${l.conversation_ids.includes(conversationId) ? "checked" : ""} onchange="toggleConversationInList('${l.id}','${conversationId}',this)" />
    ${esc(l.name)}
  </label>`).join("");
  modal.classList.remove("hidden");
  byId("chatListPickerClose").onclick = () => modal.classList.add("hidden");
}
async function toggleConversationInList(listId, conversationId, checkbox) {
  checkbox.disabled = true;
  const { error } = await sb.rpc("toggle_conversation_in_list", { p_list_id: listId, p_conversation_id: conversationId });
  checkbox.disabled = false;
  if (error) { showToast(error.message, "error"); checkbox.checked = !checkbox.checked; return; }
  await refreshChatLists();
  filterMsgList();
}

function chatPinStorageKey(){ return `levromart-chat-pins:${session?.user?.id||"guest"}`; }
function getChatPinMap(){ try{const raw=JSON.parse(localStorage.getItem(chatPinStorageKey())||"{}");return raw&&typeof raw==="object"?raw:{};}catch(_){return{};} }
function setChatPinMap(map){try{localStorage.setItem(chatPinStorageKey(),JSON.stringify(map||{}));}catch(_){} }
function getEffectivePinExpiry(conversationId){const v=getChatPinMap()[conversationId];return Number(v?.expiresAt||0)||0;}
function isConversationPinned(c){
  if(!c?.conversation_id)return false;
  const expiry=getEffectivePinExpiry(c.conversation_id);
  if(expiry && expiry<=Date.now())return false;
  return !!c.pinned || !!expiry;
}
async function cleanupExpiredChatPins(){
  const map=getChatPinMap(), expired=Object.entries(map).filter(([,v])=>Number(v?.expiresAt||0)>0 && Number(v.expiresAt)<=Date.now());
  if(!expired.length)return;
  expired.forEach(([id])=>delete map[id]); setChatPinMap(map);
  for(const [id] of expired) await sb.rpc("toggle_conversation_pin",{p_conversation_id:id}).catch(()=>{});
}
async function togglePinConversation(conversationId){
  const c=(window.__conversations||[]).find(x=>x.conversation_id===conversationId);
  const currentlyPinned=isConversationPinned(c);
  if(currentlyPinned){
    const {error}=await sb.rpc("toggle_conversation_pin",{p_conversation_id:conversationId});
    if(error){showToast(error.message,"error");return;}
    const map=getChatPinMap();delete map[conversationId];setChatPinMap(map);showToast("Chat unpinned.","success");navigate("messages",{},false);return;
  }
  const choice=await showTextPromptDialog("Pin chat","How long should this chat stay pinned? Enter 24h, 7d, or 30d.",{placeholder:"24h / 7d / 30d",okLabel:"Pin"});
  if(!choice)return;
  const key=String(choice).trim().toLowerCase(); const hours=key==="24h"||key==="24"?24:key==="7d"||key==="7"?168:key==="30d"||key==="30"?720:0;
  if(!hours){showToast("Choose 24h, 7d, or 30d.","info");return;}
  const {error}=await sb.rpc("toggle_conversation_pin",{p_conversation_id:conversationId});
  if(error){showToast(error.message,"error");return;}
  const map=getChatPinMap();map[conversationId]={expiresAt:Date.now()+hours*3600000};setChatPinMap(map);
  showToast(`Chat pinned for ${hours===24?"24 hours":hours===168?"7 days":"30 days"}.`,"success");navigate("messages",{},false);
}

// Lightweight instant-paint shell for opening a DM -- see the fast-path in
// navigate(). Uses only what's already cached client-side (inbox list +
// last-seen messages), so it can render before any network call for this
// conversation has resolved.
function chatSkeletonHtml(conversationId, cached, cachedMessages) {
  const name = cached.other_name || "Chat";
  const avatar = cached.other_avatar;
  const messagesArea = cachedMessages && cachedMessages.length
    ? chatMessagesWithDatesHtml(cachedMessages, chatBubbleHtml)
    : `<div class="chat-fast-empty" aria-live="polite"><span class="chat-loading-line"></span><span class="chat-loading-line short"></span><span class="chat-loading-line"></span></div>`;
  return `<div class="chat-page-wrap">
    <div class="chat-page-header">
      <button class="chat-header-back" onclick="navigate('messages')" title="Back"><i class="fa-solid fa-arrow-left"></i></button>
      ${profileAvatarHtml(avatar, name, "2.35rem", { extraClass: "chat-header-avatar", lightbox: false })}
      <div class="chat-header-name-wrap"><strong class="chat-header-name">${esc(name)}</strong><span class="chat-header-presence" id="chatHeaderPresence" aria-live="polite">${esc(window.__levroPresenceText?.(conversationId) || "")}</span></div>
      <div class="chat-header-actions">
        ${window.__levroCallBtnHtml?.(conversationId) || ""}
        <button class="chat-header-icon-btn" style="opacity:0.4;" disabled title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      </div>
    </div>
    <div id="chatPinnedStrip" class="chat-pinned-strip" aria-label="Pinned messages">${renderPinnedMessagesHtml(conversationId, cachedMessages || [], window.__chatPinsByConversation?.[conversationId] || [])}</div>
    <div class="chat-thread">
      <div class="chat-messages" id="chatMessages">${messagesArea}</div>
      <div class="chat-input-row">
        <textarea id="chatInput" rows="1" placeholder="Type a message…" oninput="window.__chatFastPaintDirty=true;autoGrowChatInput(this)" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!isCoarsePointer()){event.preventDefault();sendChatMessage('${conversationId}')}" ></textarea>
        <button class="btn btn-sm" onclick="sendChatMessage('${conversationId}')" aria-label="Send message"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    </div>
  </div>`;
}
async function enrichMessageReplies(messages) {
  const list = messages || [];
  const ids = [...new Set(list.map(m => m.reply_to_id).filter(Boolean))];
  if (!ids.length) return list;
  const { data } = await sb.from("messages").select("id,sender_id,body,attachment_name,deleted_at").in("id", ids);
  const byId = new Map((data || []).map(m => [m.id, m]));
  list.forEach(m => { if (m.reply_to_id) m.reply_to = byId.get(m.reply_to_id) || null; });
  return list;
}
