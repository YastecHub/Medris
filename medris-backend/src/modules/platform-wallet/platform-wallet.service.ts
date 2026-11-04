import crypto from "node:crypto";
import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PlatformWalletRepository } from "../../database/repositories/platform-wallet.repository.js";
import { WalletRepository } from "../../database/repositories/wallet.repository.js";
import { PasswordCheckUnavailable, passwordMatches } from "../../integrations/password-check.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, koboToNaira } from "../../integrations/paystack/index.js";
import { badRequest, forbidden, notReadyIfMissing, serviceUnavailable } from "../../shared/errors/app-error.js";
import { sameAccountName } from "../payout-accounts/payout-accounts.service.js";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

export const PLATFORM_TRANSFER_PREFIX = "lvm_pw_";
export const PLATFORM = {
  minWithdrawal: 10_000, // ₦100
  withdrawalsPerDay: 5,
  /** After Levromart's bank account is added or changed, nothing can be withdrawn for this long. */
  bankChangeWaitHours: 24,
  /** Wrong passwords before the person must wait. */
  passwordTries: 5,
  passwordLockMs: 15 * 60_000,
} as const;
const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });

function need(me: Identity | null): Identity {
  if (!me) throw forbidden("Please sign in.");
  return me;
}

/**
 * Levromart's own wallet (migration 0035): the 3% commission as it is collected, withdrawn to Levromart's bank account.
 * Every admin can see it. Only a super admin can set the bank account or withdraw, and only after typing their password again;
 * a new or changed bank account cannot be paid for 24 hours, and every admin is told about each change and each withdrawal.
 */
export class PlatformWalletService {
  private readonly fails = new Map<string, { n: number; until: number }>();

  constructor(
    private readonly db: () => DataContext,
    private readonly checkPassword: (userId: string, email: string, password: string) => Promise<boolean> = passwordMatches,
  ) {}

  async summary(me: Identity | null) {
    const user = need(me);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const access = new AccessRepository(tx);
        if (!(await access.isAdmin(user.userId))) throw forbidden("Admin access required.");
        const repo = new PlatformWalletRepository(tx);
        const account = await repo.account();
        return {
          balance_kobo: String(await repo.balanceKobo()),
          commission: {
            today_kobo: String(await repo.commissionKobo(1)),
            week_kobo: String(await repo.commissionKobo(7)),
            month_kobo: String(await repo.commissionKobo(30)),
            all_kobo: String(await repo.commissionKobo(null)),
          },
          // monthly listing fees, apart from the commission (migration 0036)
          listing_fees: {
            today_kobo: String(await repo.listingFeesKobo(1)),
            week_kobo: String(await repo.listingFeesKobo(7)),
            month_kobo: String(await repo.listingFeesKobo(30)),
            all_kobo: String(await repo.listingFeesKobo(null)),
          },
          // fees on wallet payments, transfers and withdrawals (migration 0037)
          transaction_fees: {
            today_kobo: String(await repo.transactionFeesKobo(1)),
            week_kobo: String(await repo.transactionFeesKobo(7)),
            month_kobo: String(await repo.transactionFeesKobo(30)),
            all_kobo: String(await repo.transactionFeesKobo(null)),
          },
          withdrawn_kobo: String(await repo.withdrawnKobo()),
          account: account
            ? {
                bank_name: account.bank_name,
                account_name: account.account_name,
                last4: account.account_last4,
                changed_at: account.changed_at,
                wait_hours: Math.max(0, Math.ceil(PLATFORM.bankChangeWaitHours - Number(account.age_hours))),
              }
            : null,
          can_manage: await access.isSuperAdmin(user.userId),
          entries: await repo.entries(null, 60),
          withdrawals: await repo.recentWithdrawals(10),
          min_withdrawal_kobo: String(PLATFORM.minWithdrawal),
        };
      }),
    );
  }

  async history(me: Identity | null, before: string | null) {
    const user = need(me);
    if (before && Number.isNaN(Date.parse(before))) throw badRequest("Invalid date.");
    return this.ready(() =>
      this.db().asService(async (tx) => {
        if (!(await new AccessRepository(tx).isAdmin(user.userId))) throw forbidden("Admin access required.");
        return { entries: await new PlatformWalletRepository(tx).entries(before, 60) };
      }),
    );
  }

  /** A super admin sets Levromart's bank account (password first). Withdrawals to it open 24 hours later. */
  async setAccount(me: Identity | null, input: { bankCode: string | null; accountNumber: string | null; confirmedName: string | null; password: string | null }) {
    const user = need(me);
    await this.superAdminWithPassword(user, input.password);
    const bankCode = String(input.bankCode ?? "").trim();
    const accountNumber = String(input.accountNumber ?? "").trim();
    if (!bankCode) throw badRequest("Choose the bank.");
    if (!/^\d{10}$/.test(accountNumber)) throw badRequest("Enter the 10-digit account number.");
    // Paystack calls happen before the database transaction
    const banks = await this.paystack(() => getPaystackClient().listBanks());
    const bank = banks.find((b) => b.code === bankCode);
    if (!bank) throw badRequest("Choose a bank from the list.");
    const found = await this.paystack(() => getPaystackClient().resolveAccount({ accountNumber, bankCode }), "We could not find that account. Check the bank and the number.");
    if (!sameAccountName(found.account_name, String(input.confirmedName ?? ""))) throw badRequest("The account name does not match. Please check the details and confirm the name again.");
    const recipient = await this.paystack(() => getPaystackClient().createTransferRecipient({ name: found.account_name, accountNumber, bankCode }), "We could not set up withdrawals to that account.");
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new PlatformWalletRepository(tx);
        await repo.lock();
        await repo.saveAccount({ bankCode, bankName: bank.name, accountName: found.account_name, last4: accountNumber.slice(-4), recipientCode: recipient.recipient_code, by: user.userId });
        await repo.logAdminAction(user.userId, "set_levromart_payout_account", `${bank.name} ···${accountNumber.slice(-4)}`);
        await new NotificationWriter(tx).notifyAdmins(
          "Levromart's payout account was changed",
          `Commission withdrawals will go to ${bank.name} ···${accountNumber.slice(-4)} (${found.account_name}) from 24 hours from now. If this was not planned, act now.`,
          "adminPayments",
          null,
          null,
        );
        return { bank_name: bank.name, account_name: found.account_name, last4: accountNumber.slice(-4), wait_hours: PLATFORM.bankChangeWaitHours };
      }),
    );
  }

  /** A super admin sends Levromart's commission to its bank account (password first). */
  async withdraw(me: Identity | null, amountKobo: number | null, password: string | null) {
    const user = need(me);
    await this.superAdminWithPassword(user, password);
    const plan = await this.ready(() =>
      this.db().asService(async (tx) => {
        const repo = new PlatformWalletRepository(tx);
        await repo.lock();
        const account = await repo.account();
        if (!account) throw badRequest("Add Levromart's bank account first.");
        if (Number(account.age_hours) < PLATFORM.bankChangeWaitHours) {
          const wait = Math.ceil(PLATFORM.bankChangeWaitHours - Number(account.age_hours));
          throw badRequest(`For safety, withdrawals open ${wait} hour${wait === 1 ? "" : "s"} from now: the bank account was added or changed less than 24 hours ago.`);
        }
        const balance = await repo.balanceKobo();
        const amount = amountKobo == null ? balance : Number(amountKobo);
        if (!Number.isInteger(amount) || amount < PLATFORM.minWithdrawal) throw badRequest(`The smallest withdrawal is ${naira(PLATFORM.minWithdrawal)}.`);
        if (amount > balance) throw badRequest(`Levromart's wallet has ${naira(balance)}.`);
        if ((await repo.withdrawalsToday()) >= PLATFORM.withdrawalsPerDay) throw badRequest(`At most ${PLATFORM.withdrawalsPerDay} withdrawals in 24 hours. Please try again tomorrow.`);
        const reference = PLATFORM_TRANSFER_PREFIX + crypto.randomBytes(12).toString("hex");
        const id = await repo.insertWithdrawal({ amountKobo: amount, reference, account, by: user.userId });
        await repo.addEntry({ kind: "withdrawal", amountKobo: -amount, withdrawalId: id, reference: "withdrawal:" + id, note: `To ${account.bank_name ?? "the bank"} ···${account.account_last4}` });
        await repo.logAdminAction(user.userId, "withdraw_levromart_commission", naira(amount));
        await new NotificationWriter(tx).notifyAdmins(
          "Commission withdrawal",
          `${naira(amount)} of Levromart's commission is being sent to ${account.bank_name ?? "the bank"} ···${account.account_last4}.`,
          "adminPayments",
          null,
          null,
        );
        return { reference, amount, recipient: account.recipient_code };
      }),
    );
    try {
      const t = await getPaystackClient().initiateTransfer({ amountKobo: plan.amount, recipientCode: plan.recipient, reference: plan.reference, reason: "Levromart commission" });
      if (String(t.status).toLowerCase() === "success") {
        await this.db().asService((tx) => applyPlatformTransferEvent(tx, plan.reference, "success", null, t.transfer_code ?? null));
        return { status: "sent", amount_kobo: String(plan.amount) };
      }
      return { status: "processing", amount_kobo: String(plan.amount) };
    } catch (err) {
      if (err instanceof PaystackUnknownOutcome) return { status: "processing", amount_kobo: String(plan.amount) };
      const message = err instanceof PaystackRejected ? err.message : err instanceof PaystackUnavailable ? "Paystack was not available" : "Unexpected error";
      await this.db().asService((tx) => applyPlatformTransferEvent(tx, plan.reference, "failed", message, null));
      throw serviceUnavailable(`Paystack did not send it (${message}). The money is back in Levromart's wallet.`);
    }
  }

  /* ------------------------------------------------------------------ helpers */

  /** Only a super admin, and only with the right password; five wrong tries lock it for 15 minutes. */
  private async superAdminWithPassword(user: Identity, password: string | null) {
    const pw = String(password ?? "");
    if (!pw) throw badRequest("Enter your password.");
    const lock = this.fails.get(user.userId);
    if (lock && lock.until > Date.now()) throw forbidden("Too many wrong passwords. Please wait 15 minutes and try again.");
    const email = await this.ready(() =>
      this.db().asService(async (tx) => {
        if (!(await new AccessRepository(tx).isSuperAdmin(user.userId))) throw forbidden("Only the super admin can move Levromart's money.");
        return new WalletRepository(tx).emailOf(user.userId);
      }),
    );
    if (!email) throw badRequest("Your account has no sign-in email, so the password cannot be checked.");
    let ok: boolean;
    try {
      ok = await this.checkPassword(user.userId, email, pw);
    } catch (err) {
      if (err instanceof PasswordCheckUnavailable) throw serviceUnavailable("We could not check your password right now. Please try again in a moment.");
      throw err;
    }
    if (!ok) {
      const n = (lock && lock.until > Date.now() - PLATFORM.passwordLockMs ? lock.n : 0) + 1;
      this.fails.set(user.userId, { n, until: n >= PLATFORM.passwordTries ? Date.now() + PLATFORM.passwordLockMs : 0 });
      if (n >= PLATFORM.passwordTries) {
        await this.db().asService((tx) => new NotificationWriter(tx).notifyAdmins("Wrong password on Levromart's wallet", "Someone typed a wrong admin password 5 times while trying to move Levromart's commission.", "adminPayments", null, null));
      }
      throw forbidden("Wrong password.");
    }
    this.fails.delete(user.userId);
  }

  private async paystack<T>(call: () => Promise<T>, fallback = "Paystack could not answer that."): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof PaystackRejected) throw badRequest(fallback);
      throw serviceUnavailable("Paystack is not answering right now. Please try again in a moment.");
    }
  }

  private async ready<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw notReadyIfMissing(err, "Levromart's wallet");
    }
  }
}

/** The outcome of a commission withdrawal's bank transfer (Paystack's webhook, or the immediate answer). Null when not one. */
export async function applyPlatformTransferEvent(tx: Tx, reference: string, to: "success" | "failed" | "reversed", detail: string | null, code: string | null = null): Promise<string | null> {
  const repo = new PlatformWalletRepository(tx);
  await repo.lock();
  const w = await repo.withdrawalByReference(reference);
  if (!w) return null;
  if (w.status === to) return "duplicate: already " + to;
  if (w.status === "success" && to !== "reversed") return `ignored: out of order (${w.status} -> ${to})`;
  if (w.status === "failed" || w.status === "reversed") return `ignored: already ${w.status}`;
  await repo.setWithdrawal(w.id, to, to === "success" ? null : detail, code);
  const notify = new NotificationWriter(tx);
  if (to === "success") {
    await notify.notifyAdmins("Commission sent", `${naira(w.amount_kobo)} was sent to ${w.bank_name ?? "Levromart's bank"} ···${w.account_last4 ?? ""}.`, "adminPayments", null, null);
  } else {
    await repo.addEntry({ kind: "withdrawal_return", amountKobo: Number(w.amount_kobo), withdrawalId: w.id, reference: "withdrawal_return:" + w.id, note: "The bank transfer did not go through" });
    await notify.notifyAdmins("Commission withdrawal not sent", `${naira(w.amount_kobo)} could not be sent and is back in Levromart's wallet.`, "adminPayments", null, null);
  }
  return to;
}
