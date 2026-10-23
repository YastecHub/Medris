import { describe, it } from "vitest";

/** Money flows the plan describes that are not built yet: listed here so the gaps stay visible (each names its issue). */
describe("not built yet", () => {
  it.todo("a buyer's dispute resolved in their favour refunds through Paystack in one step (issue #99: the admin uses the refund button on the Payments screen)");
  it.todo("a dispute resolved in the vendor's favour releases the held payout by itself (issue #98: an admin presses Release)");
  it.todo("the monthly listing screen pays by card (the app still shows the manual bank transfer; issue #100 built the API only)");
  it.todo("the shop is locked when commission is overdue, and paying by card unlocks it through the new endpoint (covered by the old flow's tests; add a card end-to-end case once the switch is proven, issue #102)");
  it.todo("a refund after a partial payout (issue #99: refunds are refused once any payout left)");
});
