// Runs every 30 minutes via an external scheduler (GitHub Actions — see
// .github/workflows/order-reminders.yml), not Vercel Cron: the Hobby plan
// only allows Vercel's own cron jobs to fire once a day, so a genuinely
// 30-minute cadence has to come from outside Vercel. Same CRON_SECRET
// bearer-token check as daily-cron.js protects this from being hit by
// anyone who isn't the scheduler.
//
// Nudges both sides of an order that's sat in a non-terminal state past a
// grace period: the vendor if they haven't confirmed/handed over yet, the
// buyer if they haven't confirmed receipt or returned a rental yet.
// Disputed orders are skipped — those are already in the admin queue, not
// something buyer/vendor action fixes. Reminders repeat every 30 minutes
// for as long as the order stays unfinished, exactly like the badge on the
// Orders tab that only clears on completed/cancelled.
const { env } = require("./_util");

const GRACE_MINUTES = 120; // don't nag a brand-new order in its first 2 hours
const REPEAT_MINUTES = 30;

module.exports = async function handler(req, res) {
  try {
    const expected = process.env.CRON_SECRET;
    if (expected && req.headers.authorization !== `Bearer ${expected}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const svcAuth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const svcHeaders = { ...svcAuth, "Content-Type": "application/json", Prefer: "return=minimal" };

    const graceCutoff = new Date(Date.now() - GRACE_MINUTES * 60000).toISOString();
    const repeatCutoff = new Date(Date.now() - REPEAT_MINUTES * 60000).toISOString();

    const ordersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?status=in.(confirmed,handed_over,returned)` +  // pending orders are handled by the DB job remind_unattended_orders() (10 min, then every 30 min)
        
        `&created_at=lte.${graceCutoff}` +
        `&or=(last_reminder_sent_at.is.null,last_reminder_sent_at.lte.${repeatCutoff})` +
        `&select=id,order_type,status,delivery_method,buyer_id,vendor:vendors(id,business_name,user_id)`,
      { headers: svcAuth }
    );
    const due = await ordersRes.json();
    if (!Array.isArray(due)) { res.status(200).json({ checked: 0, reminded: 0 }); return; }

    let reminded = 0;
    for (const o of due) {
      const notifs = remindersForOrder(o);
      if (notifs.length === 0) continue;
      await Promise.all(notifs.map((n) =>
        fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: svcHeaders,
          body: JSON.stringify({
            user_id: n.userId, type: "order_reminder", title: n.title, body: n.body,
            target_view: "orderDetail", target_params: { orderId: o.id },
          }),
        })
      ));
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${o.id}`, {
        method: "PATCH", headers: svcHeaders,
        body: JSON.stringify({ last_reminder_sent_at: new Date().toISOString() }),
      });
      reminded++;
    }

    let purgedChats = 0;
    try { purgedChats = await purgeCompletedOrderChats(SUPABASE_URL, svcAuth, svcHeaders); }
    catch (e) { console.error("chat purge failed", e); }

    res.status(200).json({ checked: due.length, reminded, purgedChats });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};

function remindersForOrder(o) {
  const isRental = o.order_type === "rental";
  const isPickup = o.delivery_method === "pickup";
  const vendorUserId = o.vendor?.user_id;
  const handoverVerb = isPickup ? "picked up by" : "delivered to";
  const handoverVerbBuyer = isPickup ? "pick up" : "receive delivery of";
  const out = [];

  if (o.status === "pending") {
    if (vendorUserId) out.push({ userId: vendorUserId, title: "Order awaiting your confirmation", body: `You still have an order that hasn't been confirmed yet. Buyers are waiting — please accept or decline it.` });
    return out;
  }

  if (o.status === "confirmed") {
    if (vendorUserId) out.push({ userId: vendorUserId, title: "Order not yet handed over", body: `An order still hasn't been ${handoverVerb.replace(" to", "")} the buyer. Please arrange ${isPickup ? "pickup" : "delivery"} when you can.` });
    if (o.buyer_id) out.push({ userId: o.buyer_id, title: "Your order hasn't arrived yet", body: `Your order hasn't been ${isPickup ? "picked up" : "delivered"} yet. If it's taking too long, you can message the vendor from the order page.` });
    return out;
  }

  if (o.status === "handed_over") {
    if (isRental) {
      if (o.buyer_id) out.push({ userId: o.buyer_id, title: "Rental still with you", body: `Don't forget to return the rented item and mark it returned when you're done.` });
    } else {
      if (o.buyer_id) out.push({ userId: o.buyer_id, title: "Confirm you received your order", body: `Please confirm you've ${handoverVerbBuyer.startsWith("receive") ? "received" : "picked up"} your order so we can release payment to the vendor.` });
    }
    return out;
  }

  if (o.status === "returned") {
    if (vendorUserId) out.push({ userId: vendorUserId, title: "Rental return awaiting your confirmation", body: `A buyer marked a rental as returned. Please confirm to complete the order.` });
    return out;
  }

  return out;
}

// A customer<->vendor chat is removed 24h after their last order together was
// completed (and only if no other order between them is still open). The
// messages are copied into chat_archive first and kept there for 30 days,
// admin-only, so a late dispute can still be judged.
async function purgeCompletedOrderChats(SUPABASE_URL, svcAuth, svcHeaders) {
  const candRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/chat_purge_candidates`, {
    method: "POST", headers: { ...svcAuth, "Content-Type": "application/json" }, body: "{}",
  });
  const cands = await candRes.json();
  if (!Array.isArray(cands) || !cands.length) return 0;
  // Drop archive rows older than 30 days.
  const archiveCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/chat_archive?archived_at=lt.${archiveCutoff}`, { method: "DELETE", headers: svcHeaders });
  let purged = 0;
  for (const row of cands) {
    const id = row.conversation_id;
    if (!id) continue;
    const [convRes, msgRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}&select=*`, { headers: svcAuth }),
      fetch(`${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${id}&select=*&order=created_at.asc`, { headers: svcAuth }),
    ]);
    const conv = (await convRes.json())?.[0];
    const msgs = await msgRes.json();
    if (!conv || !Array.isArray(msgs)) continue;
    const arch = await fetch(`${SUPABASE_URL}/rest/v1/chat_archive`, {
      method: "POST", headers: svcHeaders,
      body: JSON.stringify({ conversation_id: id, buyer_id: conv.buyer_id, vendor_id: conv.vendor_id, conversation: conv, messages: msgs }),
    });
    if (!arch.ok) continue; // never delete what we could not archive
    const del = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}`, { method: "DELETE", headers: svcHeaders });
    if (del.ok) purged++;
  }
  return purged;
}

module.exports.purgeCompletedOrderChats = purgeCompletedOrderChats;
