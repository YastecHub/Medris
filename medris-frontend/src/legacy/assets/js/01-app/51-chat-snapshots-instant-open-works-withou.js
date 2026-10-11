// ---------- CHAT SNAPSHOTS (instant open, works without data) ----------
// The last messages of each conversation are kept on this device, so opening a
// chat paints its history immediately -- no waiting on the network and no blank
// screen with poor or no mobile data. The fresh copy is fetched right after and
// reconciled into what is on screen.
const CHAT_SNAP_PREFIX = "levro-chat-v1:";
const CHAT_SNAP_INDEX = "levro-chat-v1-index";
const CHAT_SNAP_MAX_CHATS = 12, CHAT_SNAP_MAX_MSGS = 150;
function chatSnapRead(id) {
  try {
    const j = JSON.parse(localStorage.getItem(CHAT_SNAP_PREFIX + id) || "null");
    return j && session?.user?.id && j.uid === session.user.id ? j : null;
  } catch (_) { return null; }
}
function chatSnapWrite(id, snap) {
  if (!id || !session?.user?.id || !snap?.conv) return;
  try {
    const rec = { uid: session.user.id, at: Date.now(), other: snap.other, conv: snap.conv, pins: snap.pins || [], blocked: snap.blocked || [], messages: (snap.messages || []).slice(-CHAT_SNAP_MAX_MSGS) };
    localStorage.setItem(CHAT_SNAP_PREFIX + id, JSON.stringify(rec));
    let idx = []; try { idx = JSON.parse(localStorage.getItem(CHAT_SNAP_INDEX) || "[]"); } catch (_) {}
    idx = [id, ...idx.filter((x) => x !== id)];
    idx.slice(CHAT_SNAP_MAX_CHATS).forEach((old) => { try { localStorage.removeItem(CHAT_SNAP_PREFIX + old); } catch (_) {} });
    localStorage.setItem(CHAT_SNAP_INDEX, JSON.stringify(idx.slice(0, CHAT_SNAP_MAX_CHATS)));
  } catch (_) { chatSnapClearAll(); }
}
function chatSnapClearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("levro-chat-v1") || k.startsWith("levro-convs-v1")).forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}
// Save what is on screen for the open chat (new live messages included).
function chatSnapFlush() {
  const id = activeConversationId;
  const meta = window.__chatSnapMeta?.[id];
  const msgs = id ? lastSeenMessagesByConv.get(id) : null;
  if (id && meta && msgs?.length) chatSnapWrite(id, { ...meta, messages: msgs });
}
document.addEventListener("visibilitychange", () => { if (document.hidden) chatSnapFlush(); }, { passive: true });
window.addEventListener("pagehide", chatSnapFlush, { passive: true });
async function fetchChatBundle(conversationId) {
  const uid = session.user.id;
  const [o, c, m, pins, blocks, open] = await Promise.all([
    sb.rpc("get_conversation_other_party", { p_conversation_id: conversationId }),
    sb.from("conversations").select("id, buyer_id, vendor:vendors(id, business_name, logo_url, user_id, phone, whatsapp_number, whatsapp_visible)").eq("id", conversationId).maybeSingle(),
    sb.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(200),
    sb.from("message_pins").select("id,conversation_id,message_id,pinned_at,expires_at").eq("conversation_id", conversationId).eq("user_id", uid).order("pinned_at", { ascending: false }).limit(4),
    sb.from("blocked_users").select("blocked_id").eq("blocker_id", uid),
    sb.rpc("conversation_is_open", { p_conversation_id: conversationId }),
  ]);
  return {
    other: o.data, otherErr: o.error, conv: c.data, messages: (m.data || []).slice().reverse(), pins: pins.data || [],
    blocked: (blocks.data || []).map((x) => x.blocked_id),
    open: open.error ? true : open.data !== false,
    failed: !!(o.error || c.error || m.error),
  };
}
// A chat whose order finished more than 24 hours ago: it leaves the list and can't
// be opened or continued, but nothing is deleted. The next order with the same vendor
// brings the whole history back.
function chatEndedHtml() {
  return `<div class="empty-state chat-ended-state"><span class="orders-empty-icon"><i class="fa-regular fa-comment-dots"></i></span><strong>This chat has ended</strong><span class="muted">Chats close 24 hours after an order is completed. Your earlier messages are kept, and they will be here again if you place a new order with this vendor.</span><button type="button" class="btn btn-sm" onclick="navigate('messages')">Back to chats</button></div>`;
}
async function levroRevalidateChat(id) {
  try {
    const b = await fetchChatBundle(id);
    if (String(activeConversationId) !== String(id) || b.failed || !b.conv) return;
    if (!b.open) { const app = byId("app"); if (app) app.innerHTML = chatEndedHtml(); return; }
    await enrichMessageReplies(b.messages);
    window.__chatSnapMeta = window.__chatSnapMeta || {};
    window.__chatSnapMeta[id] = { other: b.other, conv: b.conv, pins: b.pins, blocked: b.blocked };
    window.__chatPinsByConversation = window.__chatPinsByConversation || {};
    window.__chatPinsByConversation[id] = (b.pins || []).filter((p) => !p.expires_at || new Date(p.expires_at).getTime() > Date.now());
    const el = byId("chatMessages");
    const old = lastSeenMessagesByConv.get(id) || [];
    const sig = (ms) => ms.map((m) => `${m.id}:${m.edited_at || ""}:${m.deleted_at || ""}:${m.read_at ? 1 : 0}:${m.body?.length || 0}`).join("|");
    const pending = el && [...el.querySelectorAll(".chat-bubble[data-msg-id]")].some((x) => !/^[0-9a-f-]{36}$/i.test(x.dataset.msgId || ""));
    if (el && !pending && sig(old) !== sig(b.messages)) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      const typing = byId("chatTypingIndicator");
      el.innerHTML = chatMessagesWithDatesHtml(b.messages, chatBubbleHtml);
      if (typing) el.appendChild(typing);
      lastSeenMessagesByConv.set(id, b.messages);
      if (atBottom) scrollChatToBottom();
      resolveVisibleAttachments(el); setupMessageInteractions(el);
    } else if (!pending) lastSeenMessagesByConv.set(id, b.messages);
    chatSnapWrite(id, { ...window.__chatSnapMeta[id], messages: b.messages });
  } catch (_) {}
}
async function renderMessages(conversationId) {
  if (conversationId) conversationId=String(conversationId);
  if (conversationId && !/^[a-zA-Z0-9-]+$/.test(conversationId)) return '<div class="empty-state">That conversation could not be opened.</div>';
  if (!session) return '<div class="empty-state">Log in to view your messages.</div>';
  if (conversationId) conversationId = String(conversationId);
  if (conversationId && !/^[a-zA-Z0-9-]+$/.test(conversationId)) return '<div class="empty-state">That conversation could not be opened.</div>';
  if (activeMsgChannel) {
    clearTimeout(typingStopTimer);
    clearTimeout(window.__levroTypingHideTimer);
    const oldChannel = activeMsgChannel;
    activeMsgChannel = null;
    try {
      const payload = { user_id: session?.user?.id, typing: false, at: Date.now() };
      oldChannel.track(payload).catch(() => {});
      oldChannel.send({ type: "broadcast", event: "typing", payload }).catch(() => {});
    } catch (_) {}
    messageChannelClosePromise = Promise.resolve(sb.removeChannel(oldChannel)).catch(() => {});
  }
  try { chatSnapFlush(); } catch (_) {}
  typingChannelConversationId = null;
  chatReplyTarget = null;
  chatSelectionMode = false;
  chatSelectedIds.clear();
  updateChatSelectionUi();
  setChatTypingIndicator(false);
  activeConversationId = conversationId || null;

  if (!conversationId) {
    const isVendor = !!vendor;
    // Show the last-known chat list straight away (even offline); it is refreshed in the background.
    if (!Array.isArray(window.__conversations) && session?.user?.id) {
      try { const saved = JSON.parse(localStorage.getItem("levro-convs-v1:" + session.user.id) || "null"); if (Array.isArray(saved)) window.__conversations = saved; } catch (_) {}
    }
    const hasCachedConversations = Array.isArray(window.__conversations);
    if (!hasCachedConversations) {
      const { data: convs, error } = await sb.rpc("list_my_conversations");
      if (error) return errorStateHtml(error);
      applyConversationsList(convs);
      await refreshChatLists();
    } else {
      // Back from a chat should be instant. Reconcile the inbox in the
      // background instead of making the back arrow wait on RPCs again.
      refreshConversationInboxInBackground();
      refreshChatLists();
    }

    const convs = window.__conversations || [];
    if (convs.length === 0) {
      return `<div id="messagesSelectionBar">${msgSelectionHeaderHtml()}</div><div class="empty-state orders-empty chats-empty"><span class="orders-empty-icon"><i class="fa-regular fa-comments"></i></span><strong>No chats right now</strong><span class="muted">${isVendor ? "A chat opens when you accept a customer's order and closes 24 hours after it is completed." : "A chat opens when a vendor accepts your order and closes 24 hours after it is completed."} Past messages are kept and come back with your next order together.</span></div>`;
    }

    let html = `<div id="messagesSelectionBar">${msgSelectionHeaderHtml()}</div>`;
    html += chatListTabsHtml();
    html += `<label class="msg-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" id="msgSearchInput" class="messages-search" placeholder="Search conversations…" oninput="filterMsgList()" autocomplete="off" aria-label="Search conversations" /></label>`;
    html += `<div id="convListWrap" class="messages-conversation-list" aria-label="Conversations"></div>`;
    setTimeout(filterMsgList, 0);
    return html;
  }

  // Admin viewing as a third party (e.g. from a dispute) - read-only, both
  // participants labeled by name rather than left/right "me" bubbles,
  // since neither side is "you" here.
  if (profile?.role === "admin") {
    const { data: pInfo, error: pErr } = await sb.rpc("admin_get_conversation_participants", { p_conversation_id: conversationId });
    if (pErr || !pInfo || !pInfo[0]) return '<div class="empty-state">Conversation not found.</div>';
    const p = pInfo[0];
    const { data: messages } = await sb.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    let html = `<button class="btn btn-sm" style="margin-bottom:0.8rem;" onclick="navigate('adminConversations')"><i class="fa-solid fa-arrow-left"></i> Back to conversations</button>`;
    html += `<h3><i class="fa-solid fa-comments"></i> ${esc(p.buyer_name || "Customer")} &harr; ${esc(p.vendor_name || "Vendor")}</h3>
      <p class="muted" style="font-size:0.85rem;">Viewing as admin, read only.</p>`;
    html += `<div class="chat-thread"><div class="chat-messages">${(messages || []).map((m) => {
      const isCustomer = m.sender_id === p.buyer_id;
      const senderName = isCustomer ? (p.buyer_name || "Customer") : (p.vendor_name || "Vendor");
      const time = new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<div class="chat-bubble ${isCustomer ? "theirs" : "mine"}"><strong style="display:block;font-size:0.72rem;opacity:0.8;">${esc(senderName)}</strong>${esc(maskSensitiveNumbers(m.body))}<span class="chat-time">${time}</span></div>`;
    }).join("")}</div></div>`;
    return html;
  }

  // Cached copy first (instant, works offline); otherwise one parallel round trip.
  const snap = chatSnapRead(conversationId);
  const fromCache = !!(snap && snap.conv);
  let bundle;
  if (fromCache) {
    bundle = { other: snap.other, otherErr: null, conv: snap.conv, messages: snap.messages || [], pins: snap.pins || [], blocked: snap.blocked || [], open: true };
  } else {
    bundle = await fetchChatBundle(conversationId);
    if (!bundle.conv || bundle.otherErr) return '<div class="empty-state">Conversation not found.</div>';
    if (!bundle.open) return chatEndedHtml();
    await enrichMessageReplies(bundle.messages);
  }
  const { other, conv, messages } = bundle;
  const chatPins = bundle.pins;
  window.__chatPinsByConversation = window.__chatPinsByConversation || {};
  window.__chatPinsByConversation[conversationId] = (chatPins || []).filter(p => !p.expires_at || new Date(p.expires_at).getTime() > Date.now());
  window.__chatSnapMeta = window.__chatSnapMeta || {};
  window.__chatSnapMeta[conversationId] = { other, conv, pins: chatPins, blocked: bundle.blocked };
  if (!fromCache) chatSnapWrite(conversationId, { ...window.__chatSnapMeta[conversationId], messages });

  const isVendorSide = conv.vendor?.user_id === session.user.id;
  const op = (other && other[0]) || {};
  // A customer talks to the shop (its name and logo), a vendor to the customer.
  const otherName = isVendorSide ? (op.name || "Customer") : (conv.vendor?.business_name || op.name || "Vendor");
  const otherAvatar = isVendorSide ? (op.avatar_url || null) : (conv.vendor?.logo_url || op.avatar_url || null);
  const otherPhone = op.phone || "";
  const otherUserId = op.id || "";
  const isBlockedByMe = otherUserId ? (bundle.blocked || []).includes(otherUserId) : false;
  lastSeenMessagesByConv.set(conversationId, messages || []);

  // Mark the thread read immediately in the local inbox state as well as in
  // the database. This prevents the inbox from showing a stale unread badge
  // when the user has just opened the conversation.
  const cachedConv = (window.__conversations || []).find(c => c.conversation_id === conversationId);
  if (cachedConv) cachedConv.unread_count = 0;
  // Legacy duplicate threads with the same person were merged into this one
  // row for display (dedupeConversationRows); mark every raw conversation_id
  // opened, not just the one the user actually tapped, or a duplicate's
  // unread count keeps re-summing into a badge that never clears.
  const idsToMarkOpened = [...new Set([conversationId, ...(cachedConv?.mergedConversationIds || [])])];
  Promise.all(idsToMarkOpened.map(id => sb.rpc("mark_conversation_opened", { p_conversation_id: id }))).then(() => {
    if (currentView === "messages" && !currentViewParams?.conversationId) filterMsgList();
    return refreshNotifications();
  }).catch(() => {});

  const chatArchived = isChatArchived(conversationId);
  const chatMenuItems = [];
  if (conv.vendor?.id) {
    chatMenuItems.push(`<button type="button" onclick="openChatVendorStorefront(event,'${conv.vendor.id}')"><i class="fa-solid fa-store"></i><span>View storefront</span></button>`);
  }
  chatMenuItems.push(`<button onclick="closeChatMenu();togglePinConversation('${conversationId}')"><i class="fa-solid fa-thumbtack"></i><span>${isConversationPinned(cachedConv) ? "Unpin chat" : "Pin chat"}</span></button>`);
  chatMenuItems.push(`<button onclick="closeChatMenu();openChatListPicker('${conversationId}')"><i class="fa-solid fa-layer-group"></i><span>Add to a list</span></button>`);
  chatMenuItems.push(`<button onclick="closeChatMenu();toggleChatArchived('${conversationId}')"><i class="fa-solid ${chatArchived ? "fa-box-open" : "fa-box-archive"}"></i><span>${chatArchived ? "Restore chat" : "Archive chat"}</span></button>`);
  chatMenuItems.push(`<button onclick="closeChatMenu();deleteChatConversation('${conversationId}')"><i class="fa-solid fa-trash-can"></i><span>Delete chat</span></button>`);
  if (otherUserId) {
    chatMenuItems.push(`<button onclick="toggleBlockChatUser('${otherUserId}','${esc(otherName).replace(/'/g, "\\'")}','${conversationId}')"><i class="fa-solid ${isBlockedByMe ? "fa-user-check" : "fa-user-slash"}"></i><span>${isBlockedByMe ? "Unblock" : "Block"} ${esc(otherName)}</span></button>`);
  }
  let html = `<div class="chat-page-wrap">
    <div id="chatMessageSelectionBar" class="chat-message-selection-bar hidden">
      <button type="button" aria-label="Close selection" onclick="exitChatSelectionMode()"><i class="fa-solid fa-arrow-left"></i></button>
      <span class="selection-count">0</span>
      <div class="selection-actions">
        <button type="button" title="Copy" onclick="copySelectedChatMessages()"><i class="fa-regular fa-copy"></i></button>
        <button type="button" data-selection-action="edit" title="Edit" onclick="editSelectedChatMessage()"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-selection-action="delete" title="Delete" onclick="deleteSelectedChatMessages()"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
    <div class="chat-page-header">
      <button class="chat-header-back" onclick="navigate('messages')" title="Back"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="chat-header-person">${otherAvatar
        ? `<span class="chat-header-avatar-wrap"><img src="${esc(otherAvatar)}" class="chat-header-avatar" alt="${esc(otherName)}" draggable="false" /></span>`
        : `<span class="chat-header-avatar-wrap">${avatarFallbackHtml(otherName, "2.35rem", "chat-header-avatar", otherName)}</span>`}
        <div class="chat-header-name-wrap">${conv.vendor?.id ? `<button type="button" class="chat-header-name-link" onclick="openChatVendorStorefront(event,'${conv.vendor.id}')" title="View storefront"><strong class="chat-header-name">${esc(otherName)}</strong></button>` : `<strong class="chat-header-name">${esc(otherName)}</strong>`}<span class="chat-header-presence" id="chatHeaderPresence" aria-live="polite">${esc(window.__levroPresenceText?.(conversationId) || "")}</span></div>
      </div>
      <div class="chat-header-actions">
        ${window.__levroCallBtnHtml?.(conversationId) || ""}
        <button class="chat-header-icon-btn" id="chatMenuBtn" onclick="toggleChatMenu(event)" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div class="chat-menu-dropdown hidden" id="chatMenuDropdown">${chatMenuItems.join("")}</div>
      </div>
    </div>
    <div id="chatPinnedStrip" class="chat-pinned-strip" aria-label="Pinned messages">${renderPinnedMessagesHtml(conversationId, messages, window.__chatPinsByConversation[conversationId])}</div>
    <div class="chat-thread">
      <div class="chat-messages" id="chatMessages">${chatMessagesWithDatesHtml(messages, chatBubbleHtml)}<div id="chatTypingIndicator" class="chat-typing-indicator hidden" aria-live="polite"><span class="chat-typing-dots"><i></i><i></i><i></i></span><span>Typing…</span></div></div>
      <div id="chatReplyPreview" class="chat-reply-preview hidden"></div>
      <div id="msgVoiceStatus" class="voice-recording-status hidden" aria-live="polite">
        <div class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <span id="msgVoiceStatusText">Listening...</span>
        <button type="button" onclick="stopMsgVoiceRecording()" title="Stop recording" aria-label="Stop recording"><i class="fa-solid fa-stop"></i></button>
        <button type="button" onclick="cancelMsgVoiceRecording()" title="Cancel recording" aria-label="Cancel recording"><i class="fa-solid fa-xmark"></i></button>
      </div>
      ${isBlockedByMe ? `<div class="chat-blocked-banner"><i class="fa-solid fa-user-slash"></i><span>You blocked ${esc(otherName)}.</span><button type="button" onclick="toggleBlockChatUser('${otherUserId}','${esc(otherName).replace(/'/g, "\\'")}','${conversationId}')">Unblock</button></div>` : `
      <div class="chat-input-row">
        ${AiSpeechRecognition ? `<button class="ai-chat-mic-btn" id="msgMicBtn" onclick="toggleMsgMic()" title="Tap to talk"><i class="fa-solid fa-microphone"></i></button>` : ""}
        <textarea id="chatInput" rows="1" placeholder="Type a message…" maxlength="2000" oninput="handleChatTyping('${conversationId}');autoGrowChatInput(this)" onkeydown="if(event.key==='Enter' && !event.shiftKey && !isCoarsePointer()){event.preventDefault();sendChatMessage('${conversationId}');}"></textarea>
        <button class="btn btn-sm" onclick="sendChatMessage('${conversationId}')"><i class="fa-solid fa-paper-plane"></i></button>
      </div>`}
    </div>
  </div>`;

  setTimeout(() => { scrollChatToBottom(); resolveVisibleAttachments(byId("chatMessages")); resolveVisibleAttachments(byId("chatPinnedStrip")); setupMessageInteractions(byId("chatMessages")); renderChatReplyPreview(); }, 0);
  subscribeToConversation(conversationId);
  // Start the live-sync fallback and the online/last-seen line right away,
  // instead of waiting on the realtime channel to finish (re)connecting.
  setTimeout(() => {
    try { window.__levroStartChatMessageFallback?.(String(conversationId)); } catch (_) {}
    try { window.__levroStartChatPresence?.(conversationId); } catch (_) {}
    try { window.__levroInitChatCall?.(String(conversationId)); } catch (_) {}
  }, 300);
  if (fromCache) setTimeout(() => levroRevalidateChat(conversationId), 60);
  return html;
}


function openChatVendorStorefront(event, vendorId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  closeChatMenu();
  if (!vendorId) return;
  navigate("storefront", { vendorId });
}

function toggleChatMenu(evt) {
  evt?.stopPropagation();
  byId("chatMenuDropdown")?.classList.toggle("hidden");
}
function closeChatMenu() { byId("chatMenuDropdown")?.classList.add("hidden"); }
document.addEventListener("click", (e) => {
  const menu = byId("chatMenuDropdown");
  if (menu && !menu.classList.contains("hidden") && !e.target.closest("#chatMenuDropdown, #chatMenuBtn")) menu.classList.add("hidden");
});

// Sent (single check) -> delivered, i.e. synced to the other person's
// device (double check, gray) -> read, i.e. they actually opened this
// conversation (double check, blue) - only shown on your own messages,
// same as WhatsApp.
function messageTicksHtml(m) {
  if (m.read_at) return `<i class="fa-solid fa-check-double chat-tick read"></i>`;
  if (m.delivered_at) return `<i class="fa-solid fa-check-double chat-tick"></i>`;
  return `<i class="fa-solid fa-check chat-tick"></i>`;
}
const REACTION_EMOJIS = ["👍","❤️","😂","😮","😢","🙏","🔥","👏","😍","😘","🥰","😁","😆","🤣","😊","🙂","😉","🤩","😎","🤔","😅","😭","😡","😱","🤯","🥳","🎉","💯","💔","🙌","🤝","👀"];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function sanitizeFilename(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}
// The bucket is private (participant/owner-scoped RLS), so a stored
// attachment_url is really just the storage path -- the actual viewable
// URL has to be freshly signed each time it's displayed.
const attachmentUrlCache = new Map();
async function resolveAttachmentUrl(path) {
  if (!path) return null;
  const cached = attachmentUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.url;
  const { data, error } = await sb.storage.from("chat-attachments").createSignedUrl(path, 3600);
  if (error || !data) return null;
  attachmentUrlCache.set(path, { url:data.signedUrl, expiresAt:Date.now()+55*60*1000 });
  return data.signedUrl;
}
async function resolveVisibleAttachments(root) {
  const els = [...(root || document).querySelectorAll("[data-attachment-path]:not([data-resolved])")];
  if (!els.length) return;
  els.forEach(el => el.setAttribute("data-resolved", "1"));
  const uniquePaths=[...new Set(els.map(el=>el.dataset.attachmentPath).filter(Boolean))];
  let signedMap=new Map();
  try {
    const {data,error}=await sb.storage.from("chat-attachments").createSignedUrls(uniquePaths,3600);
    if(!error && data) uniquePaths.forEach((path,i)=>{ const u=data[i]?.signedUrl; if(u) signedMap.set(path,u); });
  } catch(_) {}
  await Promise.all(els.map(async (el)=>{
    const path=el.dataset.attachmentPath;
    const url=signedMap.get(path)||await resolveAttachmentUrl(path);
    if(!url)return;
    el.dataset.resolvedUrl=url;
    if(el.tagName==='A') el.href=url;
    const img=el.tagName==='IMG'?el:el.querySelector('img');
    if(img){ img.src=url; img.loading='eager'; img.decoding='async'; try{img.fetchPriority='high';}catch(_){} }
  }));
}
function openChatImageLightboxFromMessage(event, el) {
  event?.stopPropagation?.();
  const path = el?.dataset?.attachmentPath || "";
  const cached = attachmentUrlCache.get(path)?.url || el?.dataset?.resolvedUrl || el?.querySelector("img")?.src;
  if (!cached) { resolveAttachmentUrl(path).then((url) => { if (url) openChatImageLightbox(url, el.querySelector("img")?.alt || "Chat image"); }); return; }
  openChatImageLightbox(cached, el.querySelector("img")?.alt || "Chat image");
}
function openChatImageLightbox(url, name) {
  const box = byId("productImageLightbox");
  const img = byId("productLightboxImage");
  if (!box || !img || !url) return;
  img.src = url; img.alt = name || "Chat image";
  box.classList.remove("hidden");
}
function attachmentHtml(m) {
  if (!m.attachment_url) return "";
  const isImage = (m.attachment_type || "").startsWith("image/");
  if (isImage) {
    return `<button type="button" class="msg-attachment chat-image-attachment" data-attachment-path="${esc(m.attachment_url)}" onclick="scheduleChatImageTap(this)" aria-label="Open image"><img class="msg-attachment-img" alt="${esc(m.attachment_name || "")}" /></button>`;
  }
  return `<a class="msg-attachment-file" href="#" target="_blank" rel="noopener" data-attachment-path="${esc(m.attachment_url)}"><i class="fa-solid fa-file"></i> ${esc(m.attachment_name || "Attachment")}</a>`;
}
function reactionsRowHtml(m) {
  const reactions = m.reactions || {};
  const counts = {};
  Object.values(reactions).forEach((emoji) => { counts[emoji] = (counts[emoji] || 0) + 1; });
  return Object.entries(counts).map(([emoji, n]) => `<span class="msg-reaction-pill">${emoji}${n > 1 ? ` ${n}` : ""}</span>`).join("");
}
