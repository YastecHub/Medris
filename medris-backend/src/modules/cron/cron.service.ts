import { loadConfig } from "../../config/app-config.js";
import { findPgError } from "../../database/errors.js";
import { getDataContext } from "../../database/index.js";
import { BillingRepository } from "../../database/repositories/billing.repository.js";
import { NotifyRepository } from "../../database/repositories/messaging.repository.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { purgeEndedSessions } from "../auth/session.service.js";

const READ_NOTIFICATION_RETENTION_MS = 60 * 86_400_000;

/**
 * The daily job (Vercel Cron, 03:00 UTC):
 *  1. listing billing reminders/expiry (process_listing_billing_reminders) - its failure fails the run (502)
 *  2. commission deadline heads-up 3/2/1 days out (process_commission_deadline_reminders)
 *  3. deletes read notifications older than 60 days
 *  4. with backend sessions on: removes sessions that ended over 30 days ago
 * Each step is its own transaction, so one failing step never undoes another.
 */
export async function runDailyCron(now: Date = new Date()): Promise<ServiceResult> {
  const data = getDataContext();

  let listing: Record<string, unknown>;
  try {
    listing = await data.asService((tx) => new BillingRepository(tx).processListingBillingReminders());
  } catch (err) {
    const pg = findPgError(err);
    return { status: 502, body: { error: pg?.message || "Listing billing lifecycle processor failed.", details: pg ? { code: pg.code, message: pg.message } : {} } };
  }

  let commissionReminders: unknown = null;
  try {
    commissionReminders = await data.asService((tx) => new BillingRepository(tx).processCommissionDeadlineReminders());
  } catch (err) {
    console.error("[daily-cron] commission deadline reminders failed:", err);
  }

  let notificationsTrimmed: boolean | null = null;
  try {
    const cutoff = new Date(now.getTime() - READ_NOTIFICATION_RETENTION_MS).toISOString();
    await data.asService((tx) => new NotifyRepository(tx).deleteReadBefore(cutoff));
    notificationsTrimmed = true;
  } catch (err) {
    notificationsTrimmed = false;
    console.error("[daily-cron] notification cleanup failed:", err);
  }

  let sessionsPurged: number | undefined;
  if (loadConfig().auth.backendSessions) {
    sessionsPurged = await purgeEndedSessions(data, now).catch((err: unknown) => {
      console.error("[daily-cron] session clean-up failed:", err);
      return undefined;
    });
  }

  return {
    status: 200,
    body: { ok: true, notificationsTrimmed, ...listing, commissionReminders, ...(sessionsPurged !== undefined ? { sessionsPurged } : {}) },
  };
}
