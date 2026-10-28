import { randomUUID } from "node:crypto";
import type { DataContext, Identity } from "../../database/context.js";
import { BuyerWalletRepository } from "../../database/repositories/buyer-wallet.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, koboToNaira, maskAccount } from "../../integrations/paystack/index.js";
import { badRequest, forbidden, notReadyIfMissing, serviceUnavailable } from "../../shared/errors/app-error.js";
import { sameAccountName } from "../payout-accounts/payout-accounts.service.js";

/** Paystack does not send less than this. */
export const MIN_REFUND_WITHDRAWAL_KOBO = 10_000;
/** After the refund account is changed, withdrawing waits this long (a stolen login cannot empty the wallet at once). */
export const ACCOUNT_CHANGE_WAIT_HOURS = 24;
const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });
export const REFUND_TRANSFER_PREFIX = "lvm_bw_";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

/** The outcome of a refund withdrawal's transfer, from Paystack's webhook. Null when the reference is not a refund withdrawal. */
export async function applyRefundTransferEvent(tx: Tx, reference: string, to: "success" | "failed" | "reversed", detail: string | null): Promise<string | null> {
  const repo = new BuyerWalletRepository(tx);
  const w = await repo.byReference(reference);
  if (!w) return null;
  if (w.status === to) return "duplicate: already " + to;
  if (w.status === "success" && to !== "reversed") return `ignored: out of order (${w.status} -> ${to})`;
  await repo.settle(w.id, to, { error: to === "success" ? null : detail });
  const notify = new NotificationWriter(tx);
  if (to === "success") await notify.create({ userId: w.buyer_id, type: "refund_sent", title: "Refund sent", body: `${naira(w.amount_kobo)} was sent to your bank account.`, targetView: "buyerProfile", actorId: null });
  else await notify.create({ userId: w.buyer_id, type: "refund_not_sent", title: "Refund not sent", body: `Your withdrawal of ${naira(w.amount_kobo)} could not be sent. The money is back in your refunds wallet.`, targetView: "buyerProfile", actorId: null });
  return to;
}

/**
 * The buyer's refunds wallet (migration 0019). Once a buyer has saved a verified bank account, every refund due to them is put
 * in the wallet (by the refund worker) instead of going back to the card, and they withdraw it to that account when they like.
 */
export class BuyerWalletService {
  constructor(private readonly db: () => DataContext) {}

  /** What the wallet screen shows. */
  async summary(me: Identity | null) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.ready(() => this.db().asService(async (tx) => {
      const repo = new BuyerWalletRepository(tx);
      const account = await repo.account(me.userId);
      const credits = await repo.recentCredits(me.userId);
      const totals = await repo.totals(me.userId);
      return {
        has_account: !!account,
        account: account ? { bank_name: account.bank_name, account_name: account.account_name, last4: account.account_last4 } : null,
        available_kobo: totals.available,
        processing_kobo: totals.processing,
        blocked: this.blocked(account),
        min_kobo: MIN_REFUND_WITHDRAWAL_KOBO,
        credits,
        withdrawals: await repo.recentWithdrawals(me.userId),
      };
    }));
  }

  /** The buyer confirms the account name Paystack gave; it is checked again here and saved as a transfer recipient. */
  async saveAccount(me: Identity | null, input: { bankCode: string; accountNumber: string; confirmedAccountName: string }) {
    if (!me) throw forbidden("Please log in to continue.");
    if (!/^\d{10}$/.test(input.accountNumber)) throw badRequest("Enter a valid 10-digit account number.");
    const client = getPaystackClient();
    let bankName = "";
    try {
      const banks = await client.listBanks();
      const bank = banks.find((b) => b.code === input.bankCode);
      if (!bank) throw badRequest("Please choose a bank from the list.");
      bankName = bank.name;
    } catch (err) {
      throw this.userError(err, "Paystack could not answer that.");
    }
    let found;
    try {
      found = await client.resolveAccount({ accountNumber: input.accountNumber, bankCode: input.bankCode });
    } catch (err) {
      throw this.userError(err, "We could not find that account. Please check the bank and the account number.");
    }
    if (!sameAccountName(found.account_name, input.confirmedAccountName)) throw badRequest("The account name does not match. Please check the details and confirm the name again.");
    let recipient;
    try {
      recipient = await client.createTransferRecipient({ name: found.account_name, accountNumber: input.accountNumber, bankCode: input.bankCode });
    } catch (err) {
      throw this.userError(err, "We could not set up refunds for that account.");
    }
    return this.ready(() => this.db().asService(async (tx) => {
      const repo = new BuyerWalletRepository(tx);
      const before = await repo.account(me.userId);
      await repo.saveAccount(me.userId, { bankCode: input.bankCode, bankName, accountName: found.account_name, last4: input.accountNumber.slice(-4), recipientCode: recipient.recipient_code });
      if (before) {
        await new NotificationWriter(tx).create({
          userId: me.userId,
          type: "refund_account_changed",
          title: "Your refund account was changed",
          body: `Refunds will go to ${bankName} ${maskAccount(input.accountNumber)}. If this was not you, contact support now.`,
          targetView: "buyerProfile",
          actorId: null,
        });
      }
      return { bank_name: bankName, account_name: found.account_name, last4: input.accountNumber.slice(-4) };
    }));
  }

  /** Withdraws everything available to the saved account. */
  async withdraw(me: Identity | null) {
    if (!me) throw forbidden("Please log in to continue.");
    const plan = await this.ready(() => this.db().asService(async (tx) => {
      const repo = new BuyerWalletRepository(tx);
      const account = await repo.account(me.userId);
      if (!account) throw badRequest("Add your bank account for refunds first.");
      const blocked = this.blocked(account);
      if (blocked) throw badRequest(blocked);
      const credits = await repo.availableCredits(me.userId);
      const total = credits.reduce((s, c) => s + Number(c.amount_kobo), 0);
      if (total < MIN_REFUND_WITHDRAWAL_KOBO) throw badRequest(total > 0 ? `The smallest withdrawal is ${naira(MIN_REFUND_WITHDRAWAL_KOBO)}. You have ${naira(total)}.` : "You have no refund money to withdraw.");
      const reference = REFUND_TRANSFER_PREFIX + randomUUID().replace(/-/g, "");
      const id = await repo.insertWithdrawal(me.userId, total, reference);
      await repo.attach(id, credits.map((c) => c.id));
      // admins are told of every refund withdrawal (it is sent automatically, no approval step)
      await new NotificationWriter(tx).notifyAdmins("Refund withdrawal", `A buyer is withdrawing ${naira(total)} of refund money to their bank account. It is sent automatically; nothing to approve.`, null, null, me.userId);
      return { id, reference, total, recipient: account.transfer_recipient_code };
    }));
    // the Paystack call is made after that transaction has ended, with the withdrawal's own stable reference
    try {
      const t = await getPaystackClient().initiateTransfer({ amountKobo: plan.total, recipientCode: plan.recipient, reference: plan.reference, reason: "Levromart refund" });
      if (String(t.status).toLowerCase() === "success") await this.settle(plan.id, "success", me.userId, plan.total, t.transfer_code ?? null);
      return { amount_kobo: plan.total, status: String(t.status).toLowerCase() === "success" ? "sent" : "processing" };
    } catch (err) {
      if (err instanceof PaystackUnknownOutcome) {
        await this.db().asService((tx) => new NotificationWriter(tx).notifyAdmins("Check a refund withdrawal", `Paystack did not answer for ${plan.reference}. Check it in the Paystack dashboard before doing anything.`, null, null, null));
        return { amount_kobo: plan.total, status: "processing" };
      }
      const message = err instanceof PaystackRejected ? err.message : err instanceof PaystackUnavailable ? "Paystack was not available" : "Unexpected error";
      await this.settle(plan.id, "failed", me.userId, plan.total, null, message);
      if (err instanceof PaystackRejected && /balance|insufficient/i.test(err.message)) {
        await this.db().asService((tx) => new NotificationWriter(tx).notifyAdmins("Top up the Paystack balance", "A buyer tried to withdraw a refund but the Paystack balance is too low.", null, null, null));
        throw serviceUnavailable("We could not send your refund right now. Please try again later.");
      }
      throw serviceUnavailable("We could not send your refund right now. Please try again in a little while.");
    }
  }

  private async settle(id: string, to: "success" | "failed", userId: string, total: number, code: string | null, error: string | null = null) {
    await this.db().asService(async (tx) => {
      await new BuyerWalletRepository(tx).settle(id, to, { code, error });
      if (to === "success") await new NotificationWriter(tx).create({ userId, type: "refund_sent", title: "Refund sent", body: `${naira(total)} was sent to your bank account.`, targetView: "buyerProfile", actorId: null });
    });
  }

  /** Runs a database step; a wallet whose tables do not exist yet answers "being set up". */
  private async ready<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      throw notReadyIfMissing(err, "The refunds wallet");
    }
  }

  private blocked(account: { verified_age_hours: number } | null): string | null {
    if (!account) return null;
    const wait = ACCOUNT_CHANGE_WAIT_HOURS - account.verified_age_hours;
    return wait > 0 ? `You changed your bank account recently. For your safety, withdrawals open again in ${Math.ceil(wait)} hour${Math.ceil(wait) === 1 ? "" : "s"}.` : null;
  }

  private userError(err: unknown, rejected: string): Error {
    if (err instanceof PaystackRejected) return badRequest(rejected);
    if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) return serviceUnavailable("Paystack could not be reached. Please try again in a moment.");
    return err instanceof Error ? err : new Error("Unexpected error");
  }
}
