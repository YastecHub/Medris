// ---------- WHATSAPP-STYLE MESSAGE ACTIONS / SELECTION / REPLIES ----------
const MESSAGE_EDIT_WINDOW_MS = 30 * 60 * 1000;
let editOriginalBubbleHtml = new Map();
let chatSelectedIds = new Set();
let chatSelectionMode = false;
let chatReplyTarget = null;
let chatLongPressTimer = null;
let chatSwipeState = null;
let chatSuppressClickUntil = 0;
window.chatSuppressClickUntil = 0;

function getChatMessageById(msgId) {
  const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
  if (!bubble) return null;
  return {
    id: msgId,
    body: bubble.querySelector(".chat-bubble-text")?.textContent || "",
    created_at: bubble.dataset.createdAt || "",
    sender_id: bubble.classList.contains("mine") ? session?.user?.id : null,
    deleted_at: bubble.classList.contains("deleted") ? new Date().toISOString() : null,
    attachment_name: bubble.querySelector(".msg-attachment-file")?.textContent?.trim() || (bubble.querySelector(".msg-attachment-img") ? "Photo" : "")
  };
}
function clearMessageActionOverlays() {
  document.querySelectorAll(".msg-action-menu, .reaction-picker").forEach((p) => p.remove());
}
function updateChatSelectionUi() {
  document.querySelectorAll(".chat-bubble[data-msg-id]").forEach((b) => b.classList.toggle("chat-selected", chatSelectedIds.has(b.dataset.msgId)));
  const bar = byId("chatMessageSelectionBar");
  if (!bar) return;
  bar.classList.toggle("hidden", !chatSelectionMode);
  const header = document.querySelector(".chat-page-header");
  if (header) header.classList.toggle("hidden", chatSelectionMode);
  if (!chatSelectionMode) return;
  const count = bar.querySelector(".selection-count");
  if (count) count.textContent = `${chatSelectedIds.size}`;
  const canEdit = chatSelectedIds.size === 1 && (() => {
    const b = document.querySelector(`.chat-bubble.mine[data-msg-id="${[...chatSelectedIds][0]}"]`);
    return !!b && b.dataset.createdAt && Date.now() - new Date(b.dataset.createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
  })();
  const editBtn = bar.querySelector("[data-selection-action=edit]");
  if (editBtn) editBtn.classList.toggle("hidden", !canEdit);
  const canDelete = chatSelectedIds.size > 0 && [...chatSelectedIds].every((id) => {
    const b = document.querySelector(`.chat-bubble.mine[data-msg-id="${id}"]`);
    return !!b && b.dataset.createdAt && Date.now() - new Date(b.dataset.createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
  });
  const deleteBtn = bar.querySelector("[data-selection-action=delete]");
  if (deleteBtn) { deleteBtn.classList.toggle("hidden", !canDelete); deleteBtn.disabled = !canDelete; }
}
function exitChatSelectionMode() {
  chatSelectionMode = false;
  chatSelectedIds.clear();
  clearMessageActionOverlays();
  updateChatSelectionUi();
}
function enterChatSelectionMode(msgId) {
  clearMessageActionOverlays();
  chatSelectionMode = true;
  chatSelectedIds.clear();
  chatSelectedIds.add(String(msgId));
  updateChatSelectionUi();
}
function toggleChatMessageSelection(msgId) {
  msgId = String(msgId);
  if (chatSelectedIds.has(msgId)) chatSelectedIds.delete(msgId); else chatSelectedIds.add(msgId);
  if (!chatSelectedIds.size) exitChatSelectionMode(); else updateChatSelectionUi();
}
function copySelectedChatMessages() {
  const ids = [...chatSelectedIds];
  const texts = ids.map((id) => document.querySelector(`.chat-bubble[data-msg-id="${id}"] .chat-bubble-text`)?.textContent || "").filter(Boolean);
  if (!texts.length) { showToast("Nothing to copy.", "info"); return; }
  navigator.clipboard?.writeText(texts.join("\n" )).then(() => { showToast("Copied.", "info"); exitChatSelectionMode(); }).catch(() => showToast("Couldn't copy this message.", "error"));
}
async function deleteSelectedChatMessages() {
  const ids = [...chatSelectedIds];
  if (!ids.length) return;
  if (!(await showConfirmDialog(`Delete ${ids.length} selected message${ids.length === 1 ? "" : "s"}? This can't be undone.`, { title: "Delete messages", okLabel: "Delete", danger: true }))) return;
  for (const id of ids) {
    const { error } = await sb.rpc("delete_message", { p_message_id: id });
    if (error) { showToast(error.message, "error"); return; }
  }
  exitChatSelectionMode();
  const convId = activeConversationId;
  if (convId) await renderMessages(convId).then((html) => { const main = byId("mainContent"); if (main) { main.innerHTML = html; setTimeout(() => { scrollChatToBottom(); resolveVisibleAttachments(byId("chatMessages")); setupMessageInteractions(byId("chatMessages")); }, 0); } });
}
function editSelectedChatMessage() {
  if (chatSelectedIds.size !== 1) return;
  const id = [...chatSelectedIds][0];
  exitChatSelectionMode();
  startEditMessage(id);
}
function setChatReplyTarget(msgId) {
  const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
  if (!bubble) return;
  chatReplyTarget = { id: msgId, body: bubble.querySelector(".chat-bubble-text")?.textContent || "", attachment: bubble.querySelector(".msg-attachment-file")?.textContent?.trim() || (bubble.querySelector(".msg-attachment-img") ? "Photo" : "") };
  clearMessageActionOverlays();
  exitChatSelectionMode();
  renderChatReplyPreview();
  byId("chatInput")?.focus();
}
function clearChatReplyTarget() { chatReplyTarget = null; renderChatReplyPreview(); }
function renderChatReplyPreview() {
  const box = byId("chatReplyPreview");
  if (!box) return;
  if (!chatReplyTarget) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const text = maskSensitiveNumbers(chatReplyTarget.body || "") || chatReplyTarget.attachment || "Attachment";
  box.innerHTML = `<span class="reply-accent"></span><div class="reply-copy"><div class="reply-label">Replying to ${document.querySelector(`.chat-bubble[data-msg-id="${chatReplyTarget.id}"]`)?.classList.contains("mine") ? "yourself" : "message"}</div><div class="reply-text">${esc(text)}</div></div><button class="reply-close" type="button" aria-label="Cancel reply" onclick="clearChatReplyTarget()"><i class="fa-solid fa-xmark"></i></button>`;
  box.classList.remove("hidden");
}
function isChatMessagePinned(messageId) {
  const pins = window.__chatPinsByConversation?.[activeConversationId] || [];
  return pins.some(p => String(p.message_id) === String(messageId) && (!p.expires_at || new Date(p.expires_at).getTime() > Date.now()));
}
function renderPinnedMessagesHtml(conversationId, messages, pins) {
  const byMessage = new Map((messages || []).map(m => [String(m.id), m]));
  const livePins = (pins || []).filter(p => !p.expires_at || new Date(p.expires_at).getTime() > Date.now()).slice(0,4);
  if (!livePins.length) return '';
  return `<div class="chat-pinned-strip-inner"><span class="chat-pinned-label"><i class="fa-solid fa-thumbtack"></i> Pinned</span><div class="chat-pinned-items">${livePins.map(p => { const m=byMessage.get(String(p.message_id)); if(!m)return ''; const image=String(m.attachment_type||'').startsWith('image/') && m.attachment_url; const text=String(m.body||'').trim() || (image ? 'Photo' : 'Attachment'); return `<button type="button" class="chat-pinned-item" onclick="jumpToPinnedMessage('${esc(m.id)}')">${image ? `<img data-attachment-path="${esc(m.attachment_url)}" src="" alt="" />` : `<span class="chat-pinned-item-icon"><i class="fa-solid ${m.body?'fa-message':'fa-paperclip'}"></i></span>`}<span><strong>${esc(text.slice(0,72))}${text.length>72?'…':''}</strong><small>${new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small></span></button>`; }).join('')}</div></div>`;
}
async function refreshChatPinnedStrip() {
  if (!activeConversationId || !session?.user?.id) return;
  const { data } = await sb.from('message_pins').select('id,conversation_id,message_id,pinned_at,expires_at').eq('conversation_id',activeConversationId).eq('user_id',session.user.id).order('pinned_at',{ascending:false}).limit(4);
  window.__chatPinsByConversation = window.__chatPinsByConversation || {};
  window.__chatPinsByConversation[activeConversationId] = (data || []).filter(p => !p.expires_at || new Date(p.expires_at).getTime() > Date.now());
  const messages = lastSeenMessagesByConv.get(activeConversationId) || [];
  const strip = byId('chatPinnedStrip');
  if (strip) strip.innerHTML = renderPinnedMessagesHtml(activeConversationId,messages,window.__chatPinsByConversation[activeConversationId]);
}
async function pinChatMessage(messageId) {
  if (!session?.user?.id || !activeConversationId || !messageId) return;
  if (isChatMessagePinned(messageId)) { clearMessageActionOverlays(); return; }
  const existing = (window.__chatPinsByConversation?.[activeConversationId] || []).filter(p => !p.expires_at || new Date(p.expires_at).getTime() > Date.now());
  if (existing.length >= 4) { showToast('You can pin a maximum of 4 messages in this chat.','info'); clearMessageActionOverlays(); return; }
  const { error } = await sb.from('message_pins').insert({ user_id: session.user.id, conversation_id: activeConversationId, message_id: messageId });
  if (error) { showToast(error.message || 'Could not pin this message.','error'); return; }
  clearMessageActionOverlays(); await refreshChatPinnedStrip(); showToast('Message pinned.','success');
}
async function unpinChatMessage(messageId) {
  if (!session?.user?.id || !activeConversationId || !messageId) return;
  const { error } = await sb.from('message_pins').delete().eq('user_id',session.user.id).eq('conversation_id',activeConversationId).eq('message_id',messageId);
  if (error) { showToast(error.message || 'Could not unpin this message.','error'); return; }
  clearMessageActionOverlays(); await refreshChatPinnedStrip(); showToast('Message unpinned.','success');
}
function jumpToPinnedMessage(messageId) {
  const target = document.querySelector(`.chat-bubble[data-msg-id="${CSS.escape(String(messageId))}"]`);
  const scroller = byId('chatMessages');
  if (!target || !scroller) return;
  const targetRect = target.getBoundingClientRect();
  const scrollRect = scroller.getBoundingClientRect();
  const desired = scroller.scrollTop + (targetRect.top - scrollRect.top) - (scrollRect.height - targetRect.height) / 2;
  scroller.scrollTo({top:Math.max(0,desired),behavior:'smooth'});
  target.classList.remove('chat-message-jump-highlight');
  requestAnimationFrame(()=>requestAnimationFrame(()=>target.classList.add('chat-message-jump-highlight')));
  setTimeout(()=>target.classList.remove('chat-message-jump-highlight'),1500);
}

function showMessageActionMenu(bubble) {
  document.querySelectorAll(".msg-action-menu").forEach((p) => p.remove());
  const msgId = bubble.dataset.msgId;
  const mine = bubble.classList.contains("mine");
  const createdAt = bubble.dataset.createdAt;
  const withinEditWindow = !!createdAt && Date.now() - new Date(createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
  const wrap = bubble.closest(".chat-bubble-wrap");
  if (!wrap) return;
  const menu = document.createElement("div");
  menu.className = `msg-action-menu ${mine ? "msg-action-menu-mine" : "msg-action-menu-theirs"}`;
  const actions = [
    `<button type="button" onclick="setChatReplyTarget('${msgId}')"><i class="fa-solid fa-reply"></i> Reply</button>`,
    `<button type="button" onclick="enterChatSelectionMode('${msgId}')"><i class="fa-regular fa-square-check"></i> Select</button>`,
    `<button type="button" onclick="copySingleChatMessage('${msgId}')"><i class="fa-regular fa-copy"></i> Copy</button>`,
    `${isChatMessagePinned(msgId) ? `<button type="button" onclick="unpinChatMessage('${msgId}')"><i class="fa-solid fa-thumbtack-slash"></i> Unpin</button>` : `<button type="button" onclick="pinChatMessage('${msgId}')"><i class="fa-solid fa-thumbtack"></i> Pin message</button>`}`
  ];
  if (mine && withinEditWindow) {
    actions.push(`<button type="button" onclick="startEditMessage('${msgId}')"><i class="fa-solid fa-pen"></i> Edit</button>`);
    actions.push(`<button type="button" onclick="confirmDeleteMessage('${msgId}')"><i class="fa-solid fa-trash"></i> Delete</button>`);
  }
  menu.innerHTML = actions.join("");
  wrap.appendChild(menu);
  // A single long press produces both WhatsApp-style surfaces: the emoji
  // reaction row and the existing message action menu. Keep the two surfaces
  // visually distinct instead of letting the menu cover the emoji row.
  openReactionPicker({ target: bubble, stopPropagation(){} }, msgId);
  const longPressPicker = wrap.querySelector(`.reaction-picker[data-for="${CSS.escape(String(msgId))}"]`);
  if (longPressPicker) longPressPicker.classList.add("reaction-picker-with-action-menu");

  // Place the action menu where it is actually visible. If the message is
  // near the top of the viewport, the menu opens below it; otherwise it
  // opens above it. This avoids menus being cut off by the phone's top edge.
  requestAnimationFrame(() => {
    if (!menu.isConnected) return;
    const bubbleRect = bubble.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const topInset = Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 8);
    const bottomInset = Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom")) || 8);
    const spaceAbove = bubbleRect.top - topInset;
    const spaceBelow = window.innerHeight - bubbleRect.bottom - bottomInset;
    menu.classList.remove("msg-action-menu-below");
    if (spaceAbove < menuRect.height + 8 && spaceBelow >= menuRect.height + 8) {
      menu.classList.add("msg-action-menu-below");
    }
  });
}
function copySingleChatMessage(msgId) {
  const text = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"] .chat-bubble-text`)?.textContent || "";
  clearMessageActionOverlays();
  navigator.clipboard?.writeText(text).then(() => showToast("Copied.", "info")).catch(() => showToast("Couldn't copy this message.", "error"));
}
function scheduleChatImageTap(button){
  const bubble=button?.closest?.(".chat-bubble[data-msg-id]"); if(!bubble||bubble.classList.contains("deleted")||chatSelectionMode)return;
  if(Date.now()<Number(bubble.dataset.suppressImageTapUntil||0))return;
  clearTimeout(bubble.__singleImageTapTimer);
  bubble.__singleImageTapTimer=setTimeout(()=>{bubble.__singleImageTapTimer=null;if(Date.now()<Number(bubble.dataset.suppressImageTapUntil||0))return;openChatImageLightboxFromMessage({stopPropagation(){},preventDefault(){}},button);},260);
}
function setupMessageDoubleTap(root) {
  const el = root || document;
  el.querySelectorAll?.(".chat-bubble[data-msg-id]").forEach((bubble) => {
    if (bubble.dataset.doubleTapBound) return;
    bubble.dataset.doubleTapBound = "1";
    if (isCoarsePointer()) {
      let lastTap = 0;
      let lastX = 0, lastY = 0;
      bubble.addEventListener("pointerup", (e) => {
        if (chatSelectionMode || bubble.classList.contains("deleted")) return;
        if (e.pointerType === "mouse") return;
        const now = Date.now();
        const moved = Math.hypot((e.clientX || 0) - lastX, (e.clientY || 0) - lastY);
        if (now - lastTap < 380 && moved < 24) {
          e.preventDefault(); e.stopPropagation();
          clearTimeout(bubble.__singleImageTapTimer); bubble.__singleImageTapTimer=null;
          bubble.dataset.suppressImageTapUntil=String(Date.now()+900);
          chatSuppressClickUntil=window.chatSuppressClickUntil=Date.now()+650;
          openReactionPicker(e,bubble.dataset.msgId);
          lastTap=0; return;
        }
        lastTap=now; lastX=e.clientX||0; lastY=e.clientY||0;
      }, { passive: false });
    } else {
      bubble.addEventListener("dblclick", (e) => {
        if (chatSelectionMode) return;
        clearTimeout(bubble.__singleImageTapTimer); bubble.__singleImageTapTimer=null;
        bubble.dataset.suppressImageTapUntil=String(Date.now()+900);
        chatSuppressClickUntil=window.chatSuppressClickUntil=Date.now()+650;
        openReactionPicker(e,bubble.dataset.msgId);
      });
    }
  });
}
function setupMessageLongPress(root) {
  const el = root || document;
  el.querySelectorAll?.(".chat-bubble[data-msg-id]").forEach((bubble) => {
    if (bubble.dataset.longPressBound) return;
    bubble.dataset.longPressBound = "1";
    bubble.addEventListener("selectstart", (e) => e.preventDefault());
    bubble.addEventListener("dragstart", (e) => e.preventDefault());
    bubble.addEventListener("mousedown", (e) => e.preventDefault());

    let timer = null;
    let moved = false;
    let activePointerId = null;
    let sx = 0, sy = 0;
    const LONG_PRESS_MS = 460;
    const MOVE_TOLERANCE = 14;

    // Cancelling the long-press timer and releasing pointer capture used to
    // always happen together. But releasing capture the moment real
    // movement is detected (MOVE_TOLERANCE below) meant that once the
    // finger's physical position drifted outside this bubble's own narrow
    // rectangle -- which a real swipe-to-reply drag does almost
    // immediately -- the browser stopped delivering pointermove events to
    // it at all, since hit-testing without capture requires the touch to
    // still be physically over the element. That silently cut off the
    // swipe-to-reply recognizer's own pointermove listener on the same
    // bubble mid-gesture, which is exactly what made a normal swipe feel
    // like it needed a held press first to "grab" before it would respond.
    // Capture must stay held for the entire gesture; only the timer needs
    // cancelling once we know it's a drag, not a hold.
    const clearTimerOnly = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      bubble.classList.remove("chat-long-pressing");
    };
    const clear = () => {
      clearTimerOnly();
      if (activePointerId != null && bubble.hasPointerCapture?.(activePointerId)) {
        try { bubble.releasePointerCapture(activePointerId); } catch (_) {}
      }
      activePointerId = null;
    };

    const start = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (chatSelectionMode && e.pointerType === "mouse" && e.button !== 0) return;
      clear();
      activePointerId = e.pointerId ?? null;
      sx = e.clientX || 0;
      sy = e.clientY || 0;
      moved = false;
      if (activePointerId != null) {
        try { bubble.setPointerCapture(activePointerId); } catch (_) {}
      }
      // Do not prevent normal scrolling/taps. Only suppress the native
      // long-press selection/context menu once the hold actually completes.
      timer = setTimeout(() => {
        if (moved) return;
        bubble.classList.remove("chat-long-pressing");
        if (navigator.vibrate) navigator.vibrate(12);
        chatSuppressClickUntil = window.chatSuppressClickUntil = Date.now() + 900;
        bubble.dataset.suppressImageTapUntil=String(Date.now()+900); clearTimeout(bubble.__singleImageTapTimer); bubble.__singleImageTapTimer=null;
        if (chatSelectionMode) toggleChatMessageSelection(bubble.dataset.msgId);
        else showMessageActionMenu(bubble);
        timer = null;
      }, LONG_PRESS_MS);
      // Tiny visual feedback only after a real touch hold begins; it does
      // not alter layout or the bubble dimensions.
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        bubble.classList.add("chat-long-pressing");
      }
    };
    const move = (e) => {
      if (!timer) return;
      const dx = (e.clientX || 0) - sx;
      const dy = (e.clientY || 0) - sy;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
        moved = true;
        clearTimerOnly();
      }
    };
    const finish = () => clear();

    bubble.addEventListener("pointerdown", start, { passive: true });
    bubble.addEventListener("pointermove", move, { passive: true });
    bubble.addEventListener("pointerup", finish, { passive: true });
    bubble.addEventListener("pointercancel", finish, { passive: true });
    bubble.addEventListener("pointerleave", (e) => {
      // With pointer capture this normally won't fire until the gesture ends;
      // keep it as a safe fallback for browsers that don't support capture.
      if (e.pointerType !== "touch" && !bubble.hasPointerCapture?.(e.pointerId)) finish();
    }, { passive: true });
    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      clear();
      chatSuppressClickUntil = Date.now() + 700;
      const imageOnly = !!bubble.querySelector('.chat-image-attachment') && !bubble.querySelector('.chat-bubble-text');
      if (imageOnly) openReactionPicker({ target: bubble, stopPropagation(){} }, bubble.dataset.msgId);
      else if (chatSelectionMode) toggleChatMessageSelection(bubble.dataset.msgId);
      else showMessageActionMenu(bubble);
    });
  });
}
function setupMessageSwipeReply(root) {
  const el = root || document;
  el.querySelectorAll?.(".chat-bubble-wrap[data-msg-wrap-id]").forEach((wrap) => {
    if (wrap.dataset.swipeReplyBound) return;
    wrap.dataset.swipeReplyBound = "1";

    const bubble = wrap.querySelector(".chat-bubble[data-msg-id]");
    if (!bubble || bubble.classList.contains("deleted")) return;

    let sx = 0, sy = 0, dx = 0, dy = 0;
    let tracking = false, horizontal = false;

    const reset = () => {
      tracking = false;
      horizontal = false;
      dx = dy = 0;
      wrap.classList.remove("chat-swipe-active");
      bubble.style.transform = "";
    };

    bubble.addEventListener("pointerdown", (e) => {
      if (chatSelectionMode) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      sx = e.clientX || 0;
      sy = e.clientY || 0;
      dx = dy = 0;
      tracking = true;
      horizontal = false;
    }, { passive: true });

    bubble.addEventListener("pointermove", (e) => {
      if (!tracking) return;
      dx = (e.clientX || 0) - sx;
      dy = (e.clientY || 0) - sy;

      // Let ordinary vertical chat scrolling win. We only take control after
      // a clear horizontal intent is established.
      if (!horizontal) {
        if (Math.abs(dy) > Math.abs(dx) * 1.35 && Math.abs(dy) > 9) {
          reset();
          return;
        }
        if (Math.abs(dx) < 6) return;
        horizontal = Math.abs(dx) > Math.abs(dy) * 0.78;
        if (!horizontal) return;
        wrap.classList.add("chat-swipe-active");
      }

      if (horizontal) {
        e.preventDefault();
        const direction = dx >= 0 ? 1 : -1;
        const shift = Math.max(-84, Math.min(84, dx * 0.72));
        bubble.style.transform = `translateX(${shift}px)`;
      }
    }, { passive: false });

    const finish = () => {
      if (!tracking) return;
      const shouldReply = horizontal && Math.abs(dx) >= 24;
      const msgId = bubble.dataset.msgId;
      reset();
      if (shouldReply && msgId) {
        wrap.classList.add("chat-swipe-reply");
        setChatReplyTarget(msgId);
        setTimeout(() => wrap.classList.remove("chat-swipe-reply"), 250);
      }
    };

    bubble.addEventListener("pointerup", finish, { passive: true });
    bubble.addEventListener("pointercancel", reset, { passive: true });
  });
}
function setupMessageInteractions(root) {
  setupMessageLongPress(root);
  setupMessageDoubleTap(root);
  setupMessageSwipeReply(root);
  const scope = root || document;
  scope.querySelectorAll?.('.chat-image-attachment img').forEach((img) => {
    if (img.dataset.imageMenuBound === '1') return;
    img.dataset.imageMenuBound = '1';
    img.addEventListener('contextmenu', (e) => e.preventDefault(), { capture:true });
    img.addEventListener('dragstart', (e) => e.preventDefault(), { capture:true });
  });
}
document.addEventListener("click", (e) => {
  if (e.target.closest?.("#vendorReviewModalSubmit")) {
    submitVendorReviewModal();
    return;
  }
  if (Date.now() < chatSuppressClickUntil) return;
  if (chatSelectionMode && e.target.closest?.(".chat-bubble[data-msg-id]") && !e.target.closest?.(".msg-action-menu")) {
    toggleChatMessageSelection(e.target.closest(".chat-bubble[data-msg-id]").dataset.msgId);
    return;
  }
  if (!e.target.closest(".msg-action-menu")) document.querySelectorAll(".msg-action-menu").forEach((m) => m.remove());
});
// Edits happen in place, right inside the message bubble itself -- not a
// separate popup dialog and not the main compose bar -- so it's obvious
// this is changing that exact message, not drafting a new one (which was
// easy to confuse with the old popup and risked sending the same message
// twice: once as the "edit", once again if they also retyped it below).
function startEditMessage(msgId) {
  document.querySelectorAll(".msg-action-menu").forEach((m) => m.remove());
  const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
  if (!bubble) return;
  const currentText = bubble.querySelector(".chat-bubble-text")?.textContent || "";
  editOriginalBubbleHtml.set(msgId, bubble.innerHTML);
  bubble.innerHTML = `<textarea class="chat-edit-textarea" rows="2" maxlength="2000">${esc(currentText)}</textarea>
    <div class="chat-edit-actions">
      <button type="button" class="btn btn-sm btn-outline" onclick="cancelEditMessage('${msgId}')">Cancel</button>
      <button type="button" class="btn btn-sm" onclick="saveEditMessage('${msgId}')">Save</button>
    </div>`;
  const ta = bubble.querySelector(".chat-edit-textarea");
  autoGrowChatInput(ta);
  ta.addEventListener("input", () => autoGrowChatInput(ta));
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function cancelEditMessage(msgId) {
  const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
  const original = editOriginalBubbleHtml.get(msgId);
  if (bubble && original != null) bubble.innerHTML = original;
  editOriginalBubbleHtml.delete(msgId);
}
async function saveEditMessage(msgId) {
  const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
  const newText = bubble?.querySelector(".chat-edit-textarea")?.value.trim();
  if (!newText) { showToast("Message can't be empty.", "error"); return; }
  const { error } = await sb.rpc("edit_message", { p_message_id: msgId, p_new_body: newText });
  if (error) { showToast(error.message, "error"); return; }
  // Restore the original bubble markup (attachment, reactions, ticks all
  // untouched) then patch in just the new text and an "(edited)" tag --
  // same minimal-diff approach either way, just reached after the inline
  // editor closes instead of straight from the menu.
  const original = editOriginalBubbleHtml.get(msgId);
  if (bubble && original != null) bubble.innerHTML = original;
  editOriginalBubbleHtml.delete(msgId);
  if (!bubble) return;
  const textEl = bubble.querySelector(".chat-bubble-text");
  const timeEl = bubble.querySelector(".chat-time");
  if (textEl) textEl.textContent = newText;
  else if (timeEl) timeEl.insertAdjacentHTML("beforebegin", `<span class="chat-bubble-text">${esc(newText)}</span>`);
  if (timeEl && !timeEl.innerHTML.includes("(edited)")) {
    timeEl.insertAdjacentHTML("afterbegin", `<span class="muted" style="font-size:0.7rem;">(edited)</span>`);
  }
}
async function confirmDeleteMessage(msgId) {
  document.querySelectorAll(".msg-action-menu").forEach((m) => m.remove());
  if (!(await showConfirmDialog("Delete this message? This can't be undone.", { title: "Delete message", okLabel: "Delete", danger: true }))) return;
  const { error } = await sb.rpc("delete_message", { p_message_id: msgId });
  if (error) { showToast(error.message, "error"); return; }
  const wrap = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`)?.closest(".chat-bubble-wrap");
  if (wrap) wrap.outerHTML = chatBubbleHtml({ id: msgId, sender_id: session.user.id, created_at: wrap.querySelector(".chat-bubble").dataset.createdAt, deleted_at: new Date().toISOString() });
}

function scrollChatToBottom() {
  const el = byId("chatMessages");
  if (el) el.scrollTop = el.scrollHeight;
}

let typingStopTimer = null;
let typingChannelConversationId = null;
let typingChannelReady = false;
let pendingTypingState = false;
function setChatTypingIndicator(isTyping) {
  const el = byId("chatTypingIndicator");
  if (!el) return;
  el.classList.toggle("hidden", !isTyping);
  const chat = byId("chatMessages");
  if (isTyping && chat) chat.scrollTop = chat.scrollHeight;
}
async function publishChatTyping(isTyping) {
  pendingTypingState = !!isTyping;
  if (!activeMsgChannel || !session || !typingChannelConversationId || !typingChannelReady) return;
  const payload = { user_id: session.user.id, typing: !!isTyping, at: Date.now() };
  try { await activeMsgChannel.track(payload); } catch (_) {}
  // Broadcast the transient typing state as well. Presence is retained as a
  // fallback, but broadcast makes the indicator react immediately and is
  // more reliable across Safari/WebKit and mobile realtime connections.
  try { await activeMsgChannel.send({ type: "broadcast", event: "typing", payload }); } catch (_) {}
}
function handleChatTyping(conversationId) {
  if (conversationId !== activeConversationId) return;
  clearTimeout(typingStopTimer);
  publishChatTyping(true);
  typingStopTimer = setTimeout(() => publishChatTyping(false), 1300);
}
function refreshChatTypingIndicator() {
  if (!activeMsgChannel || !session) return;
  const state = activeMsgChannel.presenceState?.() || {};
  let otherTyping = false;
  Object.values(state).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry?.user_id && entry.user_id !== session.user.id && entry.typing) otherTyping = true;
    });
  });
  setChatTypingIndicator(otherTyping);
}

async function subscribeToConversation(conversationId) {
  // Navigation already returned control to the user. Only the Realtime
  // subscription waits for the previous channel to finish closing.
  // Never let a slow/stalled close of the previous channel hold up this one.
  try { await Promise.race([messageChannelClosePromise, new Promise((r) => setTimeout(r, 1200))]); } catch (_) {}
  if (activeConversationId !== conversationId || !session) return;
  clearTimeout(typingStopTimer);
  typingChannelConversationId = conversationId;
  typingChannelReady = false;
  pendingTypingState = false;
  setChatTypingIndicator(false);
  const channel = sb.channel(`conv-${conversationId}`, { config: { presence: { key: session?.user?.id || undefined } } });
  activeMsgChannel = channel;
  channel
    .on("presence", { event: "sync" }, () => refreshChatTypingIndicator())
    .on("presence", { event: "join" }, () => refreshChatTypingIndicator())
    .on("presence", { event: "leave" }, () => refreshChatTypingIndicator())
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (activeConversationId !== conversationId || !payload) return;
      if (payload.user_id && payload.user_id !== session.user.id) {
        setChatTypingIndicator(!!payload.typing);
        if (payload.typing) {
          clearTimeout(window.__levroTypingHideTimer);
          window.__levroTypingHideTimer = setTimeout(() => setChatTypingIndicator(false), 2200);
        }
      }
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, async (payload) => {
      if (activeConversationId !== conversationId) return;
      const el = byId("chatMessages");
      if (!el) return;
      if (payload.new.sender_id !== session.user.id) {
        if (payload.new.reply_to_id) {
          const { data: parent } = await sb.from("messages").select("id,sender_id,body,attachment_name,deleted_at").eq("id", payload.new.reply_to_id).maybeSingle();
          payload.new.reply_to = parent || null;
        }
        setChatTypingIndicator(false);
        clearTimeout(window.__levroTypingHideTimer);
        el.insertAdjacentHTML("beforeend", chatBubbleHtml(payload.new));
        scrollChatToBottom();
        resolveVisibleAttachments(el);
        setupMessageInteractions(el);
        sb.from("messages").update({ read_at: new Date().toISOString(), delivered_at: new Date().toISOString() }).eq("id", payload.new.id).then(() => refreshNotifications());
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      if (activeConversationId !== conversationId) return;
      if (payload.new.sender_id === session.user.id) {
        const timeText = document.querySelector(`.chat-bubble[data-msg-id="${payload.new.id}"] .chat-time-text`);
        if (timeText) timeText.innerHTML = `${new Date(payload.new.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${messageTicksHtml(payload.new)}`;
      }
      const reactRow = document.querySelector(`.msg-reactions-row[data-reactions-for="${payload.new.id}"]`);
      if (reactRow) reactRow.innerHTML = reactionsRowHtml(payload.new);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        typingChannelReady = true;
        try { await channel.track({ user_id: session.user.id, typing: false, at: Date.now() }); } catch (_) {}
        // Flush any keystroke that happened while the mobile realtime channel
        // was still connecting.
        if (pendingTypingState) await publishChatTyping(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        typingChannelReady = false;
      }
    });
}

// On a touch device there's no easy Shift+Enter, so Enter has to just be a
// normal newline - the Send button is the only way to send. Desktop keeps
// Enter-to-send (Shift+Enter for a newline) since a keyboard makes that
// combo trivial and it's the expected chat-app convention there.
function isCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}
// Auto-grows a chat textarea downward as text wraps, instead of the box
// staying single-line and scrolling the text sideways. Capped so a very
// long message scrolls internally rather than pushing the send button
// off-screen.
function autoGrowChatInput(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}
function resetChatInput(el) {
  el.value = "";
  el.style.height = "";
}

// Contact-info bypass guard: a phone number, +234 number, or "message me on
// WhatsApp" style phrase has no legitimate reason to be needed before an
// order between this exact buyer and vendor has actually completed -- that
// is precisely the pattern of arranging to take a sale off-platform to
// avoid commission. Once a real completed order exists between them, the
// commission on THAT sale is already locked in, and contact info genuinely
// helps real delivery coordination -- so the guard lifts automatically
// rather than staying on forever.
const CONTACT_INFO_PATTERNS = [
  /(\+?234|0)[\d\s().-]{8,14}\d/,                    // 08012345678, 0801 234 5678, +234 801 234 5678, etc.
  /\bwhatsapp\b/i,
  /\b(call|text|reach|dm|message)\s*(me)?\s*(on|at|via)\b/i,
  /\bmy\s+(number|phone|whats\s*app|ig|instagram|handle)\s+is\b/i,
  /\badd\s+me\s+on\b/i,
  /\b(instagram|ig|snapchat|telegram)\s*[:@]/i,
];
// The regex list above only tolerates digits and simple separators (spaces,
// dashes, dots, parens) between the digits of a number -- inserting a word
// or two instead ("0801 my line is 2345678") slips right past it. Scan the
// message digit by digit, allowing short non-digit gaps (a word or two)
// between them without breaking the run, but reset once a gap gets long
// enough that the digits on either side are clearly unrelated numbers
// (prices, dates, order refs) rather than one number someone broke up on
// purpose. Bare digit concatenation with no gap limit was tried first and
// false-positived on ordinary messages with several unrelated numbers in
// it once their digit counts added up to 11+.
function messageHasObfuscatedPhoneNumber(text) {
  const MAX_GAP = 15;
  let digits = "";
  let gap = 0;
  for (const ch of String(text || "")) {
    if (/\d/.test(ch)) { digits += ch; gap = 0; }
    else { gap++; if (gap > MAX_GAP) digits = ""; }
    if (/0\d{10}/.test(digits)) return true;
  }
  return false;
}
function messageLooksLikeContactBypass(text) {
  if (CONTACT_INFO_PATTERNS.some((re) => re.test(text))) return true;
  return messageHasObfuscatedPhoneNumber(text);
}
// Numbers long enough to be a phone or bank account number get hashed out
// (Roblox-style: "0801#######" instead of refusing to send at all) rather
// than blocking the whole message -- masks the digits in place so the rest
// of the sentence around them still sends normally.
function maskSensitiveNumbers(text) {
  const str = String(text || "");
  const maskIndices = new Set();

  // Clean phone-shaped numbers (leading 0 or +234, with spaces/dashes/dots
  // allowed between digits).
  for (const m of str.matchAll(/(\+?234|0)[\d\s().-]{8,14}\d/g)) {
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (/\d/.test(str[i])) maskIndices.add(i);
    }
  }
  // Any other standalone run of 10+ digits -- covers a bank account number
  // that doesn't start with 0 or +234.
  // Five or more digits in a row are hidden, so a number can't be passed on
  // in two halves. Amounts written with a currency marker are left alone.
  for (const m of str.matchAll(/\d{5,}/g)) {
    const before = str.slice(Math.max(0, m.index - 5), m.index);
    const after = str.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/(?:[₦$£€]|\bN|\bNGN)\s*$/i.test(before) || /^\s*(?:naira|ngn)\b/i.test(after)) continue;
    for (let i = m.index; i < m.index + m[0].length; i++) maskIndices.add(i);
  }
  // Any run of 7+ digits split by single spaces, dashes, dots or brackets
  // (e.g. 0062-1234-5678, 123 456 7890). ISO dates are left alone.
  for (const m of str.matchAll(/\d(?:[\s().-]?\d){6,}/g)) {
    if (/^\d{4}-\d{2}-\d{2}/.test(m[0])) continue;
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (/\d/.test(str[i])) maskIndices.add(i);
    }
  }
  // Digits deliberately broken up with a word or two in between -- the same
  // gap-tolerant scan used to detect the pattern, but this time recording
  // exactly which characters formed the run so only those get masked, not
  // the words sitting between them.
  const MAX_GAP = 15;
  let digitPositions = [];
  let gap = 0;
  for (let i = 0; i < str.length; i++) {
    if (/\d/.test(str[i])) { digitPositions.push(i); gap = 0; }
    else { gap++; if (gap > MAX_GAP) digitPositions = []; }
    const digitsSoFar = digitPositions.map((idx) => str[idx]).join("");
    if (/0\d{10}/.test(digitsSoFar)) digitPositions.slice(-11).forEach((idx) => maskIndices.add(idx));
  }

  if (!maskIndices.size) return str;
  return [...str].map((ch, i) => (maskIndices.has(i) ? "#" : ch)).join("");
}
// Runs the masking above, then re-checks what's left for anything masking
// can't fix (a bare "message me on whatsapp" with no actual number in it) --
// that still has to be blocked since there's nothing to hash out. Returns
// the text to actually send, or null to block, exactly as the three chat
// send paths already expect from messageLooksLikeContactBypass.
function maskOrBlockContactInfo(text) {
  const masked = maskSensitiveNumbers(text);
  if (CONTACT_INFO_PATTERNS.some((re) => re.test(masked))) return null;
  return masked;
}
// A single message rarely spells out a whole phone number once someone
// notices the check above catches that -- splitting it across several
// short, otherwise-meaningless digit-only messages ("080", "6322", "7669")
// gets round it, since none of those three alone looks like a phone
// number. Track a short rolling window of recent bare-digit-and-separator
// messages per conversation and catch the same pattern once enough of them
// stack up to read as a number. A price or quantity breaks the streak
// immediately, since real prices are written with a ₦, "naira", or
// comma-thousands (none of which are bare digits/separators), and any
// message that isn't purely digits/spaces/dashes/dots resets the buffer.
const __chatDigitFragments = new Map(); // conversationId -> [{digits, at}]
const DIGIT_FRAGMENT_WINDOW_MS = 3 * 60 * 1000;
const DIGIT_FRAGMENT_THRESHOLD = 7;
function messageContinuesDigitFragmentPattern(conversationId, text) {
  const trimmed = text.trim();
  const isBareDigits = /\d/.test(trimmed) && /^[\d\s().-]+$/.test(trimmed);
  const now = Date.now();
  const entries = (__chatDigitFragments.get(conversationId) || []).filter((e) => now - e.at < DIGIT_FRAGMENT_WINDOW_MS);
  if (!isBareDigits) {
    __chatDigitFragments.set(conversationId, []);
    return false;
  }
  entries.push({ digits: trimmed.replace(/\D/g, ""), at: now });
  const combinedLength = entries.reduce((sum, e) => sum + e.digits.length, 0);
  if (combinedLength >= DIGIT_FRAGMENT_THRESHOLD) {
    __chatDigitFragments.set(conversationId, []); // reset so the next unrelated message isn't blocked too
    return true;
  }
  __chatDigitFragments.set(conversationId, entries);
  return false;
}
const __convCompletedOrderCache = new Map();
async function conversationHasCompletedOrder(conversationId) {
  if (__convCompletedOrderCache.has(conversationId)) return __convCompletedOrderCache.get(conversationId);
  try {
    const { data: conv } = await sb.from("conversations").select("buyer_id, vendor_id").eq("id", conversationId).maybeSingle();
    if (!conv) return false;
    const { count } = await sb.from("orders").select("id", { count: "exact", head: true })
      .eq("buyer_id", conv.buyer_id).eq("vendor_id", conv.vendor_id).eq("status", "completed").limit(1);
    const has = Number(count || 0) > 0;
    __convCompletedOrderCache.set(conversationId, has);
    return has;
  } catch (_) {
    return false; // A failed check should never be the reason a real bypass slips through, but also never block a legitimate message on a network hiccup -- err toward not blocking.
  }
}

async function sendChatMessage(conversationId) {
  const input = byId("chatInput");
  let body = input.value.trim();
  if (!body) return;
  // Clear the box the moment Send is tapped; the safety check below used to run first, leaving the text sitting there.
  const __rawBody = body;
  resetChatInput(input);
  const __restoreBody = () => { if (!input.value) { input.value = __rawBody; autoGrowChatInput(input); } };
  if (!(await conversationHasCompletedOrder(conversationId))) {
    // Digits deliberately split across several separate messages have no
    // single number in any one message to mask, so that specific evasion
    // pattern still has to be blocked outright.
    if (messageContinuesDigitFragmentPattern(conversationId, body)) {
      showToast("For your safety, phone numbers and outside contact details can't be shared here until an order between you has completed. Keep the conversation and payment in-app.", "error");
      __restoreBody();
      return;
    }
    const masked = maskOrBlockContactInfo(body);
    if (masked === null) {
      showToast("For your safety, phone numbers and outside contact details can't be shared here until an order between you has completed. Keep the conversation and payment in-app.", "error");
      __restoreBody();
      return;
    }
    if (masked !== body) {
      showToast("Phone/account numbers are hidden automatically to keep you safe. Keep payment and contact details in-app.", "info");
      body = masked;
    }
  }
  if (msgListening || msgVoicePaused) { stopMsgVoiceRecording(); }
  clearTimeout(typingStopTimer);
  publishChatTyping(false);
  const replyToId = chatReplyTarget?.id || null;
  const replyTargetSnapshot = chatReplyTarget ? { ...chatReplyTarget } : null;
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const optimistic = { id: tempId, conversation_id: conversationId, sender_id: session.user.id, body, reply_to_id: replyToId, created_at: new Date().toISOString(), delivered_at: null, read_at: null, __optimistic: true };
  if (replyTargetSnapshot) optimistic.reply_to = { id: replyTargetSnapshot.id, body: replyTargetSnapshot.body, attachment_name: replyTargetSnapshot.attachment, sender_id: document.querySelector(`.chat-bubble[data-msg-id="${replyTargetSnapshot.id}"]`)?.classList.contains("mine") ? session.user.id : "" };
  resetChatInput(input);
  chatReplyTarget = null;
  renderChatReplyPreview();
  const chatEl = byId("chatMessages");
  // Paint the outgoing bubble before waiting on the network/database. The
  // database insert still remains authoritative; the temporary bubble is
  // replaced/removed below if the write succeeds/fails.
  chatEl?.insertAdjacentHTML("beforeend", chatBubbleHtml(optimistic));
  scrollChatToBottom();
  setupMessageInteractions(chatEl);
  const { data, error } = await sb.from("messages").insert({ conversation_id: conversationId, sender_id: session.user.id, body, reply_to_id: replyToId }).select("*").single();
  if (error) {
    document.querySelector(`.chat-bubble[data-msg-id="${tempId}"]`)?.remove();
    showToast(/row-level security/i.test(error.message || "") ? "This message couldn't be sent. You or the other person may have blocked this chat." : error.message, "error");
    return;
  }
  if (replyTargetSnapshot) data.reply_to = { id: replyTargetSnapshot.id, body: replyTargetSnapshot.body, attachment_name: replyTargetSnapshot.attachment, sender_id: document.querySelector(`.chat-bubble[data-msg-id="${replyTargetSnapshot.id}"]`)?.classList.contains("mine") ? session.user.id : "" };
  const tempBubble = document.querySelector(`.chat-bubble[data-msg-id="${tempId}"]`);
  if (tempBubble) tempBubble.outerHTML = chatBubbleHtml(data);
  setupMessageInteractions(byId("chatMessages"));
}
let chatAttachmentEditorState = null;

function ensureChatAttachmentEditor() {
  if (byId("chatAttachmentEditorModal")) return byId("chatAttachmentEditorModal");
  const modal = document.createElement("div");
  modal.id = "chatAttachmentEditorModal";
  modal.className = "modal hidden chat-attachment-editor-modal";
  modal.innerHTML = `<div class="modal-content chat-attachment-editor-content">
    <div class="modal-header"><h3><i class="fa-solid fa-image"></i> Edit photo</h3><button type="button" class="icon-btn" onclick="closeChatAttachmentEditor(false)" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="chat-attachment-editor-toolbar">
      <button type="button" class="btn btn-sm btn-outline active" data-editor-tool="draw" onclick="setChatImageEditorTool('draw',this)"><i class="fa-solid fa-pencil"></i> Draw</button>
      <button type="button" class="btn btn-sm btn-outline" data-editor-tool="highlight" onclick="setChatImageEditorTool('highlight',this)"><i class="fa-solid fa-highlighter"></i> Highlight</button>
      <button type="button" class="btn btn-sm btn-outline" data-editor-tool="crop" onclick="setChatImageEditorTool('crop',this)"><i class="fa-solid fa-crop-simple"></i> Crop</button>
      <button type="button" class="btn btn-sm btn-outline" onclick="rotateChatImageEditor()"><i class="fa-solid fa-rotate-right"></i></button>
      <button type="button" class="btn btn-sm btn-outline" onclick="resetChatImageEditor()"><i class="fa-solid fa-rotate-left"></i> Reset</button>
    </div>
    <div class="chat-attachment-canvas-wrap"><canvas id="chatAttachmentEditorCanvas"></canvas></div>
    <label class="chat-attachment-caption-label">Caption (optional)<textarea id="chatAttachmentCaption" rows="2" maxlength="500" placeholder="Add a caption…"></textarea></label>
    <div class="chat-attachment-editor-footer"><span id="chatAttachmentEditorCount" class="muted"></span><div class="flex" style="justify-content:flex-end;gap:.5rem;"><button type="button" class="btn btn-sm btn-outline" onclick="closeChatAttachmentEditor(false)">Cancel</button><button type="button" class="btn btn-sm" onclick="saveChatAttachmentEditor()"><i class="fa-solid fa-check"></i> Use photo</button></div></div>
  </div>`;
  document.body.appendChild(modal);
  return modal;
}
function chatEditorFitCanvas() {
  const st = chatAttachmentEditorState;
  const canvas = byId("chatAttachmentEditorCanvas");
  if (!st || !canvas || !st.sourceCanvas) return;
  const wrap = canvas.parentElement;
  const maxW = Math.max(260, Math.min(760, wrap?.clientWidth || 760));
  const maxH = Math.max(240, Math.min(620, window.innerHeight * .55));
  const scale = Math.min(1, maxW / st.sourceCanvas.width, maxH / st.sourceCanvas.height);
  canvas.width = Math.max(1, Math.round(st.sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(st.sourceCanvas.height * scale));
  canvas.style.width = canvas.width + "px"; canvas.style.height = canvas.height + "px";
  const ctx = canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(st.sourceCanvas,0,0,canvas.width,canvas.height);
}
function openChatAttachmentEditor(file, index, total, done) {
  const modal = ensureChatAttachmentEditor();
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  let settled = false;
  // A batch of several photos chains through this one at a time (see
  // handleChatFileSelected's next()) -- if a single image's onload/onerror
  // never fires for any reason, that never called the next() callback and
  // the whole send silently stalled forever with no visible error. A
  // watchdog guarantees the chain always moves on.
  const watchdog = setTimeout(() => { settle(null, `Could not open ${file.name} in time.`); }, 8000);
  const settle = (result, errorMessage) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    URL.revokeObjectURL(objectUrl);
    if (errorMessage) showToast(errorMessage, "error");
    if (result === null) done?.(null);
  };
  img.onload = () => {
    if (settled) return;
    clearTimeout(watchdog);
    const source = document.createElement("canvas");
    const max = 2400;
    const scale = Math.min(1, max / img.width, max / img.height);
    source.width = Math.max(1, Math.round(img.width * scale)); source.height = Math.max(1, Math.round(img.height * scale));
    source.getContext("2d").drawImage(img,0,0,source.width,source.height);
    chatAttachmentEditorState = { file, index, total, done: (result) => { settled = true; URL.revokeObjectURL(objectUrl); done?.(result); }, sourceCanvas:source, rotation:0, tool:"draw", strokes:[], crop:null };
    byId("chatAttachmentEditorCount").textContent = total > 1 ? `Photo ${index+1} of ${total}` : "";
    byId("chatAttachmentCaption").value = "";
    modal.classList.remove("hidden");
    requestAnimationFrame(chatEditorFitCanvas);
  };
  img.onerror = () => settle(null, `Could not open ${file.name}.`);
  img.src = objectUrl;
}
function setChatImageEditorTool(tool, btn) {
  if (!chatAttachmentEditorState) return;
  chatAttachmentEditorState.tool = tool;
  document.querySelectorAll("#chatAttachmentEditorModal [data-editor-tool]").forEach(b=>b.classList.toggle("active",b===btn));
  const canvas=byId("chatAttachmentEditorCanvas");
  if(canvas) canvas.style.cursor=tool==="crop"?"crosshair":"crosshair";
}
function drawEditorPreview() {
  const st=chatAttachmentEditorState, canvas=byId("chatAttachmentEditorCanvas"); if(!st||!canvas)return;
  chatEditorFitCanvas();
  const ctx=canvas.getContext("2d");
  st.strokes.forEach(s=>{ctx.save();ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();});
  if(st.crop){ctx.save();ctx.setLineDash([8,6]);ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.fillStyle="rgba(0,0,0,.28)";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.clearRect(st.crop.x,st.crop.y,st.crop.w,st.crop.h);ctx.drawImage(st.sourceCanvas,0,0,canvas.width,canvas.height,st.crop.x,st.crop.y,st.crop.w,st.crop.h);ctx.strokeRect(st.crop.x,st.crop.y,st.crop.w,st.crop.h);ctx.restore();}
}
function rotateChatImageEditor(){
  const st=chatAttachmentEditorState;if(!st)return; const src=st.sourceCanvas; const out=document.createElement("canvas");out.width=src.height;out.height=src.width;const c=out.getContext("2d");c.translate(out.width/2,out.height/2);c.rotate(Math.PI/2);c.drawImage(src,-src.width/2,-src.height/2);st.sourceCanvas=out;st.strokes=[];st.crop=null;drawEditorPreview();
}
function resetChatImageEditor(){const st=chatAttachmentEditorState;if(!st)return;st.strokes=[];st.crop=null;drawEditorPreview();}
function saveChatAttachmentEditor(){
  const st=chatAttachmentEditorState, canvas=byId("chatAttachmentEditorCanvas"); if(!st||!canvas)return;
  const out=document.createElement("canvas");
  let sx=0,sy=0,sw=canvas.width,sh=canvas.height;
  if(st.crop){sx=Math.max(0,st.crop.x);sy=Math.max(0,st.crop.y);sw=Math.max(1,Math.min(canvas.width-sx,st.crop.w));sh=Math.max(1,Math.min(canvas.height-sy,st.crop.h));}
  out.width=Math.round(sw*(st.sourceCanvas.width/canvas.width));out.height=Math.round(sh*(st.sourceCanvas.height/canvas.height));
  const ctx=out.getContext("2d");
  ctx.drawImage(canvas,sx,sy,sw,sh,0,0,out.width,out.height);
  const caption=byId("chatAttachmentCaption")?.value?.trim()||"";
  out.toBlob(blob=>{ const result={blob,caption,name:st.file.name,type:"image/jpeg"}; const done=st.done; closeChatAttachmentEditor(true); done?.(result); },"image/jpeg",.9);
}
function closeChatAttachmentEditor(keep){
  const modal=byId("chatAttachmentEditorModal"); if(modal)modal.classList.add("hidden");
  if(!keep){
    // Cancelling (or the X button) never called the pending photo's done()
    // callback, so a Cancel anywhere but the very last photo in a multi-select
    // batch silently broke the next()/next() chain in handleChatFileSelected
    // forever -- no error, no toast, nothing left to click. The chat looked
    // completely frozen even though nothing had actually gone wrong; it was
    // just waiting on a callback that was never coming.
    const done=chatAttachmentEditorState?.done;
    chatAttachmentEditorState=null;
    done?.(null);
  }
}
function bindChatImageEditorPointer(){
  const canvas=byId("chatAttachmentEditorCanvas"); if(!canvas||canvas.dataset.bound==="1")return;canvas.dataset.bound="1";
  let drawing=false, points=[],start=null;
  const pos=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)};};
  canvas.addEventListener("pointerdown",e=>{const st=chatAttachmentEditorState;if(!st)return;e.preventDefault();canvas.setPointerCapture?.(e.pointerId);const p=pos(e);if(st.tool==="crop"){start=p;st.crop={x:p.x,y:p.y,w:0,h:0};}else{drawing=true;points=[p];st.strokes.push({color:st.tool==="highlight"?"rgba(255,230,0,.38)":"#ff3040",width:st.tool==="highlight"?18:4,points});}});
  canvas.addEventListener("pointermove",e=>{const st=chatAttachmentEditorState;if(!st)return;const p=pos(e);if(st.tool==="crop"&&start){const dx=p.x-start.x,dy=p.y-start.y;const size=Math.min(Math.abs(dx),Math.abs(dy));const x=dx<0?start.x-size:start.x;const y=dy<0?start.y-size:start.y;st.crop={x:Math.max(0,x),y:Math.max(0,y),w:Math.min(size,canvas.width-Math.max(0,x)),h:Math.min(size,canvas.height-Math.max(0,y))};drawEditorPreview();}else if(drawing){points.push(p);drawEditorPreview();}});
  const end=()=>{drawing=false;start=null;};canvas.addEventListener("pointerup",end);canvas.addEventListener("pointercancel",end);
}

async function sendPreparedChatImage(conversationId, prepared, replyToId, replyTargetSnapshot) {
  if (prepared.caption && !(await conversationHasCompletedOrder(conversationId))) {
    // Every caller already wraps this call in try/catch and toasts
    // err.message on failure -- throwing here (rather than also toasting
    // directly) avoids a duplicate, uglier second toast.
    if (messageContinuesDigitFragmentPattern(conversationId, prepared.caption)) {
      throw new Error("Phone numbers and outside contact details can't be shared here until an order between you has completed.");
    }
    const masked = maskOrBlockContactInfo(prepared.caption);
    if (masked === null) {
      throw new Error("Phone numbers and outside contact details can't be shared here until an order between you has completed.");
    }
    prepared.caption = masked;
  }
  const path=`conv/${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${sanitizeFilename(prepared.name||"photo.jpg")}`;
  // Chat photos are the highest-volume image upload in the app -- compress
  // before it ever reaches Supabase Storage. compressImage() is a safe
  // no-op for anything that wouldn't actually benefit (already small, not
  // an image, etc); if the utility script failed to load for any reason,
  // fall back to uploading the original rather than failing the send.
  let uploadBlob = prepared.blob;
  try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(prepared.blob, { maxWidth: 1600, maxHeight: 1600 }); } catch (_) {}
  const {error:upErr}=await sb.storage.from("chat-attachments").upload(path,uploadBlob,{contentType:uploadBlob.type||"image/jpeg",upsert:false,cacheControl:"31536000"});
  if(upErr) throw upErr;
  const {data,error}=await sb.from("messages").insert({conversation_id:conversationId,sender_id:session.user.id,body:prepared.caption||"",reply_to_id:replyToId,attachment_url:path,attachment_name:prepared.name||"photo.jpg",attachment_type:uploadBlob.type||"image/jpeg",attachment_size:uploadBlob.size}).select("*").single();
  if(error) throw error;
  if(replyTargetSnapshot)data.reply_to={id:replyTargetSnapshot.id,body:replyTargetSnapshot.body,attachment_name:replyTargetSnapshot.attachment,sender_id:document.querySelector(`.chat-bubble[data-msg-id="${replyTargetSnapshot.id}"]`)?.classList.contains("mine")?session.user.id:""};
  byId("chatMessages")?.insertAdjacentHTML("beforeend",chatBubbleHtml(data));
}

async function handleChatFileSelected(evt, conversationId) {
  const files=[...(evt.target.files||[])]; evt.target.value=""; if(!files.length)return;
  const valid=files.filter(f=>String(f.type||"").startsWith("image/") && f.size<=MAX_ATTACHMENT_BYTES);
  if(!valid.length){showToast("Choose one or more images up to 10MB each.","error");return;}
  if(valid.length<files.length)showToast("Some files were skipped because they are not images or are over 10MB.","info");
  const prepared=[];
  const next=(i)=>{if(i>=valid.length){
      if(!prepared.length)return;
      (async()=>{try{
        const input=byId("chatInput"); clearTimeout(typingStopTimer); publishChatTyping(false);
        const replyToId=chatReplyTarget?.id||null; const snap=chatReplyTarget?{...chatReplyTarget}:null;
        resetChatInput(input);
        for(const item of prepared) await sendPreparedChatImage(conversationId,item,replyToId,snap);
        chatReplyTarget=null; renderChatReplyPreview(); scrollChatToBottom(); resolveVisibleAttachments(byId("chatMessages")); setupMessageInteractions(byId("chatMessages")); showToast(`${prepared.length} photo${prepared.length===1?"":"s"} sent.`,"success");
      }catch(err){showToast(err.message||"Could not send those photos.","error");} })(); return;}
    openChatAttachmentEditor(valid[i],i,valid.length,(result)=>{if(result)prepared.push(result);next(i+1);});
  };
  // ensureChatAttachmentEditor() builds the editor modal (and its canvas)
  // lazily on first use. Binding pointer listeners before that canvas exists
  // -- which is exactly what happened here on a session's very first photo
  // attachment -- silently found nothing and never bound at all, since this
  // is only called once per selection, not once per photo in the batch.
  ensureChatAttachmentEditor();
  bindChatImageEditorPointer(); next(0);
}
// Product variations have been removed. This strip-only helper stays so any
// product saved while the feature existed doesn't show its old hidden
// metadata marker as garbage text in the visible description.
function stripProductVariantMeta(description) {
  return String(description || "").replace(/\s*<!--LEVROMART_VARIANTS:[\s\S]*?-->/, "").trim();
}
let productGalleryIndex = 0;
window.__productGalleryMainIndex = 0;
window.__productGalleryVarietyOverride = false;
function updateProductGalleryMainControl() {
  const btn = byId("productGalleryReturnMain");
  if (!btn) return;
  btn.classList.toggle("hidden", !window.__productGalleryVarietyOverride || productGalleryIndex === Number(window.__productGalleryMainIndex || 0));
}
function restoreProductGalleryMainImage() {
  const mainIndex = Number(window.__productGalleryMainIndex || 0);
  window.__productGalleryVarietyOverride = false;
  setProductGalleryPhoto(mainIndex, true, false, true);
  updateProductGalleryMainControl();
}
function setProductGalleryPhoto(index, smooth = true, syncVariant = true, preserveVarietyOverride = false) {
  const photos = window.__productGalleryPhotos || [];
  const track = byId("productGalleryTrack");
  if (!photos.length || !track) return;
  productGalleryIndex = (index + photos.length) % photos.length;
  if (!preserveVarietyOverride) window.__productGalleryVarietyOverride = false;
  const slide = track.querySelector(`.product-gallery-slide[data-gallery-index="${productGalleryIndex}"]`);
  // scrollIntoView() walks every scrollable ancestor, not just this
  // horizontally-scrolling track -- if the gallery had already scrolled out
  // of the viewport (e.g. picking a variety further down the page), it
  // dragged the whole page back up just to satisfy the gallery's own
  // horizontal centering. Scroll the track directly instead so choosing a
  // variety never moves the page.
  if (slide) {
    const targetLeft = slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? "smooth" : "auto" });
  }
  const count = byId("productGalleryCount");
  if (count) count.textContent = String(productGalleryIndex + 1);
  document.querySelectorAll(".product-gallery-thumb").forEach((el) => el.classList.toggle("active", Number(el.dataset.galleryIndex) === productGalleryIndex));
  if (syncVariant) syncProductVariantToGalleryIndex(productGalleryIndex);
  updateProductGalleryMainControl();
}
function changeProductGalleryPhoto(delta) { setProductGalleryPhoto(productGalleryIndex + delta); }
function syncProductVariantToGalleryIndex(index) {
  const variants = Array.isArray(currentProductDetail?.variants) ? currentProductDetail.variants : [];
  const photos = Array.isArray(currentProductDetail?.photos) ? currentProductDetail.photos : [];
  const photoUrl = photos[index];
  if (!variants.length || !photoUrl) return;
  const matched = variants.find((variant) => variant.photo_url && String(variant.photo_url) === String(photoUrl));
  if (matched) selectProductVariant(matched.id, false, false);
}
function syncProductGalleryIndex(track) {
  if (!track) return;
  const slides = [...track.querySelectorAll('.product-gallery-slide')];
  if (!slides.length) return;
  const center = track.scrollLeft + track.clientWidth / 2;
  let bestIndex = 0, bestDist = Infinity;
  slides.forEach((slide) => {
    const idx = Number(slide.dataset.galleryIndex) || 0;
    const c = slide.offsetLeft + slide.offsetWidth / 2;
    const d = Math.abs(c - center);
    if (d < bestDist) { bestDist = d; bestIndex = idx; }
  });
  // Update only the local selection state here. Do not call scrollIntoView()
  // while a native swipe/scroll is in progress; doing so makes the gallery
  // fight the finger and can create visible lag.
  const changed = productGalleryIndex !== bestIndex;
  productGalleryIndex = bestIndex;
  const count = byId("productGalleryCount");
  if (count) count.textContent = String(bestIndex + 1);
  document.querySelectorAll(".product-gallery-thumb").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.galleryIndex) === bestIndex);
  });
  if (changed) {
    // keep the matching variety thumbnail in view as the big picture is swiped
    const act = document.querySelector(".product-gallery-thumb.active"), box = act && act.parentElement;
    if (box && box.scrollWidth > box.clientWidth) {
      const ar = act.getBoundingClientRect(), br = box.getBoundingClientRect();
      box.scrollTo({ left: Math.max(0, box.scrollLeft + (ar.left - br.left) - (box.clientWidth - ar.width) / 2), behavior: "smooth" });
    }
  }
  if (changed || track.dataset.variantSyncIndex !== String(bestIndex)) {
    track.dataset.variantSyncIndex = String(bestIndex);
    syncProductVariantToGalleryIndex(bestIndex);
  }
}


function openProductImageLightbox() {
  const photos = window.__productGalleryPhotos || [];
  if (!photos.length) return;
  const img = byId("productLightboxImage");
  if (img) img.src = photos[productGalleryIndex || 0];
  byId("productImageLightbox")?.classList.remove("hidden");
}
function closeProductImageLightbox(event) {
  if (event && event.target?.id !== "productImageLightbox" && !event.target?.closest?.(".image-lightbox-close")) return;
  byId("productImageLightbox")?.classList.add("hidden");
}
function openProductGallerySlide(event, index) {
  event?.stopPropagation?.();
  const track = byId('productGalleryTrack');
  if (track?.dataset.suppressClick === '1') { track.dataset.suppressClick = ''; return; }
  setProductGalleryPhoto(index, false);
  openProductImageLightbox();
}

// Safety net for open chats: if the live connection is slow, asleep or dropped, new messages still appear within a
// few seconds. Looks only at the latest messages of the open conversation and adds any that are not on screen yet.
let chatCatchUpBusy = false;
async function chatCatchUp() {
  if (chatCatchUpBusy || document.hidden || !session || !activeConversationId) return;
  const el = byId("chatMessages");
  if (!el) return;
  const convId = activeConversationId;
  chatCatchUpBusy = true;
  try {
    const { data, error } = await sb.from("messages").select("*").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(15);
    if (error || !data || convId !== activeConversationId || !byId("chatMessages")) return;
    const fresh = data.filter((m) => !el.querySelector(`.chat-bubble[data-msg-id="${m.id}"]`)).reverse();
    for (const m of fresh) {
      el.insertAdjacentHTML("beforeend", chatBubbleHtml(m));
      if (m.sender_id !== session.user.id) {
        const stamp = new Date().toISOString();
        sb.from("messages").update({ read_at: stamp, delivered_at: stamp }).eq("id", m.id).then(() => refreshNotifications());
      }
    }
    if (fresh.length) { scrollChatToBottom(); resolveVisibleAttachments(el); setupMessageInteractions(el); setChatTypingIndicator(false); }
  } catch (_) {
  } finally {
    chatCatchUpBusy = false;
  }
}
setInterval(chatCatchUp, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) chatCatchUp(); });
window.addEventListener("online", chatCatchUp);
