/**
 * "Pay now with Paystack" support for the order screens (issue #96). The browser never decides that something is paid:
 * it only asks the backend where the payment stands, which in turn asks Paystack.
 */

export type PaystackOutcome = "paid" | "failed" | "pending";

/** Delays between checks after the buyer comes back: 1 s, 2 s, 4 s, then every 8 s, up to about a minute. */
export function pollDelays(totalMs = 60_000): number[] {
  const out: number[] = [];
  let spent = 0;
  let next = 1000;
  while (spent < totalMs) {
    out.push(next);
    spent += next;
    next = Math.min(next * 2, 8000);
  }
  return out;
}

/** What a status answer means for the screen. */
export function outcomeOf(status: string | undefined): PaystackOutcome {
  if (status === "success" || status === "refunded" || status === "partially_refunded") return "paid";
  if (status === "failed" || status === "abandoned") return "failed";
  return "pending";
}

/**
 * Checks until the payment is paid or failed, or the time runs out ("pending": it may still be processing).
 * A check that errors counts as "not yet" and is tried again.
 */
export async function waitForPaystackPayment(
  check: () => Promise<string | undefined>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  delays: number[] = pollDelays(),
): Promise<PaystackOutcome> {
  for (let i = 0; i <= delays.length; i++) {
    try {
      const outcome = outcomeOf(await check());
      if (outcome !== "pending") return outcome;
    } catch {
      /* try again */
    }
    if (i < delays.length) await sleep(delays[i]!);
  }
  return "pending";
}

/** The reference format of payments started by this flow; older payments keep the old verify path. */
export const isPaystackOrderReference = (reference: string): boolean => reference.startsWith("lvm_ord_");
