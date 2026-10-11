// ---------- IN-APP MESSAGING ----------
// One continuous text thread per (buyer, vendor) pair - replaces direct
// WhatsApp contact so conversations stay evidence-grade for disputes
// (messages can't be edited or deleted, enforced server-side, not just in
// this UI). Customers open a thread from a product/storefront page; vendors
// see all their threads from a "Messages" nav entry.
let activeMsgChannel = null;
let activeConversationId = null;
// Last-seen messages per conversation, kept only in memory for this tab.
// Lets a re-opened DM paint its previous messages immediately (see the
// fast-path in navigate()) instead of a spinner while the fresh fetch is
// still in flight underneath.
const lastSeenMessagesByConv = new Map();

async function callVendorFromOrder(vendorId) {
  if (!session) { showLogin(); return; }
  try {
    const { data: conversationId, error } = await sb.rpc("get_or_create_conversation", { p_vendor_id: vendorId });
    if (error) throw error;
    await window.startVoiceCall(conversationId);
  } catch (e) { showToast(e.message || "Couldn't start the call.", "error"); }
}
async function callCustomerFromOrder(orderId) {
  if (!session) { showLogin(); return; }
  try {
    const { data: order, error } = await sb.from("orders").select("id,buyer_id,vendor_id").eq("id", orderId).maybeSingle();
    if (error || !order) throw error || new Error("Order not found.");
    const { data: existing } = await sb.from("conversations").select("id").eq("buyer_id", order.buyer_id).eq("vendor_id", order.vendor_id).maybeSingle();
    let conversationId = existing?.id;
    if (!conversationId) {
      const { data: created, error: createErr } = await sb.from("conversations").insert({ buyer_id: order.buyer_id, vendor_id: order.vendor_id }).select("id").single();
      if (createErr) throw createErr;
      conversationId = created.id;
    }
    await window.startVoiceCall(conversationId);
  } catch (e) { showToast(e.message || "Couldn't start the call.", "error"); }
}
async function startConversationWithVendor(vendorId, draftText) {
  if (!session) { showLogin(); return; }
  const { data: v } = await sb.from("vendors").select("business_name, business_hours, allow_after_hours_messages").eq("id", vendorId).maybeSingle();
  if (v && !canMessageVendorNow(v)) {
    const status = vendorHoursStatus(v);
    showToast(`${v.business_name || "This vendor"} is outside working hours right now${status.todayText ? ` (${status.todayLabel}: ${status.todayText})` : ""}. Try again during their working hours.`, "info");
    return;
  }
  if (!(await ensureCustomerProfile())) {
    showToast("Your account profile could not be repaired. Please refresh the app and try again.", "error");
    return;
  }
  let { data: conversationId, error } = await sb.rpc("get_or_create_conversation", { p_vendor_id: vendorId });
  if (error && /foreign key|buyer_id|vendor_id/i.test(error.message || "")) {
    // One final repair/retry handles a race where the profile was created just
    // after the first existence check.
    buyerProfileRepairPromise = null;
    if (await ensureCustomerProfile()) {
      ({ data: conversationId, error } = await sb.rpc("get_or_create_conversation", { p_vendor_id: vendorId }));
    }
  }
  if (error) { showToast(/once you have placed an order/i.test(error.message || "") ? error.message : "We couldn't start this conversation. Please try again.", /once you have placed an order/i.test(error.message || "") ? "info" : "error"); return; }
  await navigate("messages", { conversationId });
  if (draftText) {
    const input = byId("chatInput");
    if (input) { input.value = draftText; autoGrowChatInput(input); input.focus(); }
  }
}

