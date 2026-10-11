// ---------- WHATSAPP-STYLE CHAT DATE SEPARATORS (buyer-vendor chat + Levi) ----------
function chatDateLabel(date) {
  const d = new Date(date);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: sameYear ? undefined : "numeric" });
}
function chatDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function chatMessagesWithDatesHtml(messages, bubbleFn) {
  let html = "";
  let lastKey = null;
  (messages || []).forEach((m) => {
    const key = chatDateKey(m.created_at);
    if (key !== lastKey) { html += `<div class="conv-date-sep">${chatDateLabel(m.created_at)}</div>`; lastKey = key; }
    html += bubbleFn(m);
  });
  return html;
}

function replyQuoteHtml(m) {
  const r = m?.reply_to;
  if (!r) return "";
  const who = r.sender_id === session?.user?.id ? "You" : "Reply";
  const text = r.deleted_at ? "This message was deleted" : (maskSensitiveNumbers(r.body || "") || r.attachment_name || "Attachment");
  return `<button type="button" class="chat-reply-quote" data-reply-target-id="${esc(r.id || m.reply_to_id || "")}" onclick="jumpToRepliedMessage(event,this)"><span class="reply-quote-label">${esc(who)}</span><span class="reply-quote-text">${esc(text)}</span></button>`;
}
function jumpToRepliedMessage(event, quote) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const id = quote?.dataset?.replyTargetId;
  if (!id) return;
  const target = document.querySelector(`.chat-bubble[data-msg-id="${CSS.escape(id)}"]`);
  if (!target) { showToast("That message is no longer visible in this chat.", "info"); return; }
  const scroller = byId("chatMessages");
  const top = target.getBoundingClientRect().top - (scroller?.getBoundingClientRect().top || 0) + (scroller?.scrollTop || 0) - 24;
  scroller?.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  target.classList.remove("chat-message-jump-highlight");
  quote.classList.remove("chat-reply-jump");
  requestAnimationFrame(() => {
    target.classList.add("chat-message-jump-highlight");
    quote.classList.add("chat-reply-jump");
    setTimeout(() => { target.classList.remove("chat-message-jump-highlight"); quote.classList.remove("chat-reply-jump"); }, 1400);
  });
}
function linkifyChatText(text) {
  const safe = esc(text || "");
  return safe.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, (match) => {
    const href = /^www\./i.test(match) ? `https://${match}` : match;
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="chat-inline-link">${match}</a>`;
  }).replace(/\n/g, "<br>");
}
