import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PayoutAccountsRepository } from "../../database/repositories/payout-accounts.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, maskAccount } from "../../integrations/paystack/index.js";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../../shared/errors/app-error.js";

const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

interface Bank {
  name: string;
  code: string;
}

/** The same account name written two ways ("ADA OBI" / "Obi Ada") counts as the same: compare the sorted words. */
export function sameAccountName(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ");
  return words(a) !== "" && words(a) === words(b);
}

/**
 * Vendors' payout accounts (issue #97): the bank list, the account-name check, and saving a verified account as a Paystack
 * transfer recipient. The full account number is never sent back to the browser: only the last four digits.
 */
export class PayoutAccountsService {
  private banks: { at: number; list: Bank[] } | null = null;

  constructor(private readonly db: () => DataContext) {}

  /** Nigerian banks from Paystack, kept for 24 hours. */
  async listBanks(): Promise<Bank[]> {
    if (this.banks && Date.now() - this.banks.at < BANKS_TTL_MS) return this.banks.list;
    const rows = await this.paystack(() => getPaystackClient().listBanks());
    const list = rows.map((b) => ({ name: b.name, code: b.code })).sort((a, b) => a.name.localeCompare(b.name));
    this.banks = { at: Date.now(), list };
    return list;
  }

  /** Asks Paystack whose account this is, for the owner to confirm. */
  async resolve(input: { bankCode: string; accountNumber: string }): Promise<{ accountName: string; bankName: string; accountLast4: string }> {
    const bank = await this.bankOf(input.bankCode);
    let found;
    try {
      found = await getPaystackClient().resolveAccount(input);
    } catch (err) {
      throw this.asUserError(err, "We could not find that account. Please check the bank and the account number.");
    }
    return { accountName: found.account_name, bankName: bank.name, accountLast4: input.accountNumber.slice(-4) };
  }

  /** The owner confirms the name Paystack gave; the account is checked again here, then saved as a transfer recipient. */
  async saveMine(me: Identity, input: { bankCode: string; accountNumber: string; confirmedAccountName: string }) {
    // only a shop owner gets any further: do not ask Paystack (or create a recipient) for anyone else
    if (!(await this.db().asService((tx) => new PayoutAccountsRepository(tx).ownShop(me.userId)))) throw notFound("You do not have a shop yet.");
    const bank = await this.bankOf(input.bankCode);
    // Paystack calls come before the database transaction: never hold a transaction open during a network call
    let found;
    try {
      found = await getPaystackClient().resolveAccount({ accountNumber: input.accountNumber, bankCode: input.bankCode });
    } catch (err) {
      throw this.asUserError(err, "We could not find that account. Please check the bank and the account number.");
    }
    if (!sameAccountName(found.account_name, input.confirmedAccountName)) throw badRequest("The account name does not match. Please check the details and confirm the name again.");
    let recipient;
    try {
      recipient = await getPaystackClient().createTransferRecipient({ name: found.account_name, accountNumber: input.accountNumber, bankCode: input.bankCode });
    } catch (err) {
      throw this.asUserError(err, "We could not set up payouts for that account.");
    }

    return this.db().asService(async (tx) => {
      const accounts = new PayoutAccountsRepository(tx);
      const shop = await accounts.ownShop(me.userId);
      if (!shop) throw notFound("You do not have a shop yet.");
      const changed = !!shop.account_number && (shop.account_number !== input.accountNumber || shop.bank_code !== input.bankCode);
      await accounts.save(shop.id, { bankCode: input.bankCode, bankName: bank.name, accountNumber: input.accountNumber, accountName: found.account_name, recipientCode: recipient.recipient_code });
      const notify = new NotificationWriter(tx);
      if (shop.payout_verified_at || changed) {
        await notify.create({
          userId: me.userId,
          type: "payout_account_changed",
          title: "Your payout account was changed",
          body: `Payouts will go to ${bank.name} ${maskAccount(input.accountNumber)}. If this was not you, contact support now.`,
          targetView: "vendorDashboard",
          targetParams: null,
          actorId: null,
        });
        await notify.notifyAdmins("Vendor payout account changed", `${shop.business_name ?? "A shop"} changed its payout account to ${bank.name} ${maskAccount(input.accountNumber)}.`, null, { vendorId: shop.id }, null);
      }
      return { bankName: bank.name, accountName: found.account_name, accountLast4: input.accountNumber.slice(-4), verified: true };
    });
  }

  /** The owner's saved account, never with the full number. */
  async mine(me: Identity) {
    return this.db().asService(async (tx) => {
      const shop = await new PayoutAccountsRepository(tx).ownShop(me.userId);
      if (!shop) throw notFound("You do not have a shop yet.");
      const last4 = shop.payout_account_last4 ?? (shop.account_number ? shop.account_number.slice(-4) : null);
      return {
        bankName: shop.bank_name,
        accountName: shop.account_name,
        accountLast4: last4,
        verified: !!shop.payout_verified_at && !!shop.transfer_recipient_code,
        verifiedAt: shop.payout_verified_at,
      };
    });
  }

  /** Admins: live shops that have no verified payout account yet. */
  async unverifiedShops(me: Identity, page: { limit: number; offset: number }) {
    return this.db().asService(async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Only admins can see this.");
      const repo = new PayoutAccountsRepository(tx);
      return { total: await repo.countUnverified(), shops: await repo.unverified(page.limit, page.offset) };
    });
  }

  /* ------------------------------------------------------------------ helpers */

  private async bankOf(code: string): Promise<Bank> {
    const bank = (await this.listBanks()).find((b) => b.code === code);
    if (!bank) throw badRequest("Please choose a bank from the list.");
    return bank;
  }

  private async paystack<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw this.asUserError(err, "Paystack could not answer that.");
    }
  }

  private asUserError(err: unknown, rejected: string): Error {
    if (err instanceof PaystackRejected) return badRequest(rejected);
    if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) return serviceUnavailable("Paystack could not be reached. Please try again in a moment.");
    return err instanceof Error ? err : new Error("Unexpected error");
  }
}
