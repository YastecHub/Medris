import type { DataContext } from "../../database/context.js";
type Executor = Parameters<Parameters<DataContext["asService"]>[0]>[0]; // a service-role transaction
import { getDataContext } from "../../database/index.js";
import { BillingRepository } from "../../database/repositories/billing.repository.js";
import { PaymentsRepository } from "../../database/repositories/orders.repository.js";
import { VendorsRepository } from "../../database/repositories/vendors.repository.js";
import type { PaystackTransaction } from "../../integrations/paystack.js";

/**
 * Marks a successful Paystack charge as paid. A reference can belong to:
 *  - "commission_..."  a vendor settling owed commission,
 *  - "billing_..."     a vendor setting up monthly card billing,
 *  - anything else     a buyer's order payment ("medris_...").
 * Shared by the webhook (authoritative) and the browser-return verify call.
 */
export async function settleReference(reference: string, txData: PaystackTransaction | undefined, within?: Executor): Promise<void> {
  // `within`: run inside the caller's transaction (the Paystack webhook) instead of opening our own
  const data = within ? { asService: <T>(work: (db: Executor) => Promise<T>) => work(within) } : getDataContext();
  const now = () => new Date().toISOString();

  if (reference.startsWith("commission_")) {
    await data.asService(async (tx) => {
      const billing = new BillingRepository(tx);
      const settlement = await billing.settlementByReference(reference);
      if (!settlement || settlement.status === "paid") return;
      // Settlement and the charges it covers are marked paid together (one transaction).
      await billing.markSettlementPaid(settlement.id, settlement.vendor_id, now());
    });
    return;
  }

  if (reference.startsWith("billing_")) {
    await data.asService(async (tx) => {
      const billing = new BillingRepository(tx);
      const charge = await billing.monthlyChargeByReference(reference);
      if (!charge || charge.status === "paid") return;
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      // Undefined values are left unchanged, as the original JSON PATCH omitted them.
      await new VendorsRepository(tx).update(charge.vendor_id, {
        paystackAuthorizationCode: txData?.authorization?.authorization_code,
        paystackCustomerCode: txData?.customer?.customer_code,
        monthlyBillingStatus: "active",
        nextMonthlyChargeAt: nextMonth.toISOString(),
      });
      await billing.markMonthlyChargePaid(charge.id);
    });
    return;
  }

  await data.asService((tx) => new PaymentsRepository(tx).markPaidByReference(reference, now()));
}
