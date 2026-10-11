// ---------- CALL LOG ROWS IN THE CHAT (missed / outgoing / incoming + duration) ----------
const __callLogCache = { id: null, at: 0, rows: [] };
function callLogLabel(c) {
  const mine = String(c.caller_id) === String(session?.user?.id);
  const ageMs = Date.now() - new Date(c.created_at).getTime();
  let status = c.status;
  if (status === "ringing" && ageMs > 90000) status = "missed";
  if (status === "ringing") return null;
  if (c.answered_at && (status === "ended" || status === "missed")) {
    const sec = Math.max(0, Math.round((new Date(c.ended_at || c.answered_at).getTime() - new Date(c.answered_at).getTime()) / 1000));
    const dur = sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : sec >= 60 ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s` : `${sec}s`;
    return { icon: "fa-phone", title: "Voice call", text: dur, bad: false, mine };
  }
  if (status === "declined") return { icon: "fa-phone-slash", title: "Voice call", text: mine ? "Declined" : "You declined", bad: !mine, mine };
  return mine ? { icon: "fa-phone", title: "Voice call", text: "No answer", bad: false, mine } : { icon: "fa-phone-slash", title: "Missed voice call", text: "Tap to call back", bad: true, mine };
}
function callLogRowHtml(c, label) {
  const t = new Date(c.created_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  return `<div class="chat-call-log ${label.mine ? "mine" : "theirs"}${label.bad ? " is-missed" : ""}" data-call-id="${esc(c.id)}" data-created-at="${esc(c.created_at)}"><button type="button" class="ccl-card" onclick="window.startVoiceCall(activeConversationId)" aria-label="${esc(label.title)}, ${esc(label.text)}. Tap to call"><span class="ccl-ico"><i class="fa-solid ${label.icon}" aria-hidden="true"></i></span><span class="ccl-copy"><strong>${esc(label.title)}</strong><span>${esc(label.text)}</span></span><small>${esc(t)}</small></button></div>`;
}
async function chatSyncCallLogs(force) {
  const box = byId("chatMessages");
  const convId = activeConversationId;
  if (!box || !convId || !session?.user?.id) return;
  if (force || __callLogCache.id !== convId || Date.now() - __callLogCache.at > 20000) {
    try {
      const { data, error } = await sb.from("voice_calls").select("id,caller_id,callee_id,status,created_at,answered_at,ended_at").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      __callLogCache.id = convId; __callLogCache.at = Date.now(); __callLogCache.rows = data || [];
    } catch (_) { return; }
  }
  if (activeConversationId !== convId) return;
  const present = new Set([...box.querySelectorAll(".chat-call-log")].map((e) => e.dataset.callId));
  for (const c of __callLogCache.rows) {
    const label = callLogLabel(c);
    const existing = box.querySelector(`.chat-call-log[data-call-id="${CSS.escape(String(c.id))}"]`);
    if (!label) continue;
    if (existing) { if (existing.textContent.replace(/\s+/g, " ").indexOf(label.text) === -1) existing.outerHTML = callLogRowHtml(c, label); continue; }
    if (present.has(String(c.id))) continue;
    const tm = new Date(c.created_at).getTime();
    const rows = [...box.children].filter((el) => el.matches?.(".chat-bubble-wrap,.chat-call-log"));
    let before = null;
    for (const el of rows) {
      const at = el.dataset?.createdAt || el.querySelector?.(".chat-bubble")?.dataset.createdAt;
      if (at && new Date(at).getTime() > tm) { before = el; break; }
    }
    const tmp = document.createElement("div"); tmp.innerHTML = callLogRowHtml(c, label);
    const node = tmp.firstElementChild;
    if (before) box.insertBefore(node, before);
    else box.insertBefore(node, byId("chatTypingIndicator") || null);
  }
}
(function watchChatForCallLogs() {
  let timer = null;
  const schedule = (force) => { clearTimeout(timer); timer = setTimeout(() => chatSyncCallLogs(force === true), 150); };
  window.chatSyncCallLogsSoon = (force) => schedule(force);
  const attach = () => {
    const box = byId("chatMessages");
    if (!box || box.dataset.callObs === "1") return;
    box.dataset.callObs = "1";
    new MutationObserver((muts) => { if (muts.some((m) => [...m.addedNodes].some((n) => !n.classList?.contains("chat-call-log")))) schedule(); }).observe(box, { childList: true });
    schedule(true);
  };
  const app = document.getElementById("app") || document.body;
  new MutationObserver(attach).observe(app, { childList: true, subtree: true });
  attach();
})();
function chatBubbleHtml(m) {
  const mine = m.sender_id === session.user.id;
  const time = new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (m.deleted_at) {
    return `<div class="chat-bubble-wrap ${mine ? "mine" : "theirs"}">
      <div class="chat-bubble ${mine ? "mine" : "theirs"} deleted" data-msg-id="${m.id}" data-created-at="${esc(m.created_at)}"><span class="chat-bubble-text muted" style="font-style:italic;"><i class="fa-solid fa-ban"></i> This message was deleted</span><span class="chat-time"><span class="chat-time-text">${time}</span></span></div>
      <div class="msg-reactions-row" data-reactions-for="${m.id}">${reactionsRowHtml(m)}</div>
    </div>`;
  }
  const editedTag = m.edited_at ? `<span class="muted" style="font-size:0.7rem;">(edited)</span>` : "";
  return `<div class="chat-bubble-wrap ${mine ? "mine" : "theirs"}" data-msg-wrap-id="${m.id}">
    <div class="chat-bubble ${mine ? "mine" : "theirs"}${m.attachment_url && String(m.attachment_type || "").startsWith("image/") && !m.body ? " photo-only" : ""}" data-msg-id="${m.id}" data-created-at="${esc(m.created_at)}">${replyQuoteHtml(m)}${attachmentHtml(m)}${m.body ? `<span class="chat-bubble-text">${linkifyChatText(maskSensitiveNumbers(m.body))}</span>` : ""}<span class="chat-time">${editedTag}<span class="chat-time-text">${time}${mine ? messageTicksHtml(m) : ""}</span></span></div>
    <div class="msg-reactions-row" data-reactions-for="${m.id}">${reactionsRowHtml(m)}</div>
  </div>`;
}
function speakMessageBubble(btn) {
  const text = btn.closest(".chat-bubble")?.querySelector(".chat-bubble-text")?.textContent || "";
  speakAiChatMessage(text, btn);
}
function positionReactionPicker(picker, anchor) {
  if (!picker || !anchor) return;
  picker.classList.remove("reaction-picker-below");
  const r = anchor.getBoundingClientRect();
  const ph = picker.offsetHeight || 48;
  const margin = 10;
  if (r.top < ph + margin) picker.classList.add("reaction-picker-below");
}
function openReactionPicker(evt, msgId) {
  evt?.stopPropagation?.();
  const existing = document.querySelector(`.reaction-picker[data-for="${msgId}"]`);
  document.querySelectorAll(".reaction-picker").forEach((p) => p.remove());
  if (existing) return;
  const wrap = evt?.target?.closest?.(".chat-bubble-wrap") || document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`)?.closest(".chat-bubble-wrap");
  if (!wrap) return;
  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  picker.dataset.for = msgId;
  picker.innerHTML = REACTION_EMOJIS.map((e) => `<button type="button" aria-label="React ${e}" onclick="reactToMessage(event,'${msgId}','${e}')">${e}</button>`).join("") +
    `<button type="button" class="reaction-more-btn" onclick="openReactionKeyboard(event,'${msgId}')">More…</button>`;
  wrap.appendChild(picker);
  chatSuppressClickUntil = window.chatSuppressClickUntil = Date.now() + 650;
  requestAnimationFrame(() => positionReactionPicker(picker, wrap));
}
function toggleReactionPicker(evt, msgId) { openReactionPicker(evt, msgId); }
function openReactionKeyboard(evt, msgId) {
  evt?.stopPropagation?.();
  const picker = document.querySelector(`.reaction-picker[data-for="${msgId}"]`);
  if (!picker) return;
  if (picker.querySelector(".reaction-keyboard-row")) {
    picker.querySelector("input")?.focus();
    return;
  }
  const row = document.createElement("div");
  row.className = "reaction-keyboard-row";
  row.innerHTML = `<input type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Choose an emoji" aria-label="Choose an emoji" /><button type="button">Use</button>`;
  picker.appendChild(row);
  const input = row.querySelector("input");
  const submit = () => {
    const value = String(input?.value || "").trim();
    if (!value) return;
    let emoji = value;
    try { if (window.Intl?.Segmenter) emoji = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value))[0]?.segment || value; } catch (_) { emoji = Array.from(value)[0] || value; }
    reactToMessage({ stopPropagation(){} }, msgId, emoji);
  };
  row.querySelector("button").onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  setTimeout(() => input.focus(), 40);
}
async function reactToMessage(evt, msgId, emoji) {
  evt.stopPropagation();
  document.querySelectorAll(".reaction-picker").forEach((p) => p.remove());
  const { data, error } = await sb.rpc("toggle_message_reaction", { p_message_id: msgId, p_emoji: emoji });
  if (error) { showToast(error.message, "error"); return; }
  const row = document.querySelector(`.msg-reactions-row[data-reactions-for="${msgId}"]`);
  if (row) row.innerHTML = reactionsRowHtml({ reactions: data });
}

