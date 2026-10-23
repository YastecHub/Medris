import { expect, test, type Page, type Route } from "@playwright/test";
import { openApp } from "./support/app";
import { freezeForScreenshot } from "./support/app";

// Paying with Paystack, as a buyer sees it, against fixtures only: the backend's /api/v1 answers and Paystack's pop-up script
// are both faked here (nothing live is ever called; unknown hosts are blocked by support/network.ts).
// The journeys start from the app's own openVendorDirectPayment(orderId), the function every "Pay" button calls.

const BACKEND = "https://levromart-5212f03a7e44.herokuapp.com";
const ORDER = "11111111-1111-4111-8111-111111111111";
const CORS = { "access-control-allow-origin": "http://127.0.0.1:4180", "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" };

interface Fake {
  initialize: string[];
  status: string[];
  /** what /payments/paystack/{ref} answers, one per call (the last one repeats) */
  statuses: string[];
  /** the next initialize answer */
  amounts: { amountNaira: number; feeNaira: number; orderAmountNaira: number };
  initializeFails?: string;
  paystackOn: boolean;
  payouts: unknown[];
  summary: { status: number; body: unknown };
}

async function fakeBackend(page: Page, fake: Fake) {
  const respond = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  await page.route(`${BACKEND}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/payments/config") return respond(route, 200, { data: { paystackCheckout: fake.paystackOn } });
    if (/\/orders\/.+\/paystack\/initialize$/.test(path)) {
      fake.initialize.push(path);
      if (fake.initializeFails) return respond(route, 400, { error: { code: "bad_request", message: fake.initializeFails } });
      const n = fake.initialize.length;
      return respond(route, 200, { data: { authorizationUrl: `https://checkout.paystack.test/ref_${n}`, accessCode: `AC_${n}`, reference: `lvm_ord_e2e_${n}`, ...fake.amounts } });
    }
    const status = /^\/payments\/paystack\/(.+)$/.exec(path);
    if (status) {
      fake.status.push(status[1]!);
      const next = fake.statuses.length > 1 ? fake.statuses.shift()! : (fake.statuses[0] ?? "success");
      return respond(route, 200, { data: { status: next, orderStatus: next === "success" ? "confirmed" : null } });
    }
    if (path === "/shops/mine/payouts") return respond(route, 200, { data: fake.payouts });
    if (path.startsWith("/admin/payments/summary")) return respond(route, fake.summary.status, fake.summary.body);
    if (path.startsWith("/admin/payouts")) return respond(route, 200, { data: fake.payouts });
    if (path.startsWith("/admin/payments/")) return respond(route, 200, { data: [] });
    return respond(route, 404, { error: { code: "not_found", message: `unexpected ${path}` } });
  });
  // Paystack's pop-up script: a stand-in whose result the test chooses with window.__paystack
  await page.route("https://js.paystack.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.PaystackPop = function(){ this.resumeTransaction = function(code, cb){ window.__popupOpened = (window.__popupOpened||0)+1; setTimeout(function(){ var r = window.__paystack || 'success'; if (r==='success') cb.onSuccess({}); else if (r==='cancel') cb.onCancel(); else cb.onError({}); }, 50); }; };`,
    }),
  );
  await page.route("https://checkout.paystack.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Paystack test checkout</body></html>" }));
}

function newFake(over: Partial<Fake> = {}): Fake {
  return { initialize: [], status: [], statuses: ["success"], amounts: { amountNaira: 5_087.5, feeNaira: 87.5, orderAmountNaira: 5_000 }, paystackOn: true, payouts: [], summary: { status: 200, body: { data: {} } }, ...over };
}

async function pay(page: Page) {
  await page.evaluate((id) => (window as unknown as { openVendorDirectPayment: (id: string) => unknown }).openVendorDirectPayment(id), ORDER);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`buyer paying with Paystack / ${theme} / 390px`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    async function start(page: Page, fake: Fake) {
      const session = await openApp(page, { signedIn: true, theme });
      await fakeBackend(page, fake);
      // reload so the app's first look at the "is Paystack on?" switch is answered by the fake backend (the app remembers the answer)
      await page.reload();
      await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function" && !!document.querySelector("#app"));
      await page.clock.runFor(3000);
      await page.addStyleTag({ content: "#levroInstallBanner{display:none!important}" });
      return session;
    }

    test("Pay now: summary, continue, success pop-up, confirming, paid", async ({ page }) => {
      const fake = newFake();
      await start(page, fake);
      await pay(page);
      const modal = page.locator("#lvPayModal");
      await expect(modal).toContainText("Pay ₦5,087.5");
      await expect(modal).toContainText("Order amount");
      await expect(modal).toContainText("Paystack fee");
      await expect(modal.locator("#lvPmGo")).toBeVisible();
      await freezeForScreenshot(page);
      await expect(page).toHaveScreenshot(`pay-summary-${theme}.png`, { fullPage: false });
      await modal.locator("#lvPmGo").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __popupOpened?: number }).__popupOpened ?? 0)).toBe(1);
      await expect.poll(() => fake.status.length, { timeout: 15_000 }).toBeGreaterThan(0);
      await expect(page.locator("body")).toContainText("Paid. Thank you!");
      expect(fake.initialize).toHaveLength(1);
    });

    test("a closed pop-up says 'Payment cancelled' and nothing is checked or charged", async ({ page }) => {
      const fake = newFake();
      await start(page, fake);
      await page.evaluate(() => ((window as unknown as { __paystack: string }).__paystack = "cancel"));
      await pay(page);
      await page.locator("#lvPmGo").click();
      await expect(page.locator("body")).toContainText("Payment cancelled");
      expect(fake.status).toHaveLength(0);
    });

    test("a declined card: a clear message, and trying again works", async ({ page }) => {
      const fake = newFake({ statuses: ["failed"] });
      await start(page, fake);
      await pay(page);
      await page.locator("#lvPmGo").click();
      await expect(page.locator("body")).toContainText("Payment not completed");
      fake.statuses = ["success"];
      await pay(page);
      await page.locator("#lvPmGo").click();
      await expect(page.locator("body")).toContainText("Paid. Thank you!");
      expect(fake.initialize).toHaveLength(2);
    });

    test("a double tap on Continue opens one payment", async ({ page }) => {
      const fake = newFake();
      await start(page, fake);
      await pay(page);
      await page.locator("#lvPmGo").dblclick();
      await expect(page.locator("body")).toContainText("Paid. Thank you!");
      expect(await page.evaluate(() => (window as unknown as { __popupOpened?: number }).__popupOpened)).toBe(1);
      expect(fake.initialize).toHaveLength(1);
    });

    test("coming back with a reference while the webhook is slow: it keeps checking, then shows Paid", async ({ page }) => {
      const fake = newFake({ statuses: ["initialized", "initialized", "success"] });
      await start(page, fake);
      await page.evaluate(([ref, id]) => (window as unknown as { lvConfirmPaystack: (r: string, o: string) => unknown }).lvConfirmPaystack(ref!, id!), ["lvm_ord_e2e_9", ORDER]);
      await expect(page.locator("body")).toContainText("Paid. Thank you!", { timeout: 20_000 });
      expect(fake.status.length).toBeGreaterThanOrEqual(3);
    });

    test("pay after delivery: the balance payment shows the rest of the order amount", async ({ page }) => {
      const fake = newFake({ amounts: { amountNaira: 8_140, feeNaira: 140, orderAmountNaira: 8_000 } });
      await start(page, fake);
      await pay(page);
      await expect(page.locator("#lvPayModal")).toContainText("₦8,000");
      await expect(page.locator("#lvPayModal")).toContainText("You pay");
    });

    test("when the server refuses to start the payment, the buyer reads why", async ({ page }) => {
      const fake = newFake({ initializeFails: "This order can no longer be paid online." });
      await start(page, fake);
      await pay(page);
      await expect(page.locator("#lvPayModal")).toContainText("This order can no longer be paid online.");
    });

    test("switch off: no Paystack screen opens and nothing is sent to the payment endpoints", async ({ page }) => {
      const fake = newFake({ paystackOn: false });
      await start(page, fake);
      await pay(page).catch(() => undefined);
      await page.waitForTimeout(300);
      await expect(page.locator("#lvPayModal")).toHaveCount(0);
      expect(fake.initialize).toHaveLength(0);
    });

    test("the vendor sees each payout and its status on the Earnings page", async ({ page }) => {
      const fake = newFake({
        payouts: [
          { id: "p1", orderId: ORDER, amount: 4850, commission: 150, status: "success", holdReason: null, createdAt: "2026-03-01T10:00:00Z", updatedAt: "2026-03-01T10:05:00Z" },
          { id: "p2", orderId: ORDER, amount: 2000, commission: 60, status: "on_hold", holdReason: "There is an open dispute on this order.", createdAt: "2026-03-02T10:00:00Z", updatedAt: "2026-03-02T10:00:00Z" },
        ],
      });
      await start(page, fake);
      await page.evaluate(() => {
        document.getElementById("app")!.innerHTML = '<section id="lvPayoutList"></section>';
        return (window as unknown as { lvLoadPayoutList: () => unknown }).lvLoadPayoutList();
      });
      const list = page.locator("#lvPayoutList");
      await expect(list).toContainText("Your payouts");
      await expect(list).toContainText("Sent to your bank");
      await expect(list).toContainText("On hold");
      await expect(list).toContainText("open dispute");
    });

    test("the admin's Payments screen shows the money and the action buttons; a non-admin is refused", async ({ page }) => {
      const fake = newFake({
        summary: { status: 200, body: { data: { today: { collected: 100, refunded: 0, paidToVendors: 50, commission: 5 }, week: {}, month: {}, health: { held_payouts: 1, failed_payouts: 0, needsAttention: 1 } } } },
        payouts: [{ id: "p3", order_id: ORDER, business_name: "Dayo Stores", amount: 1500, status: "on_hold", hold_reason: "Open dispute", created_at: "2026-03-01T10:00:00Z" }],
      });
      await start(page, fake);
      const html = await page.evaluate(() => (window as unknown as { renderAdminPayments: () => Promise<string> }).renderAdminPayments());
      expect(html).toContain("Payments");
      expect(html).toContain("Collected");
      expect(html).toContain("Release");
      expect(html).toContain("Paid by hand");

      const refused = newFake({ summary: { status: 403, body: { error: { code: "forbidden", message: "Only admins can see payments." } } } });
      await page.unroute(`${BACKEND}/**`);
      await fakeBackend(page, refused);
      const denied = await page.evaluate(() => (window as unknown as { renderAdminPayments: () => Promise<string> }).renderAdminPayments());
      expect(denied).toContain("Only admins can see payments.");
      expect(denied).not.toContain("Release");
    });
  });
}
