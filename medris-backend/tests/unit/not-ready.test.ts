import { describe, expect, it } from "vitest";
import { notReadyIfMissing } from "../../src/shared/errors/app-error.js";

describe("notReadyIfMissing", () => {
  it("says a feature is being set up when its table does not exist", () => {
    const err = Object.assign(new Error('Failed query: select 1 from "buyer_payout_accounts"'), { cause: Object.assign(new Error('relation "public.buyer_payout_accounts" does not exist'), { code: "42P01" }) });
    const out = notReadyIfMissing(err, "The refunds wallet") as Error & { status?: number };
    expect(out.message).toContain("being set up");
    expect(out.status).toBe(503);
  });
  it("leaves every other error alone", () => {
    const err = new Error("boom");
    expect(notReadyIfMissing(err, "x")).toBe(err);
  });
});
