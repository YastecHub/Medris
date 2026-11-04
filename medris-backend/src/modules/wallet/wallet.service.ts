import crypto from "node:crypto";
import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PaymentClaimsRepository } from "../../database/repositories/payment-claims.repository.js";
import { PaymentsRepository } from "../../database/repositories/orders.repository.js";
import { PaystackLedgerRepository } from "../../database/repositories/paystack-ledger.repository.js";
import { WalletRepository, type WalletAccount } from "../../database/repositories/wallet.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, grossUpForBuyerFees, koboToNaira, nairaToKobo } from "../../integrations/paystack/index.js";
import { badRequest, conflict, forbidden, notFound, notReadyIfMissing, serviceUnavailable } from "../../shared/errors/app-error.js";
import { PaymentClaimsService } from "../payment-claims/payment-claims.service.js";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

/** Limits that keep the wallet safe (all in kobo). */
export const WALLET = {
  minTransfer: 5_000, // ₦50
  maxTransfer: 20_000_000, // ₦200,000 per transfer
  maxSentPerDay: 50_000_000, // ₦500,000 a day
  minTopup: 10_000, // ₦100
  maxTopup: 20_000_000, // ₦200,000 per top-up
  maxBalanceForTopup: 200_000_000, // a top-up never takes a wallet above ₦2,000,000
  minWithdrawal: 10_000, // ₦100 (Paystack sends nothing smaller)
  withdrawalsPerDay: 3,
  /** After the bank account is added or changed, nothing can be withdrawn for this long (a stolen login cannot empty the wallet). */
  bankChangeWaitHours: 24,
  /** Money that arrived by top-up or transfer this recently needs an admin's check before it can go to a bank. */
  freshMoneyHours: 24,
} as const;
export const WALLET_TRANSFER_PREFIX = "lvm_ww_";
export const WALLET_TOPUP_PREFIX = "lvm_top_";
const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });
const HANDLE = /^[a-z0-9_]{3,24}$/;
const RESERVED = new Set(["admin", "levromart", "levi", "support", "help", "official", "medris", "staff", "team", "wallet", "system"]);

/**
 * The Levromart wallet (migration 0033). One wallet per person; the money stays in Levromart's Paystack balance and this is
 * the record of who owns how much of it. Every change of a balance happens in one database transaction that has locked the
 * wallets involved, and writes a ledger line with the balance after it, so money can never be created, lost or spent twice.
 */
export class WalletService {
  constructor(
    private readonly db: () => DataContext,
    private readonly checkoutEnabled = true,
  ) {}

  /* ------------------------------------------------------------------ reading */

  async summary(me: Identity | null) {
    const user = need(me);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new WalletRepository(tx);
        const w = await repo.ensure(user.userId);
        if (!w) throw notFound("Account not found.");
        const account = await repo.withdrawalAccount(user.userId);
        const fresh = await repo.recentInflowKobo(user.userId, WALLET.freshMoneyHours);
        return {
          handle: w.handle,
          balance_kobo: w.balance_kobo,
          frozen: w.frozen,
          frozen_reason: w.frozen_reason,
          // what can go to the bank without an admin's check right now
          withdrawable_now_kobo: String(Math.max(0, Number(w.balance_kobo) - fresh)),
          account: account
            ? { bank_name: account.bank_name, account_name: account.account_name, last4: account.last4, source: account.source, changed_hours_ago: Math.floor(account.age_hours) }
            : null,
          limits: WALLET,
          entries: await repo.entries(user.userId, 40, null),
          withdrawals: await repo.recentWithdrawals(user.userId, 10),
        };
      }),
    );
  }

  async history(me: Identity | null, before: string | null) {
    const user = need(me);
    return this.ready(() => this.db().asService((tx) => new WalletRepository(tx).entries(user.userId, 50, before)));
  }

  /** People to send money to, by the start of their @tag (at least 2 characters). */
  async find(me: Identity | null, query: string | null) {
    const user = need(me);
    const q = String(query ?? "").trim().toLowerCase().replace(/^@/, "");
    if (q.length < 2 || !/^[a-z0-9_]+$/.test(q)) return [];
    return this.ready(() =>
      this.db().asService(async (tx) =>
        (await new WalletRepository(tx).search(q, user.userId)).filter((p) => !p.frozen).map((p) => ({ handle: p.handle, name: p.name, avatar_url: p.avatar_url })),
      ),
    );
  }

  async changeHandle(me: Identity | null, wanted: string | null) {
    const user = need(me);
    const handle = String(wanted ?? "").trim().toLowerCase().replace(/^@/, "");
    if (!HANDLE.test(handle)) throw badRequest("Your @tag can use 3 to 24 small letters, numbers or _ (no spaces).");
    if (RESERVED.has(handle) || /levromart|admin|support/.test(handle)) throw badRequest("That @tag is not available. Please choose another.");
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new WalletRepository(tx);
        const [w] = await repo.lock([user.userId]);
        if (!w) throw notFound("Wallet not found.");
        if (w.handle === handle) return { handle };
        if (w.handle_changed_at && Date.now() - new Date(w.handle_changed_at).getTime() < 30 * 864e5) throw badRequest("You can change your @tag once every 30 days.");
        if (await repo.handleTaken(handle)) throw conflict("That @tag is already taken. Please choose another.");
        await repo.setHandle(user.userId, handle);
        return { handle };
      }),
    );
  }

  /* ------------------------------------------------------------- sending money */

  async send(me: Identity | null, input: { toHandle: string | null; amountKobo: number | null; note: string | null; key: string | null }) {
    const user = need(me);
    const handle = String(input.toHandle ?? "").trim().toLowerCase().replace(/^@/, "");
    const amount = Number(input.amountKobo);
    const note = input.note ? String(input.note).replace(/\s+/g, " ").trim().slice(0, 140) || null : null;
    const key = input.key ? String(input.key).slice(0, 80) : null;
    if (!HANDLE.test(handle)) throw badRequest("Choose who to send to by their @tag.");
    if (!Number.isInteger(amount) || amount < WALLET.minTransfer) throw badRequest(`The smallest amount you can send is ${naira(WALLET.minTransfer)}.`);
    if (amount > WALLET.maxTransfer) throw badRequest(`You can send at most ${naira(WALLET.maxTransfer)} at a time.`);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new WalletRepository(tx);
        // a repeated tap with the same key gets the first answer back, never a second transfer
        if (key) {
          const done = await repo.transferByKey(user.userId, key);
          if (done) return { transfer_id: done.id, amount_kobo: done.amount_kobo, duplicate: true };
        }
        await repo.ensure(user.userId);
        const to = await repo.person(handle);
        if (!to) throw notFound(`Nobody has the @tag @${handle}. Check it and try again.`);
        if (to.user_id === user.userId) throw badRequest("You cannot send money to yourself.");
        const locked = await repo.lock([user.userId, to.user_id]);
        const mine = locked.find((x) => x.user_id === user.userId)!;
        const theirs = locked.find((x) => x.user_id === to.user_id);
        if (!theirs) throw notFound("That wallet is not available.");
        if (mine.frozen) throw forbidden("Your wallet is on hold. Please contact Levromart support.");
        if (theirs.frozen) throw badRequest("That wallet cannot receive money right now.");
        if (Number(mine.balance_kobo) < amount) throw badRequest(`You do not have enough in your wallet. Your balance is ${naira(mine.balance_kobo)}.`);
        if ((await repo.sentTodayKobo(user.userId)) + amount > WALLET.maxSentPerDay) throw badRequest(`You can send up to ${naira(WALLET.maxSentPerDay)} in 24 hours.`);
        const transferId = await repo.insertTransfer(user.userId, to.user_id, amount, note, key);
        if (!transferId) throw conflict("This transfer was already sent.");
        const after = await repo.move(user.userId, -amount, "transfer_out", { reference: "transfer:" + transferId, note, counterpartyId: to.user_id, transferId });
        if (after == null) throw badRequest("You do not have enough in your wallet.");
        await repo.move(to.user_id, amount, "transfer_in", { reference: "transfer:" + transferId, note, counterpartyId: user.userId, transferId });
        const sender = await new WalletRepository(tx).account(user.userId);
        await new NotificationWriter(tx).create({
          userId: to.user_id,
          type: "wallet_received",
          title: `You received ${naira(amount)}`,
          body: `From @${sender?.handle ?? "someone"}${note ? `: "${note}"` : ""}. It is in your Levromart wallet.`,
          targetView: "levroWallet",
          actorId: user.userId,
        });
        return { transfer_id: transferId, amount_kobo: String(amount), balance_kobo: String(after), to: { handle: to.handle, name: to.name } };
      }),
    );
  }

  /* ---------------------------------------------------------------- top-ups */

  /** Adds money with Paystack. The buyer pays Paystack's fee on top; the wallet gets the amount asked for. */
  async topup(me: Identity | null, amountKobo: number | null, appOrigin: string) {
    const user = need(me);
    if (!this.checkoutEnabled) throw serviceUnavailable("Adding money is not available right now.");
    const net = Number(amountKobo);
    if (!Number.isInteger(net) || net < WALLET.minTopup) throw badRequest(`The smallest amount you can add is ${naira(WALLET.minTopup)}.`);
    if (net > WALLET.maxTopup) throw badRequest(`You can add at most ${naira(WALLET.maxTopup)} at a time.`);
    const { grossKobo, feeKobo } = grossUpForBuyerFees(net);
    const reference = `${WALLET_TOPUP_PREFIX}${crypto.randomBytes(10).toString("hex")}`;
    const email = await this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new WalletRepository(tx);
        const w = await repo.ensure(user.userId);
        if (!w) throw notFound("Account not found.");
        if (w.frozen) throw forbidden("Your wallet is on hold. Please contact Levromart support.");
        if (Number(w.balance_kobo) + net > WALLET.maxBalanceForTopup) throw badRequest(`A wallet can hold up to ${naira(WALLET.maxBalanceForTopup)} from top-ups.`);
        await new PaystackLedgerRepository(tx).insertTopupAttempt({ reference, payerUserId: user.userId, amountKobo: grossKobo, netKobo: net });
        return (await repo.emailOf(user.userId)) ?? user.email ?? null;
      }),
    );
    if (!email) throw badRequest("Add an email address to your account to pay with Paystack.");
    try {
      const started = await getPaystackClient().initializeTransaction({
        email,
        amountKobo: grossKobo,
        reference,
        callbackUrl: `${appOrigin}/?wallet=1&reference=${encodeURIComponent(reference)}`,
        metadata: { purpose: "wallet_topup", user_id: user.userId, fee_kobo: feeKobo, net_kobo: net },
      });
      await this.db().asService((tx) => new PaystackLedgerRepository(tx).storeAuthorization(reference, { authorization_url: started.authorization_url, access_code: started.access_code }));
      return { reference, authorizationUrl: started.authorization_url, accessCode: started.access_code, amountNaira: koboToNaira(grossKobo), feeNaira: koboToNaira(feeKobo), walletAmountNaira: koboToNaira(net) };
    } catch (err) {
      await this.db().asService((tx) => new PaystackLedgerRepository(tx).setTransactionStatus(reference, "abandoned", ["initialized"])).catch(() => undefined);
      if (err instanceof PaystackRejected) throw badRequest(err.message);
      if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) throw serviceUnavailable("Paystack could not be reached. Please try again in a moment.");
      throw err;
    }
  }

  /* ----------------------------------------------------------- paying an order */

  /**
   * Pays an order from the wallet. Recorded exactly like a Levromart card payment (same "lvm_ord_" reference family, a ledger
   * row with channel "wallet"), so everything after it is the same as for a card: the order moves on, Levromart's 3% commission
   * is kept when the order completes, and the shop's 97% goes to its earnings. No Paystack fee is charged.
   */
  async payOrder(me: Identity | null, orderId: string | null) {
    const user = need(me);
    if (!orderId) throw badRequest("Order not found.");
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const claims = new PaymentClaimsRepository(tx);
        const o = await claims.order(orderId);
        if (!o) throw notFound("Order not found.");
        if (o.buyer_id !== user.userId) throw forbidden("You can only pay for your own orders.");
        if (o.status === "payment_unresolved") throw badRequest("A payment on this order is being checked. Please wait.");
        if (!["pending", "confirmed", "handed_over"].includes(o.status)) throw badRequest("This order can no longer be paid.");
        const due = await claims.outstanding(o);
        if (due === "none" || due.expected == null || !(Number(due.expected) > 0)) throw badRequest("There is nothing left to pay on this order.");
        // a refundable deposit exists only for rentals; on a sale, deposit_amount holds the price already paid (migration 0022)
        if (due.type === "deposit" && o.order_type !== "rental") throw badRequest("There is nothing left to pay on this order.");
        if (await claims.paid(orderId, [due.type])) throw badRequest("There is nothing left to pay on this order.");
        const amount = nairaToKobo(Number(due.expected));
        const ledger = new PaystackLedgerRepository(tx);
        // a Paystack attempt still open for this order is set aside (the buyer chose the wallet instead)
        for (const open of await ledger.openAttempts(orderId)) {
          await ledger.setTransactionStatus(open.reference, "abandoned", ["initialized"]);
          await claims.deletePendingByReference(open.reference);
        }
        const repo = new WalletRepository(tx);
        await repo.ensure(user.userId);
        const [w] = await repo.lock([user.userId]);
        if (!w) throw notFound("Wallet not found.");
        if (w.frozen) throw forbidden("Your wallet is on hold. Please contact Levromart support.");
        if (Number(w.balance_kobo) < amount) throw badRequest(`Your wallet has ${naira(w.balance_kobo)}. You need ${naira(amount)} for this order.`);
        const reference = `lvm_ord_${orderId.replace(/-/g, "").slice(0, 8)}_w${crypto.randomBytes(8).toString("hex")}`;
        const after = await repo.move(user.userId, -amount, "order_payment", { reference, orderId, note: o.vendor_name ? `Paid ${o.vendor_name}` : "Order payment" });
        if (after == null) throw badRequest("You do not have enough in your wallet.");
        const purpose = due.type === "delivery_deposit_20" || !(o.delivery_method === "delivery" && o.payment_timing === "pay_after") ? "order_payment" : "order_balance";
        await ledger.insertAttempt({ reference, purpose, orderId, vendorId: o.vendor_id, payerUserId: user.userId, amountKobo: amount });
        await ledger.markTransactionSuccess(reference, { channel: "wallet", paidAt: new Date().toISOString() });
        await claims.insertCardPayment(orderId, due.type, String(due.expected), reference);
        await new PaymentsRepository(tx).markPaidByReference(reference, new Date().toISOString());
        await new PaymentClaimsService(this.db).applyConfirmedCardPayment(tx, orderId, reference, "your Levromart wallet");
        return { reference, amount_kobo: String(amount), balance_kobo: String(after) };
      }),
    );
  }

  /* ------------------------------------------------------------ withdrawals */

  /**
   * Sends wallet money to the person's bank account. Safety rules:
   *  - no withdrawal for 24 hours after the bank account was added or changed;
   *  - the first withdrawal to a new or changed account waits for an admin;
   *  - money that came by top-up or transfer in the last 24 hours waits for an admin (stops stolen cards being cashed out);
   *  - at most 3 withdrawals a day.
   * Money waiting for an admin is taken out of the balance at once, so it cannot be spent twice; a rejection puts it back.
   */
  async withdraw(me: Identity | null, amountKobo: number | null) {
    const user = need(me);
    const plan = await this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new WalletRepository(tx);
        await repo.ensure(user.userId);
        const [w] = await repo.lock([user.userId]);
        if (!w) throw notFound("Wallet not found.");
        if (w.frozen) throw forbidden("Your wallet is on hold. Please contact Levromart support.");
        const account = await repo.withdrawalAccount(user.userId);
        if (!account) throw badRequest("Add your bank account first, so we know where to send your money.");
        if (account.age_hours < WALLET.bankChangeWaitHours) {
          const wait = Math.ceil(WALLET.bankChangeWaitHours - account.age_hours);
          throw badRequest(`For your safety, you can withdraw ${wait} hour${wait === 1 ? "" : "s"} from now: your bank account was added or changed less than 24 hours ago. This stops anyone who gets into your account from moving your money to their own bank.`);
        }
        const balance = Number(w.balance_kobo);
        const amount = amountKobo == null ? balance : Number(amountKobo);
        if (!Number.isInteger(amount) || amount < WALLET.minWithdrawal) throw badRequest(`The smallest withdrawal is ${naira(WALLET.minWithdrawal)}.`);
        if (amount > balance) throw badRequest(`You have ${naira(balance)} in your wallet.`);
        if ((await repo.withdrawalsToday(user.userId)) >= WALLET.withdrawalsPerDay) throw badRequest(`You can withdraw ${WALLET.withdrawalsPerDay} times in 24 hours. Please try again tomorrow.`);
        const fresh = await repo.recentInflowKobo(user.userId, WALLET.freshMoneyHours);
        const firstToAccount = !(await repo.paidToAccountSince(user.userId, account.recipient_code, account.verified_at));
        const review = firstToAccount
          ? "First withdrawal to this bank account"
          : amount > Math.max(0, balance - fresh)
            ? "Includes money added or received in the last 24 hours"
            : null;
        const reference = WALLET_TRANSFER_PREFIX + crypto.randomBytes(12).toString("hex");
        const id = await repo.insertWithdrawal({ userId: user.userId, amountKobo: amount, status: review ? "requested" : "processing", reviewReason: review, reference, account });
        const after = await repo.move(user.userId, -amount, "withdrawal", { reference: "withdrawal:" + id, withdrawalId: id, note: `To ${account.bank_name ?? "your bank"} ···${account.last4 ?? ""}` });
        if (after == null) throw badRequest("You do not have enough in your wallet.");
        if (review) {
          await new NotificationWriter(tx).notifyAdmins("Wallet withdrawal to check", `@${w.handle} asked to withdraw ${naira(amount)} (${review}).`, "adminPayments", { tab: "todo" }, user.userId);
        }
        return { id, reference, amount, review, recipient: account.recipient_code };
      }),
    );
    if (plan.review) return { status: "requested", amount_kobo: String(plan.amount), review_reason: plan.review };
    return this.send_(plan.id, plan.reference, plan.amount, plan.recipient);
  }

  /** Admin approves (the money is sent) or rejects (the money goes back into the wallet, with the reason). */
  async decideWithdrawal(me: Identity | null, id: string | null, decision: string | null, reason: string | null) {
    const user = need(me);
    if (decision !== "approve" && decision !== "reject") throw badRequest("Decision must be approve or reject.");
    const why = String(reason ?? "").trim();
    if (decision === "reject" && why.length < 3) throw badRequest("Write the reason. The person will see it.");
    const plan = await this.ready(() =>
      this.db().asService(async (tx) => {
        if (!(await new AccessRepository(tx).isAdmin(user.userId))) throw forbidden("Admin access required.");
        const repo = new WalletRepository(tx);
        const w = id ? await repo.withdrawal(id) : null;
        if (!w) throw notFound("Withdrawal not found.");
        if (w.status !== "requested") throw conflict("This withdrawal was already decided.");
        const notify = new NotificationWriter(tx);
        if (decision === "reject") {
          await repo.lock([w.user_id]);
          await repo.setWithdrawal(w.id, "rejected", { decidedBy: user.userId, rejectReason: why });
          await repo.move(w.user_id, Number(w.amount_kobo), "withdrawal_return", { reference: "withdrawal_return:" + w.id, withdrawalId: w.id, note: "Withdrawal not approved: " + why });
          await notify.create({ userId: w.user_id, type: "wallet_withdrawal_rejected", title: "Withdrawal not approved", body: `${naira(w.amount_kobo)} is back in your wallet. Reason: ${why}`, targetView: "levroWallet", actorId: null });
          await repo.logAdminAction(user.userId, "reject_wallet_withdrawal", w.user_id, naira(w.amount_kobo));
          return null;
        }
        await repo.setWithdrawal(w.id, "processing", { decidedBy: user.userId });
        await repo.logAdminAction(user.userId, "approve_wallet_withdrawal", w.user_id, naira(w.amount_kobo));
        return { id: w.id, reference: w.transfer_reference, amount: Number(w.amount_kobo), recipient: w.recipient_code ?? "" };
      }),
    );
    if (!plan) return { status: "rejected" };
    return this.send_(plan.id, plan.reference, plan.amount, plan.recipient);
  }

  /** The Paystack transfer, after the database transaction has ended, with the withdrawal's own stable reference. */
  private async send_(id: string, reference: string, amount: number, recipient: string) {
    try {
      const t = await getPaystackClient().initiateTransfer({ amountKobo: amount, recipientCode: recipient, reference, reason: "Levromart wallet withdrawal" });
      if (String(t.status).toLowerCase() === "success") {
        await this.db().asService((tx) => applyWalletTransferEvent(tx, reference, "success", null, t.transfer_code ?? null));
        return { status: "sent", amount_kobo: String(amount) };
      }
      return { status: "processing", amount_kobo: String(amount) };
    } catch (err) {
      if (err instanceof PaystackUnknownOutcome) {
        await this.db().asService((tx) => new NotificationWriter(tx).notifyAdmins("Check a wallet withdrawal", `Paystack did not answer for ${reference}. Check it in the Paystack dashboard before doing anything.`, null, null, null));
        return { status: "processing", amount_kobo: String(amount) };
      }
      const message = err instanceof PaystackRejected ? err.message : err instanceof PaystackUnavailable ? "Paystack was not available" : "Unexpected error";
      await this.db().asService((tx) => applyWalletTransferEvent(tx, reference, "failed", message, null));
      if (err instanceof PaystackRejected && /balance|insufficient/i.test(err.message)) {
        await this.db().asService((tx) => new NotificationWriter(tx).notifyAdmins("Top up the Paystack balance", "A wallet withdrawal could not be sent because the Paystack balance is too low.", null, null, null));
      }
      throw serviceUnavailable("We could not send your money right now. It is back in your wallet; please try again later.");
    }
  }

  /* ------------------------------------------------------------------ admin */

  async adminList(me: Identity | null, q: string | null) {
    const user = need(me);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        if (!(await new AccessRepository(tx).isAdmin(user.userId))) throw forbidden("Admin access required.");
        const repo = new WalletRepository(tx);
        return { wallets: await repo.adminWallets(q, 60), withdrawals: await repo.adminWithdrawals(null, 60), held_kobo: String(await repo.totalHeldKobo()) };
      }),
    );
  }

  async adminFreeze(me: Identity | null, userId: string | null, frozen: boolean, reason: string | null) {
    const user = need(me);
    if (!userId) throw badRequest("Choose a wallet.");
    if (frozen && String(reason ?? "").trim().length < 3) throw badRequest("Write why the wallet is put on hold.");
    return this.ready(() =>
      this.db().asService(async (tx) => {
        if (!(await new AccessRepository(tx).isAdmin(user.userId))) throw forbidden("Admin access required.");
        const repo = new WalletRepository(tx);
        await repo.ensure(userId);
        await repo.setFrozen(userId, frozen, reason ? String(reason).trim().slice(0, 200) : null);
        await new NotificationWriter(tx).create({
          userId,
          type: "wallet_hold",
          title: frozen ? "Your wallet is on hold" : "Your wallet is active again",
          body: frozen ? "Sending, withdrawing and adding money are paused while Levromart checks your wallet. Contact support if you have questions." : "You can use your wallet again.",
          targetView: "levroWallet",
          actorId: null,
        });
        await repo.logAdminAction(user.userId, frozen ? "freeze_wallet" : "unfreeze_wallet", userId, String(reason ?? ""));
        return { frozen };
      }),
    );
  }

  private async ready<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      throw notReadyIfMissing(err, "The wallet");
    }
  }
}

function need(me: Identity | null): Identity {
  if (!me) throw forbidden("Please log in to continue.");
  return me;
}

/* ---------------------------------------------------- called from other services */

/** A wallet top-up Paystack confirmed: the wallet gets the amount the person asked for, once. */
export async function creditWalletTopup(tx: Tx, reference: string, metadata: Record<string, unknown>, grossKobo: number): Promise<string> {
  const ledger = new PaystackLedgerRepository(tx);
  const payer = await ledger.payerOf(reference);
  if (!payer) return "ignored: no payer";
  const net = Number(metadata.net_kobo);
  // the amount comes from what we recorded when the top-up started, never from the event alone
  const recorded = await ledger.topupNetKobo(reference);
  const amount = recorded ?? (Number.isInteger(net) && net > 0 && net <= grossKobo ? net : null);
  if (!amount) return "ignored: no amount";
  const repo = new WalletRepository(tx);
  await repo.ensure(payer);
  await repo.lock([payer]);
  if (await repo.entryExists(payer, "topup", reference)) return "duplicate: already credited";
  await repo.move(payer, amount, "topup", { reference, note: "Added with Paystack" });
  await new NotificationWriter(tx).create({ userId: payer, type: "wallet_topup", title: `${naira(amount)} added to your wallet`, body: "Your top-up was received.", targetView: "levroWallet", actorId: null });
  return "settled (wallet top-up)";
}

/** A refund due to a buyer goes into their wallet, once. False when the wallet cannot be used (the refund then goes to the card). */
export async function creditWalletRefund(tx: Tx, refund: { id: string; order_id: string; buyer_id: string; amount_kobo: string }): Promise<boolean> {
  const repo = new WalletRepository(tx);
  const w = await repo.ensure(refund.buyer_id);
  // a wallet on hold receives nothing: the refund goes back to the card it was paid with instead
  if (!w || w.frozen) return false;
  await repo.lock([refund.buyer_id]);
  if (!(await repo.entryExists(refund.buyer_id, "refund_in", "refund:" + refund.id))) {
    await repo.move(refund.buyer_id, Number(refund.amount_kobo), "refund_in", { reference: "refund:" + refund.id, orderId: refund.order_id, note: "Refund" });
  }
  await new WalletRepository(tx).markRefundProcessed(refund.id);
  return true;
}

/** A shop's earnings for some orders move into the owner's wallet (marks those payouts "to_wallet"). Returns the amount moved. */
export async function creditWalletEarnings(tx: Tx, ownerUserId: string, rows: { payout_id: string; order_id: string; net_kobo: string; commission_kobo: number }[]): Promise<number> {
  const repo = new WalletRepository(tx);
  await repo.ensure(ownerUserId);
  await repo.lock([ownerUserId]);
  let total = 0;
  for (const r of rows) {
    const amount = Number(r.net_kobo);
    if (!(await repo.payoutToWallet(r.payout_id, amount, r.commission_kobo))) continue;
    if (amount > 0 && !(await repo.entryExists(ownerUserId, "earnings_in", "payout:" + r.payout_id))) {
      await repo.move(ownerUserId, amount, "earnings_in", { reference: "payout:" + r.payout_id, orderId: r.order_id, note: "Shop earnings" });
      total += amount;
    }
  }
  return total;
}

/** A refund on an order whose earnings were already moved into the shop's wallet is taken back from that wallet. */
export async function takeRefundFromShopWallet(tx: Tx, ownerUserId: string, orderId: string, amountKobo: number, refundRef: string): Promise<boolean> {
  const repo = new WalletRepository(tx);
  await repo.ensure(ownerUserId);
  await repo.lock([ownerUserId]);
  return (await repo.move(ownerUserId, -amountKobo, "refund_out", { reference: refundRef, orderId, note: "Refunded to the buyer" })) != null;
}

/** The outcome of a wallet withdrawal's bank transfer (Paystack's webhook, or the immediate answer). Null when not a wallet withdrawal. */
export async function applyWalletTransferEvent(tx: Tx, reference: string, to: "success" | "failed" | "reversed", detail: string | null, code: string | null = null): Promise<string | null> {
  const repo = new WalletRepository(tx);
  const w = await repo.withdrawalByReference(reference);
  if (!w) return null;
  if (w.status === to) return "duplicate: already " + to;
  if (w.status === "success" && to !== "reversed") return `ignored: out of order (${w.status} -> ${to})`;
  if (w.status === "failed" || w.status === "reversed" || w.status === "rejected") return `ignored: already ${w.status}`;
  await repo.setWithdrawal(w.id, to, { error: to === "success" ? null : detail, code });
  const notify = new NotificationWriter(tx);
  if (to === "success") {
    await notify.create({ userId: w.user_id, type: "wallet_withdrawal_sent", title: "Money sent to your bank", body: `${naira(w.amount_kobo)} was sent to ${w.bank_name ?? "your bank"} ···${w.account_last4 ?? ""}.`, targetView: "levroWallet", actorId: null });
  } else {
    await repo.lock([w.user_id]);
    await repo.move(w.user_id, Number(w.amount_kobo), "withdrawal_return", { reference: "withdrawal_return:" + w.id, withdrawalId: w.id, note: "The bank transfer did not go through" });
    await notify.create({ userId: w.user_id, type: "wallet_withdrawal_failed", title: "Withdrawal not sent", body: `Your withdrawal of ${naira(w.amount_kobo)} could not be sent. The money is back in your wallet.`, targetView: "levroWallet", actorId: null });
  }
  return to;
}

export type { WalletAccount };
