import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PaymentsAdminRepository, type Page, type TxFilter } from "../../database/repositories/payments-admin.repository.js";
import { getPaystackClient, koboToNaira } from "../../integrations/paystack/index.js";
import { forbidden } from "../../shared/errors/app-error.js";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

const naira = (kobo: string | number) => koboToNaira(Number(kobo));
/** References our own flows create. A successful Paystack payment with one of these and no ledger row is a real problem. */
const LEDGER_PREFIX = "lvm_ord_";
const PER_PAGE = 100;
const MAX_PAGES = 50;

interface Problem {
  kind: "paid_at_paystack_not_settled" | "settled_here_not_at_paystack" | "amount_mismatch" | "missing_from_ledger" | "transfer_stuck" | "refund_stuck";
  reference?: string;
  detail: string;
}

/**
 * The admin Payments area and the daily check that Paystack and the database agree (issue #101).
 * Reading is admin-only; the reconciliation only reads from Paystack (nothing is changed there).
 */
export class PaymentsAdminService {
  constructor(private readonly db: () => DataContext) {}

  private async admin<T>(me: Identity, work: (tx: Tx, repo: PaymentsAdminRepository) => Promise<T>): Promise<T> {
    return this.db().asService(async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Only admins can see payments.");
      return work(tx, new PaymentsAdminRepository(tx));
    });
  }

  transactions(me: Identity, f: TxFilter, page: Page) {
    return this.admin(me, async (_tx, repo) => (await repo.transactions(f, page)).map((r) => ({ ...r, amount: naira((r as { amount_kobo: string }).amount_kobo) })));
  }

  refunds(me: Identity, f: TxFilter, page: Page) {
    return this.admin(me, async (_tx, repo) => (await repo.refunds(f, page)).map((r) => ({ ...r, amount: naira((r as { amount_kobo: string }).amount_kobo) })));
  }

  /** Totals for today / the last 7 days / the last 30 days, and how many things are stuck. */
  summary(me: Identity) {
    return this.admin(me, async (_tx, repo) => {
      const shape = (t: Awaited<ReturnType<PaymentsAdminRepository["totals"]>>) => ({
        collected: naira(t.collected_kobo),
        refunded: naira(t.refunded_kobo),
        paidToVendors: naira(t.paid_out_kobo),
        commission: naira(t.commission_kobo),
      });
      const health = await repo.health();
      const stuck = health.stuck_payouts + health.stuck_refunds + health.failed_payouts;
      return {
        today: shape(await repo.totals("day")),
        week: shape(await repo.totals("week")),
        month: shape(await repo.totals("month")),
        health: { ...health, needsAttention: stuck + (health.last_report_problems ?? 0) },
      };
    });
  }

  reports(me: Identity, limit: number) {
    return this.admin(me, (_tx, repo) => repo.reports(limit));
  }

  /**
   * The daily job. Compares Paystack's successful payments of one day (default: yesterday, UTC) with the ledger and keeps the
   * report. Tells admins when anything is off, or when Paystack could not be asked at all.
   */
  async reconcile(day?: string): Promise<{ problems: number; checked: number }> {
    const { start, end } = windowOf(day);
    let paystack: Map<string, { amount: number }>;
    try {
      paystack = await this.fetchPaystack(start, end);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      await this.db().asService(async (tx) => {
        await new PaymentsAdminRepository(tx).saveReport(start, end, 1, { error: `Could not ask Paystack: ${message}`, problems: [] });
        await new NotificationWriter(tx).notifyAdmins("Payment check could not run", `Yesterday's Paystack check could not run (${message}). It will run again tomorrow, or an admin can run it by hand.`, null, null, null);
      });
      return { problems: 1, checked: 0 };
    }

    return this.db().asService(async (tx) => {
      const repo = new PaymentsAdminRepository(tx);
      const problems: Problem[] = [];
      const ledgerRows = new Map((await repo.byReferences([...paystack.keys()])).map((r) => [r.reference, r]));
      let legacy = 0;

      for (const [reference, p] of paystack) {
        const row = ledgerRows.get(reference);
        if (!row) {
          if (reference.startsWith(LEDGER_PREFIX)) problems.push({ kind: "missing_from_ledger", reference, detail: `Paystack took ${fmt(p.amount)} but there is no record of this payment here.` });
          else legacy++;
          continue;
        }
        if (!["success", "partially_refunded", "refunded"].includes(row.status)) {
          problems.push({ kind: "paid_at_paystack_not_settled", reference, detail: `Paystack took ${fmt(p.amount)} but here it is still "${row.status}".` });
        } else if (BigInt(row.amount_kobo) !== BigInt(p.amount)) {
          problems.push({ kind: "amount_mismatch", reference, detail: `Paystack took ${fmt(p.amount)} but here it is ${fmt(Number(row.amount_kobo))}.` });
        }
      }
      for (const row of await repo.paidBetween(start, end)) {
        if (!paystack.has(row.reference)) problems.push({ kind: "settled_here_not_at_paystack", reference: row.reference, detail: `Marked paid here (${fmt(Number(row.amount_kobo))}) but Paystack has no successful payment with this reference for that day.` });
      }
      for (const t of await repo.stuckTransfers()) problems.push({ kind: "transfer_stuck", reference: (t as { transfer_reference: string }).transfer_reference, detail: "A vendor payout has been on its way for over an hour." });
      for (const r of await repo.stuckRefunds()) problems.push({ kind: "refund_stuck", reference: (r as { transaction_reference: string }).transaction_reference, detail: "A refund has been under way for over an hour." });

      await repo.saveReport(start, end, problems.length, { checked: paystack.size, legacyPaymentsNotInLedger: legacy, problems: problems.slice(0, 200) });
      if (problems.length) await this.alert(tx, problems, start);
      return { problems: problems.length, checked: paystack.size };
    });
  }

  private async alert(tx: Tx, problems: Problem[], start: string): Promise<void> {
    const counts = new Map<string, number>();
    for (const p of problems) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    const text = [...counts].map(([k, n]) => `${n} ${LABEL[k as Problem["kind"]]}`).join(", ");
    await new NotificationWriter(tx).notifyAdmins("Payments don't match Paystack", `Check for ${start.slice(0, 10)}: ${text}. Open Admin, Payments to see them.`, "adminPayments", null, null);
  }

  private async fetchPaystack(start: string, end: string): Promise<Map<string, { amount: number }>> {
    const out = new Map<string, { amount: number }>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await getPaystackClient().listTransactions({ from: start, to: end, status: "success", page, perPage: PER_PAGE });
      for (const t of rows) if (t.reference && typeof t.amount === "number") out.set(t.reference, { amount: t.amount });
      if (rows.length < PER_PAGE) return out;
    }
    throw new Error("Too many payments in one day to check");
  }
}

const LABEL: Record<Problem["kind"], string> = {
  paid_at_paystack_not_settled: "paid at Paystack but not settled here",
  settled_here_not_at_paystack: "settled here but not at Paystack",
  amount_mismatch: "with a different amount",
  missing_from_ledger: "missing from the ledger",
  transfer_stuck: "payouts stuck",
  refund_stuck: "refunds stuck",
};
const fmt = (kobo: number) => "₦" + koboToNaira(kobo).toLocaleString("en-NG", { maximumFractionDigits: 2 });

/** [start, end) of one UTC day as ISO strings; the day before today by default. */
export function windowOf(day?: string): { start: string; end: string } {
  const d = day ? new Date(`${day}T00:00:00.000Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1));
  const end = new Date(d.getTime() + 24 * 3600 * 1000);
  return { start: d.toISOString(), end: end.toISOString() };
}
