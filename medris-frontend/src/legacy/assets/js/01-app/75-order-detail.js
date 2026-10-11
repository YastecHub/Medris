// ---------- ORDER DETAIL ----------
function pickupMessageDraft(order) {
  const itemsText = order.package?.name || (order.items || []).map((it) => `${it.product?.name || "item"}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", ") || "my order";
  return `Hi! I'd like to confirm pickup for ${itemsText}. Could you share your exact location and a good time to come by?`;
}

async function messageCustomerFromOrder(orderId) {
  if (!session) { showLogin(); return; }
  try {
    const { data: order, error } = await sb.from("orders").select("id,buyer_id,vendor_id").eq("id", orderId).maybeSingle();
    if (error || !order) { showToast(error?.message || "Order not found.", "error"); return; }
    const { data: existing, error: findErr } = await sb.from("conversations").select("id").eq("buyer_id", order.buyer_id).eq("vendor_id", order.vendor_id).maybeSingle();
    if (findErr) throw findErr;
    let conversationId = existing?.id;
    if (!conversationId) {
      const { data: created, error: createErr } = await sb.from("conversations").insert({ buyer_id: order.buyer_id, vendor_id: order.vendor_id }).select("id").single();
      if (createErr) throw createErr;
      conversationId = created.id;
    }
    navigate("messages", { conversationId });
  } catch (err) {
    showToast(err.message || "Couldn't open the customer chat.", "error");
  }
}

