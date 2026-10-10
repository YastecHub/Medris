// ---------- VENDOR / BUYER ORDERS ----------
// Ordered by importance: what needs attention first, finished and cancelled last.
const ORDER_TABS = ["all", "pending", "confirmed", "handed_over", "returned", "payment_unresolved", "disputed", "completed", "cancelled"];
const ORDER_TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "sale", label: "Sales" },
  { value: "rental", label: "Rentals" },
  { value: "service", label: "Services" },
];

// A service booking is stored as order_type "sale" (it goes through the
// same checkout as a sale) - the only way to tell it apart is whether the
// product behind it is flagged is_service, so that's what this checks.
function orderCategory(order) {
  if (order.order_type === "rental") return "rental";
  if ((order.items || []).some((i) => i.product?.is_service)) return "service";
  return "sale";
}

function isOrderPaid(o) {
  return (o.payments || []).some((p) => (String(p.payment_type || "").trim().toLowerCase() === "sale_price" || String(p.payment_type || "").trim().toLowerCase() === "rental_fee") && p.status === "paid");
}

