import { go } from "@/views/legacy-navigate";

/**
 * Privacy Policy, drawn by React.
 *
 * Converted one-to-one from renderPrivacy() (src/legacy/assets/js/01-app/85-legal-pages.js:55): same markup,
 * same classes, same text. The text is a static string of our own, written as plain JSX (escaped by React);
 * nothing comes from the database. Until the legacy screen is deleted (a later pull request) any wording
 * change must be made in BOTH places; the parity test (tests/e2e/pilot-privacy.spec.ts) fails if they drift apart.
 *
 * The link keeps the old behaviour: it calls the app's own navigate() and does not follow "#".
 */
export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <h2>Privacy Policy</h2>
      <p className="muted">Last updated: 25 October 2026</p>
      <p>This explains what personal data Levromart collects, why, and how it's protected.</p>

      <h3>1. What we collect</h3>
      <ul>
      <li><strong>Account data:</strong> name, email, phone, city, the school or campus you choose, and (for vendors) business details and verification documents such as a student ID card, biodata page, CAC document or, for sellers who are not students, another valid ID card.</li>
      <li><strong>Payout details (vendors):</strong> the bank name, account number and account name you add so we can pay you.</li>
      <li><strong>Refund account (customers):</strong> the bank name, the account name and the last four digits of the account you add so we can pay refunds to you. We do not keep the full account number; the payment provider holds it as a transfer recipient. If the account cannot be saved straight away, the number is kept with your own login only until it can be saved, and is then removed.</li>
      <li><strong>Withdrawal records (vendors):</strong> when you withdraw money from your wallet we keep the amount, the time, the orders it covers and the decision, including the reason if Levromart declined a request.</li>
      <li><strong>Order data:</strong> what you bought/rented, delivery address, order status, and payment status (not your card number; that's handled entirely by Paystack).</li>
      <li><strong>Usage data:</strong> product/package views, wishlist saves, searches, and interactions, used to improve search relevance and show relevant listings or package recommendations.</li>
      <li><strong>Comments, likes and follows:</strong> comments and replies you post, what you like or follow, and your notification preferences for the vendors you follow. Comments and likes are visible to other users.</li>
      <li><strong>Leaderboard activity:</strong> for vendors, activity points that decide the weekly leaderboard and Vendor of the Week. The winner's business name, logo and products can be shown on the home page.</li>
      <li><strong>Photos:</strong> profile pictures, vendor product photos, and package/gallery photos you choose to upload.</li>
      <li><strong>Messages and call records:</strong> the messages you send in order conversations, and basic call records (who called whom, when, and whether it was answered, declined or missed). Call audio travels directly between the two devices and is not recorded or stored by Levromart.</li>
      <li><strong>Online status:</strong> while you are using the app we note when you were last active so the person you are chatting with can see that you are online or when you were last seen.</li>
      <li><strong>Notifications:</strong> if you allow them, a push-notification address for your device so we can alert you about orders, messages, incoming calls and commission reminders.</li>
      <li><strong>Location:</strong> if you turn on Location sharing in Settings, your device location is used to show nearby vendors and distances. You can turn it off at any time. Vendors publish their shop location so customers can find them.</li>
      </ul>

      <h3>2. How we use it</h3>
      <p>To run the marketplace: process orders and payments, verify vendors, let a customer and a vendor message and call each other once an order is accepted (a vendor sees the customer's name only after accepting, and phone numbers are not shown to the other party), send order, call and commission-reminder notifications, improve search relevance, and make marketplace/package recommendations that are relevant to your activity. We do not sell your personal data to third parties.</p>

      <h3>3. Who it's shared with</h3>
      <ul>
      <li><strong>Paystack:</strong> to process payments (we send the order amount and your contact details needed for the payment).</li>
      <li><strong>Hosting and email providers:</strong> Vercel and Heroku run the app and its servers, and an email provider sends account and order emails.</li>
      <li><strong>Supabase:</strong> our database and file storage provider, which hosts the data described above.</li>
      <li><strong>Google Gemini:</strong> powers the in-app AI assistant; only the text of your chat messages is sent, never your account or order data.</li>
      <li>The vendor or buyer on an order you're part of, so they can fulfill/receive it.</li>
      <li><strong>Cloudflare:</strong> stores and serves public listing, banner and profile images.</li>
      <li><strong>Browser push services and call-connection servers:</strong> deliver notifications and help two devices connect for a voice call; they handle connection details, not call audio content.</li>
      </ul>
      <p><strong>How long we keep conversations:</strong> an order conversation closes 24 hours after the order is completed and disappears from your chat list. The messages themselves are kept, as a record of what was agreed, for dispute resolution, fraud prevention and legal compliance. Only the two people in the conversation (while it is open) and Levromart administrators can read them. If you order from the same vendor again, the earlier messages reappear in the reopened chat.</p>
      <p>Your conversations with Levi are saved to your account so they're there when you come back, and are visible only to you: searchable, and deletable any time from the chat panel. Levromart's team does not read them unless you turn on "Help improve Levi" in Settings, which is off by default.</p>

      <h3>3A. On your device</h3>
    <p>Levromart saves some choices on your own phone or browser, such as your theme, product-card pattern, saved searches, and a saved copy of the app so it opens fast and works partly offline. You can clear these in your browser or phone settings; some features then reset to their defaults.</p>

    <h3>4. Your choices and rights</h3>
      <p>You can edit your profile information from your account settings. If you want to close your Levromart account, contact Levromart Support; you can also hide the Levi assistant, switch off location sharing and manage notifications in Settings. Closure is subject to necessary legal, transaction, dispute, payment, fraud-prevention, and audit retention requirements. Operational records are not necessarily erased simply because an account is closed.</p>
    <p>Under the Nigeria Data Protection Act 2023 you may ask to see, correct or delete your personal data, object to some uses of it, and complain to the Nigeria Data Protection Commission. Contact us through a support request and we will respond within a reasonable time. Levromart is meant for people aged 18 and over.</p>

      <h3>5. Security</h3>
      <p>Passwords are never stored in plain text (handled by Supabase Auth). Every account, including ones created with Google, has a password on file so account actions that require it (like deleting your account) work consistently. Access to vendor verification documents and payment records is restricted to the account owner and admins.</p>
      <p>Administrator accounts use an additional one-time email code at sign-in. Customer and vendor accounts use the normal account authentication flow without this extra email-code step.</p>

      <h3>6. Contact</h3>
      <p>Privacy questions can be raised through your account, or with a Levromart admin via a <a href="#" className="legal-inline-link" onClick={go("supportRequest")}>support request</a>.</p>
    </div>
  );
}
