import { go } from "@/views/legacy-navigate";

/**
 * Terms of Service, drawn by React.
 *
 * Converted one-to-one from renderTerms() (src/legacy/assets/js/01-app/85-legal-pages.js:2): same
 * markup, same classes, same text ("Last updated: 4 November 2026"). The text is a static string of
 * our own, so it is written as plain JSX (escaped by React); nothing comes from the database.
 * Until the legacy screen is deleted (a later pull request) any wording change must be made in
 * BOTH places; the parity test (tests/e2e/pilot-terms.spec.ts) fails if they drift apart.
 *
 * The two links keep the old behaviour: they call the app's own navigate() and do not follow "#".
 */
export default function Terms() {
  return (
    <div className="legal-page">
      <h2>Terms of Service</h2>
      <p className="muted">Last updated: 4 November 2026</p>
      <p>Levromart is an online marketplace that connects buyers with independent vendors, mostly students and small businesses around university campuses and cities across Nigeria. Listings include products, services, rentals, packages/bundles, healthcare equipment, food, electronics and more, for both rental and outright purchase. By creating an account or using Levromart, you agree to these terms.</p>

      <h3>1. What Levromart is (and isn't)</h3>
      <p>Levromart is a marketplace and transaction-facilitation platform. We provide the technology, vendor onboarding/verification, payment and order records, messaging, and dispute process. We are not the seller or renter of record for a vendor's listing. Every product, service, or package is supplied by the independent vendor shown on the listing, and that vendor is responsible for the legality, authenticity, condition, safety, availability, accuracy, and fulfilment of what they offer.</p>
      <p>Vendor verification means that Levromart has completed the verification checks required for that account; it is not a guarantee that every future transaction or listing by that vendor will be problem-free.</p>
      <p>Verification badges: a <strong>green tick</strong> beside a vendor&apos;s name means Levromart has verified them as a student of the campus shown; a <strong>blue tick</strong> means Levromart has verified them as a seller who is not a student (for example, a seller based on or near a campus). A paid premium (gold) verification may be introduced later; these terms will be updated before it is.</p>
      <p>Only categories that currently have live listings from verified vendors are shown when you browse by category; the marketplace, its promotions and its search results change as vendors add or remove listings.</p>

      <h3>2. Accounts</h3>
      <p>You must provide accurate information when registering. A phone number and password are required; an email address is optional. You're responsible for keeping your password secure and for all activity under your account. Vendor accounts additionally require identity/business verification before their storefront goes live. Student vendors may be asked for proof such as a student ID card or biodata page; vendors who are not students can say so, and we may ask for other proof of identity. You must be at least 18 years old, or use Levromart with a parent or guardian's permission.</p>

      <h3>3. Orders, rentals &amp; payments</h3>
      <ul>
      <li>Every order on Levromart is paid through Levromart's secure checkout: with your Levromart wallet, or through Paystack (card, bank transfer or USSD). Levromart never sees or stores your card details. Please do not pay a vendor outside the app: a payment made outside Levromart's checkout (cash, or a transfer straight to the vendor) is not held or protected by Levromart, and Levromart cannot refund it or decide a dispute about it. An order is only treated as paid once Paystack confirms the payment, or once it is paid from your Levromart wallet. Paying from your wallet has no Paystack fee; the shop is paid and Levromart's commission is taken exactly as for a card payment.</li>
      <li>Orders are paid in full before delivery. The money you pay is collected by Paystack and kept in Levromart's Paystack balance (Levromart's single account for collecting, paying out and refunding money); it is not sent to the vendor until the order is done. Once the payment is confirmed and the vendor marks the order out for delivery or handed over, you have 48 hours to confirm receipt or raise a dispute; if you do neither, the order completes automatically and the vendor's share is added to the vendor's wallet.</li>
      <li>Vendors add their payout bank account in the app so they can be paid, and customers add a bank account in their own name to withdraw money from their Levromart wallet. Whoever adds an account (vendor or customer) is responsible for making sure the details are correct and that the account is their own. Levromart is not responsible for any payout, withdrawal or refund sent to an account that was entered wrongly or does not belong to the person it was meant for, and such money may not be recoverable.</li>
      <li>Once an order is complete, the vendor's share (the order amount minus Levromart's commission) shows as the shop's earnings; the money itself stays in Levromart's Paystack balance. A vendor moves earnings into their Levromart wallet (or withdraws them to their payout bank account): money paid for 24 hours or more with no open dispute moves straight away, and newer money only after Levromart approves the request. Levromart may decline a withdrawal request and will give the reason. If a buyer is refunded for an order, the amount refunded is taken off the shop's wallet automatically: a refund is paid out of the shop's share of the sale (what is left after Levromart's commission), and Levromart's commission is not refunded. Money from an order with an open dispute is held until the dispute is settled. Amounts under ₦100 (the smallest amount Paystack can send) are always checked by Levromart first. For security, nothing can be withdrawn to a bank for 24 hours after a payout bank account is added or changed, and the first withdrawal after a change is checked and approved by Levromart before it is sent. This protects you if someone gets into your account and changes your bank details. Transfers usually arrive within minutes, but can take longer when a bank or Paystack is slow. Paystack passes card payments to Levromart about one business day after the buyer pays, so a payout for a recent card payment is sent on the next business day, automatically, once that money arrives.</li>
      <li><strong>Levromart wallet:</strong> every account has a Levromart wallet and an @tag. Money comes into it when you add it with Paystack (Paystack's fee is added on top), when someone sends it to your @tag, when you are refunded, and (for shops) when you move your earnings in. You can pay for orders with it, send it to another person's @tag, or withdraw it to a bank account in your own name. The money in all wallets is held by Levromart in its Paystack account; your wallet shows how much of it is yours. It earns no interest. Check the name and @tag before you send money: Levromart cannot reverse a transfer you made by mistake. Limits apply: ₦200,000 per transfer and ₦500,000 sent per day; top-ups of up to ₦200,000 at a time, up to a balance of ₦2,000,000; three withdrawals a day. For security, nothing can be withdrawn for 24 hours after you add or change your bank account, the first withdrawal to a new or changed account is checked by Levromart, and money added or received in the last 24 hours is checked before it can go to a bank. Levromart may put a wallet on hold, decline a withdrawal (giving the reason), or reverse a movement where it suspects fraud, a stolen card, or a breach of these terms. An account with money in its wallet cannot be deleted until the money is withdrawn or used.</li>
      <li>Rentals may require a refundable deposit. If there's a dispute over damage or non-return, Levromart's dispute resolution process decides how it's handled, including a refund from Levromart where warranted.</li>
      <li>Vendors set their own prices. Eligible listings may use commission-based billing or a monthly listing fee; monthly listings require a ₦999 activation payment before they go live and the fee covers one month.</li>
      <li><strong>Commission:</strong> Levromart's commission is taken from each sale's payout, so you never pay it separately. If commission is still owed from an earlier sale that was not paid through Levromart's checkout, it is due within a 7-day payment window. Your dashboard shows the amount owed and the time left, and we send reminders 5, 3, 2 and 1 days before the deadline. If the balance is still unpaid after the deadline, Levromart may pause the vendor's storefront until it is settled.</li>
      </ul>

      <h3>4. Messaging, calls &amp; chat history</h3>
      <ul>
      <li>Customers and vendors can message each other only while they have an accepted order together. A vendor cannot see a customer's name until the order is accepted.</li>
      <li>In-app voice calls are available in the same conversations. Calls run through the Levromart app and your internet connection; your phone number is not shown to the other person. Levromart does not record call audio.</li>
      <li>When an order is completed, the conversation stays open for 24 hours and then closes: it leaves your chat list and can no longer be opened or continued, so the two sides do not keep communicating outside an order. The messages are not deleted. They are kept securely as a record for disputes, fraud prevention and legal requirements, and Levromart administrators can review them when needed. If you later place a new order with the same vendor, the conversation reopens with its earlier messages.</li>
      <li>Keep conversations and calls about the order. Do not use them to harass anyone, to share personal phone numbers, or to move a sale off Levromart to avoid commission or payment protections. Levromart administrators may review a conversation when a report or dispute is raised, and may restrict messaging or calling for accounts that break these rules.</li>
      <li>Calls need microphone permission. You can allow incoming-call notifications in your device and Levromart settings; if they are off you may miss a call.</li>
      </ul>

      <h3>4A. Reviews, comments, follows &amp; the leaderboard</h3>
    <ul>
      <li>Comments, replies and reviews must be honest and respectful. Do not post abuse, hate, spam, other people's private details, or anything unlawful. Levromart may hide or remove content and restrict accounts that break these rules.</li>
      <li>Following a vendor lets them reach you with updates; you control the kinds of notifications you receive in Settings.</li>
      <li>Vendors earn leaderboard points from genuine activity on Levromart. The vendor with the most points for a week is named Vendor of the Week and is promoted on the home page for the whole of the following week, including their name, logo and products, until the next winner is named. Genuine comments left on a vendor's products by other customers also earn points (any comment counts, emojis included); a vendor commenting on their own product earns no points, and only a person's first 3 comments each day earn points, on up to 3 days a week. Points that come from fake, self-dealt or manipulated activity can be removed, and Levromart may disqualify a vendor. Promotions and rewards may change or end at any time.</li>
    </ul>

    <h3>4B. Levi, our AI assistant</h3>
    <p>Levi is an automated assistant that helps you search and understand how Levromart works. It can make mistakes, so check important details (prices, availability, medical or legal questions) with the vendor or a qualified professional. Do not share passwords or card details with Levi.</p>

    <h3>5. Cancellations, scams &amp; disputes</h3>
      <p>See our <a href="#" onClick={go("refundPolicy")}>Refund &amp; Cancellation Policy</a> for cancellation windows. If a customer believes they have been scammed, received a counterfeit or materially misrepresented item, paid for an order that was not fulfilled, or otherwise suffered a transaction problem, they should report it through the order's dispute process as soon as possible and provide payment records, messages, photos, delivery/handover evidence, and any other relevant evidence.</p>
      <p>The vendor is the primary party responsible for the goods, services, package contents, representations, and fulfilment of the transaction. Levromart may pause the vendor, restrict the account, preserve relevant records, investigate the complaint, and direct a refund or other remedy where the platform's policies and the available evidence support it. Levromart may also cooperate with lawful requests from regulators or law-enforcement authorities.</p>
      <p>Nothing in these terms removes any right or remedy that cannot lawfully be excluded or limited under Nigerian law.</p>

      <h3>6. Prohibited use</h3>
      <p>No listing or sale of counterfeit, unsafe, expired, stolen, or unlicensed goods, including medical equipment that requires regulatory approval, food that doesn't meet basic safety standards, or any item Nigerian law restricts the sale of. No harassment of other users. No attempting to circumvent Levromart payments to avoid commission, and no using chat or calls to take a sale off the platform. This undermines the customer protections (verified vendors, dispute resolution, payment records) that come with paying through the platform.</p>

      <h3>7. Account suspension</h3>
      <p>Levromart may pause or suspend a vendor's storefront or a user's account for violations of these terms, fraud, or repeated disputes, with notice where practical.</p>

      <h3>8. Liability</h3>
      <p>To the extent permitted by law, Levromart is not responsible for a vendor's independent acts, omissions, representations, goods, services, package contents, or fulfilment. However, Levromart remains responsible for obligations that the law places on Levromart itself, including obligations arising from services that Levromart directly provides. Any limitation of liability in these terms applies only to the extent it is lawful and was properly brought to the user's attention.</p>
      <p>Nothing here prevents a customer from using the dispute process, seeking a refund where the applicable policy allows it, or exercising rights available under Nigerian consumer-protection or other applicable law. Always inspect goods before accepting them, and consult a licensed healthcare provider for clinical use questions about medical equipment.</p>

      <h3>9. Changes to these terms</h3>
    <p>We update these terms as Levromart grows. The date at the top shows when they last changed. If you keep using Levromart after a change, you accept the updated terms; for important changes we will tell you in the app.</p>

    <h3>10. Contact</h3>
      <p>Questions about these terms can be raised through your account, or with a Levromart admin via a <a href="#" className="legal-inline-link" onClick={go("supportRequest")}>support request</a>.</p>
    </div>
  );
}
