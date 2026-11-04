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
      <p className="muted">Last updated: 4 November 2026</p>

      <h3>1. Before a vendor confirms your order</h3>
      <p>You can cancel freely from your Orders page. Anything you already paid for the order is refunded as described in section 8 (Paystack's payment fee is not refunded).</p>

      <h3>2. After a vendor confirms your order</h3>
      <p>If you haven't paid yet, you can still cancel freely from your Orders page any time before the vendor marks your order as handed over. If you have paid, you can still cancel yourself any time before the vendor marks the order out for delivery or handed over, and you get back what you paid for the order. Paystack's payment fee is not refunded. Once the order is out for delivery or handed over it can no longer be cancelled, and any problem goes through Levromart's dispute process instead. A vendor cannot cancel an order you have paid for: the vendor asks Levromart, and an admin decides; if it is approved you are refunded in the same way. Refunds are put in your Levromart wallet, where you can use them, send them or withdraw them to your bank account (see section 8). Please enter your bank details carefully: Levromart is not responsible for money sent to an account number you entered wrongly. For rentals, once equipment has been handed over, the rental fee is non-refundable; only the refundable deposit (if any) is returned, and only after the equipment is returned in its original condition.</p>

      <h3>3. Refundable deposits</h3>
      <p>Rental deposits are meant to cover damage or non-return. If equipment is returned in its original condition, there's nothing further for you to do. If there's a disagreement about the equipment's condition or the deposit isn't returned, either side can raise a dispute for a Levromart admin to review, including a refund from Levromart where warranted.</p>

      <h3>4. Damaged, wrong, or misrepresented equipment</h3>
      <p>If what arrives doesn't match the listing, or is faulty on arrival, raise a dispute from the order page within 24 hours of handover. Admins will review evidence from both sides and can direct a full or partial refund. A refund is paid out of the shop's 97% share of the sale (what is left after Levromart's 3% commission, which is collected the moment the order is paid and is not refunded), so it is taken off the shop's wallet automatically; Levromart's commission is not refunded. Whether the order then shows as completed or cancelled does not change a refund that was already made. While a dispute is open, the vendor cannot withdraw the money from that order; it stays held until the dispute is settled.</p>

      <h3>5. Vendor no-shows or non-delivery</h3>
      <p>A refund can only be requested within 24 hours of placing the order, because Paystack cannot investigate or reverse money once it has been sent on. After 24 hours a refund can no longer be requested (a dispute can still be raised if what arrived is not what was ordered). Levromart's 3% commission is taken the moment an order is paid and is never refunded. If a vendor fails to deliver/hand over confirmed equipment, the customer is entitled to a refund of the amount paid online through Levromart, less Levromart's 3% commission, which is collected when the order is paid and is not refunded. Refunds always come out of the shop's 97% share.</p>

      <h3>6. Chat and calls after an order</h3>
      <p>You can message and call the vendor while your order is accepted and in progress, for example to arrange delivery or raise a problem. Once an order is completed the chat stays open for 24 hours and then closes (the messages are kept as a record). If something is wrong with a completed order, raise it as a dispute from the order page within the time limit in section 4 rather than through chat, so that your evidence is recorded.</p>

      <h3>7. Paid, but your order still shows unpaid</h3>
    <p>Sometimes a payment goes through but the order does not update straight away. Levromart checks with Paystack automatically and matches the payment to your order; this normally takes a few minutes. If it is still not updated after an hour, send a support request with your payment receipt. If a payment cannot be matched to an order, it is refunded to you.</p>

    <h3>8. How refunds are paid</h3>
      <p>Every order is paid through Levromart's checkout (Paystack), and the money stays in Levromart's Paystack balance until it goes to the vendor or back to you. A refund covers what you paid for the order; Paystack's payment fee is not refunded. The refund goes into your Levromart wallet at once. You can pay for another order with it, send it to someone's @tag, or withdraw it to a bank account in your own name: Levromart sends it from its Paystack balance by bank transfer (the smallest amount is ₦100). For your security, nothing can be withdrawn for 24 hours after you add or change your bank account, and the first withdrawal to a new or changed account is checked by Levromart; this stops anyone who gets into your account from sending your money to their own bank. If your wallet is on hold, the refund goes back to the card or account you paid with through Paystack instead, which usually takes 5 - 10 business days. Once the vendor has been paid for an order, that money can no longer be refunded from Levromart's balance, so raise any problem within the time limit in section 4. Money paid outside Levromart's checkout (cash, or a transfer straight to the vendor) is not held by Levromart and cannot be refunded by Levromart.</p>
    </div>
  );
}
