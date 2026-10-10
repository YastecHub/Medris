import { SupabaseAdmin } from "../../integrations/supabase.js";
import type { PaystackTransaction } from "../../integrations/paystack.js";

/**
 * Marks a successful Paystack charge as paid. A reference can belong to:
 *  - "commission_..."  a vendor settling owed commission,
 *  - "billing_..."     a vendor setting up monthly card billing,
 *  - anything else     a buyer's order payment ("medris_...").
 * Shared by the webhook (authoritative) and the browser-return verify call.
 */
export async function settleReference(reference: string, txData: PaystackTransaction | undefined): Promise<void> {
  const db = SupabaseAdmin.fromEnv();
  const now = () => new Date().toISOString();

  if (reference.startsWith("commission_")) {
    const settlement = await db.first<{ id: string; vendor_id: string; status: string }>(
      `commission_settlements?provider_reference=eq.${encodeURIComponent(reference)}&select=id,vendor_id,status`,
    );
    if (!settlement || settlement.status === "paid") return;
    await db.patch(`commission_settlements?id=eq.${settlement.id}`, { status: "paid", paid_at: now() });
    await db.patch(`commission_charges?vendor_id=eq.${settlement.vendor_id}&status=eq.owed`, { status: "paid", paid_at: now() });
    return;
  }

  if (reference.startsWith("billing_")) {
    const charge = await db.first<{ id: string; vendor_id: string; status: string }>(
      `vendor_monthly_charges?provider_reference=eq.${encodeURIComponent(reference)}&select=id,vendor_id,status`,
    );
    if (!charge || charge.status === "paid") return;
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    await db.patch(`vendors?id=eq.${charge.vendor_id}`, {
      paystack_authorization_code: txData?.authorization?.authorization_code,
      paystack_customer_code: txData?.customer?.customer_code,
      monthly_billing_status: "active",
      next_monthly_charge_at: nextMonth.toISOString(),
    });
    await db.patch(`vendor_monthly_charges?id=eq.${charge.id}`, { status: "paid" });
    return;
  }

  await db.patch(`payments?provider_reference=eq.${encodeURIComponent(reference)}`, { status: "paid", paid_at: now() });
}
