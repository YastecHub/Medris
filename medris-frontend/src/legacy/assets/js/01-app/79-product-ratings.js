// ---------- PRODUCT RATINGS ----------
// Reviews were only ever collectible from the order page, tied to the
// whole order -- there was no way to rate a product from the product page
// itself, even though that's the one place every buyer actually lands to
// leave feedback on what they bought. This reuses the same reviews table
// (a buyer's completed, paid order for this product, one review per
// order) but surfaces it right on the product they're looking at.
function productReviewListHtml(reviews) {
  if (!reviews.length) return `<p class="muted">No reviews yet for this product.</p>`;
  return `<div class="product-review-list">${reviews.map((r) => `<div class="card review-card">${r.buyer_avatar_url ? `<img src="${esc(r.buyer_avatar_url)}" class="avatar-circle" style="width:2.3rem;height:2.3rem;object-fit:cover;" />` : avatarFallbackHtml(r.buyer_name || "Customer", "2.3rem", "", r.buyer_name || "Customer")}<div><div class="flex" style="justify-content:space-between;gap:1rem;"><strong>${esc(r.buyer_name || "A buyer")}</strong><span class="star-display">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></div>${r.comment ? `<p style="margin:0.3rem 0 0;">${esc(r.comment)}</p>` : ""}<p class="muted" style="font-size:0.75rem;margin-top:0.2rem;">${new Date(r.created_at).toLocaleDateString()}</p></div></div>`).join("")}</div>`;
}
function toggleProductReviewList(btn) {
  const panel = btn?.nextElementSibling;
  if (!panel) return;
  const open = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  btn.setAttribute("aria-expanded", String(open));
  const label = btn.querySelector("span");
  if (label) label.textContent = label.textContent.replace(/^(View|Hide) all ratings/, open ? "Hide all ratings" : "View all ratings");
  const chev = btn.querySelector("i");
  if (chev) chev.className = `fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}`;
}
async function hydrateProductReviewSection(productId) {
  const body = byId(`productReviewsBody-${productId}`);
  if (!body) return;
  const [{ data: reviews, error: reviewsError }, eligible] = await Promise.all([
    sb.rpc("get_product_reviews", { p_product_id: productId }),
    session?.user?.id ? sb.rpc("get_reviewable_order_for_product", { p_product_id: productId }).then((r) => r.data?.[0] || null).catch(() => null) : Promise.resolve(null),
  ]);
  if (byId(`productReviewsBody-${productId}`) !== body) return; // navigated away before this resolved
  const rows = reviewsError ? [] : (reviews || []);
  const avg = rows.length ? rows.reduce((sum, r) => sum + r.rating, 0) / rows.length : 0;
  const summaryHtml = rows.length
    ? `<div class="product-review-summary"><span class="product-review-summary-score">${avg.toFixed(1)}</span><span class="star-display">${"★".repeat(Math.round(avg))}${"☆".repeat(5 - Math.round(avg))}</span><span class="muted">${rows.length} review${rows.length === 1 ? "" : "s"}</span></div>`
    : "";
  const formHtml = eligible
    ? `<div class="product-review-form" id="productReviewForm-${productId}">
        <strong>Rate this product</strong>
        <div id="productReviewError-${productId}" class="error-text hidden"></div>
        ${starRatingWidgetHtml(5)}
        <input type="hidden" id="reviewRating" value="5" />
        <textarea id="productReviewComment-${productId}" rows="3" placeholder="Share your experience with this product (optional)"></textarea>
        <button type="button" class="btn btn-sm" onclick="submitProductReview('${eligible.order_id}','${eligible.vendor_id}','${productId}')"><i class="fa-solid fa-paper-plane"></i> Submit rating</button>
      </div>`
    : "";
  const listHtml = rows.length
    ? `<button type="button" class="product-reviews-toggle" aria-expanded="false" onclick="toggleProductReviewList(this)"><span>View all ratings (${rows.length})</span><i class="fa-solid fa-chevron-down"></i></button><div class="product-review-collapsible hidden">${productReviewListHtml(rows)}</div>`
    : productReviewListHtml(rows);
  body.innerHTML = `${summaryHtml}${formHtml}${listHtml}`;
}
async function submitProductReview(orderId, vendorId, productId) {
  if (!session) { showLogin(); return; }
  const errorEl = byId(`productReviewError-${productId}`);
  const { error } = await sb.from("reviews").insert({
    order_id: orderId, buyer_id: session.user.id, vendor_id: vendorId,
    rating: Number(byId("reviewRating")?.value || 5),
    comment: byId(`productReviewComment-${productId}`)?.value.trim() || null,
  });
  if (error) { if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); } return; }
  showToast("Thanks for rating this product!", "success");
  window.__productRatingCache?.delete(String(productId));
  await hydrateProductReviewSection(productId);
  hydrateProductRatingsInView();
}

async function submitVendorDisputeResponse(disputeId, orderId) {
  const errorEl = byId("vendorDisputeError");
  errorEl.classList.add("hidden");
  const response = byId("vendorDisputeResponse").value.trim();
  if (!response) { errorEl.textContent = "Response can't be empty."; errorEl.classList.remove("hidden"); return; }
  const { error } = await sb.rpc("vendor_respond_to_dispute", { p_dispute_id: disputeId, p_response: response });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  navigate("orderDetail", { orderId });
}


