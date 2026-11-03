/**
 * Refund & Cancellation Policy, drawn by React.
 *
 * Converted one-to-one from renderRefundPolicy() (…/js/01-app/85-legal-pages.js:100): same markup,
 * same classes, same text. The text is a static string of our own, written as plain JSX (escaped by
 * React); nothing comes from the database. Until the legacy screen is deleted (a later pull request) any
 * wording change must be made in BOTH places; the parity test (tests/e2e/pilot-refund-policy.spec.ts) fails if they drift apart.
 */
export default function RefundPolicyPage() {
  return (
    <div className="legal-page">
      <h2>Refund &amp; Cancellation Policy</h2>
      <p className="muted">Last updated: 3 November 2026</p>

      <h3>1. Before a vendor confirms your order</h3>
      <p>You can cancel freely from your Orders page. Anything you already paid for the order is refunded as described in section 8 (Paystack's payment fee is not refunded).</p>

      <h3>2. After a vendor confirms your order</h3>
      <p>If you haven't paid yet, you can still cancel freely from your Orders page any time before the vendor marks your order as handed over. If you have paid, you can still cancel yourself any time before the vendor marks the order out for delivery or handed over, and you get back what you paid for the order. Paystack's payment fee is not refunded. Once the order is out for delivery or handed over it can no longer be cancelled, and any problem goes through Levromart's dispute process instead. A vendor cannot cancel an order you have paid for: the vendor asks Levromart, and an admin decides; if it is approved you are refunded in the same way. Refunds are put in your Levromart refunds wallet when you have added a bank account for refunds, and you can withdraw them to that account whenever you like. If you changed the account in the last 24 hours you can still withdraw, but Levromart is told about the change and may check it. If you have not added an account, the refund goes back to the card you paid with. Please enter your account details carefully: Levromart is not responsible for a refund sent to an account number you entered wrongly. For rentals, once equipment has been handed over, the rental fee is non-refundable; only the refundable deposit (if any) is returned, and only after the equipment is returned in its original condition.</p>

      <h3>3. Refundable deposits</h3>
      <p>Rental deposits are meant to cover damage or non-return. If equipment is returned in its original condition, there's nothing further for you to do. If there's a disagreement about the equipment's condition or the deposit isn't returned, either side can raise a dispute for a Levromart admin to review, including a refund from Levromart where warranted.</p>

      <h3>4. Damaged, wrong, or misrepresented equipment</h3>
      <p>If what arrives doesn't match the listing, or is faulty on arrival, raise a dispute from the order page within 48 hours of handover. Admins will review evidence from both sides and can direct a full or partial refund. A refund is paid out of the shop's share of the sale (what is left after Levromart's commission), so it is taken off the shop's wallet automatically; Levromart's commission is not refunded. Whether the order then shows as completed or cancelled does not change a refund that was already made. While a dispute is open, the vendor cannot withdraw the money from that order; it stays held until the dispute is settled.</p>

      <h3>5. Vendor no-shows or non-delivery</h3>
      <p>If a vendor fails to deliver/hand over confirmed equipment, the customer is entitled to a full refund of any amount paid online through Levromart.</p>

      <h3>6. Chat and calls after an order</h3>
      <p>You can message and call the vendor while your order is accepted and in progress, for example to arrange delivery or raise a problem. Once an order is completed the chat stays open for 24 hours and then closes (the messages are kept as a record). If something is wrong with a completed order, raise it as a dispute from the order page within the time limit in section 4 rather than through chat, so that your evidence is recorded.</p>

      <h3>7. Paid, but your order still shows unpaid</h3>
    <p>Sometimes a payment goes through but the order does not update straight away. Levromart checks with Paystack automatically and matches the payment to your order; this normally takes a few minutes. If it is still not updated after an hour, send a support request with your payment receipt. If a payment cannot be matched to an order, it is refunded to you.</p>

    <h3>8. How refunds are paid</h3>
      <p>Every order is paid through Levromart's checkout (Paystack), and the money stays in Levromart's Paystack balance until it goes to the vendor or back to you. A refund covers what you paid for the order; Paystack's payment fee is not refunded. If you have added a bank account for refunds, the refund goes into your Levromart refunds wallet and you withdraw it to that account whenever you like: Levromart sends it from its Paystack balance by bank transfer (the smallest amount that can be sent is ₦100; if you changed the account in the last 24 hours you can still withdraw, but Levromart is told about the change). If you have not added an account, the refund goes back to the card or account you paid with through Paystack, which usually takes 5 - 10 business days. Once the vendor has been paid for an order, that money can no longer be refunded from Levromart's balance, so raise any problem within the time limit in section 4. Money paid outside Levromart's checkout (cash, or a transfer straight to the vendor) is not held by Levromart and cannot be refunded by Levromart.</p>
    </div>
  );
}
