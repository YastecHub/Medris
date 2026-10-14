import { expect, test } from "@playwright/test";
import { PRODUCTS, VENDOR } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp, type Theme } from "./support/app";

// Reference screenshots of the screens planned for the first migration wave
// (docs/REACT_MIGRATION.md, section 4) as the LEGACY app draws them today. They must pass
// before any screen is converted, and keep passing while every React switch is OFF.
// Refresh them deliberately with: npm run test:e2e -w medris-frontend -- --update-snapshots

interface Screen {
  name: string;
  view: string;
  params?: Record<string, unknown>;
  /** Text that must be visible once the screen has drawn. */
  expectText: RegExp;
}

const GUEST_SCREENS: Screen[] = [
  { name: "home", view: "home", expectText: /Levromart|Fixture|Jollof/i },
  { name: "search", view: "search", expectText: /search/i },
  { name: "vendors", view: "vendors", expectText: /vendors?/i },
  { name: "terms", view: "terms", expectText: /terms/i },
  { name: "privacy", view: "privacy", expectText: /privacy/i },
  { name: "refund-policy", view: "refundPolicy", expectText: /refund/i },
  { name: "contact-us", view: "contactUs", expectText: /contact/i },
  { name: "leaderboard", view: "leaderboard", expectText: /leaderboard|rank/i },
  { name: "storefront", view: "storefront", params: { vendorId: VENDOR.id }, expectText: new RegExp(VENDOR.business_name, "i") },
  { name: "product-detail", view: "productDetail", params: { productId: PRODUCTS[0].id }, expectText: new RegExp(PRODUCTS[0].name, "i") },
];

const BUYER_SCREENS: Screen[] = [
  { name: "home", view: "home", expectText: /Levromart|Fixture|Jollof/i },
  { name: "notifications", view: "notifications", expectText: /notifications?/i },
  { name: "wishlist", view: "wishlist", expectText: /wishlist|saved|favou?rites?/i },
  { name: "customer-following", view: "customerFollowing", expectText: /following|vendors?/i },
  { name: "product-detail", view: "productDetail", params: { productId: PRODUCTS[0].id }, expectText: new RegExp(PRODUCTS[0].name, "i") },
];

const VIEWPORTS = [
  { label: "390", width: 390, height: 844 },
  { label: "1280", width: 1280, height: 800 },
];
const THEMES: Theme[] = ["light", "dark"];

function suite(who: "guest" | "buyer", screens: Screen[]) {
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      test.describe(`${who} / ${theme} / ${vp.label}px`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const s of screens) {
          test(s.name, async ({ page }) => {
            const { log } = await openApp(page, { signedIn: who === "buyer", theme });
            await goTo(page, s.view, s.params);

            // The screen drew real content, in the right theme, and showed no error page.
            await expect(page.locator("#app")).toContainText(s.expectText);
            // Light mode has no data-theme attribute; dark mode sets data-theme="dark".
            if (theme === "dark") await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
            else await expect(page.locator("html")).not.toHaveAttribute("data-theme", /dark|black/);
            await expect(page.locator("#app")).not.toContainText(/something went wrong|failed to load/i);

            // No welcome screen or terms gate is covering the page (they would make the picture meaningless).
            await expect(page.locator("#lvOnb")).toBeHidden();
            await expect(page.locator("#levroLegalGate")).toBeHidden();
            await expect(page.locator("#loginModal")).toBeHidden();

            // Nothing left the machine and nothing was written: these are read-only screens.
            expect(log.blocked, "requests to unknown hosts").toEqual([]);
            // (A signed-in start-up upserts the user's own row; that is the only write allowed.)
            expect(log.writes.filter((w) => w !== "POST users"), "writes sent to Supabase").toEqual([]);

            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`${who}-${theme}-${vp.label}-${s.name}.png`);
          });
        }
      });
    }
  }
}

suite("guest", GUEST_SCREENS);
suite("buyer", BUYER_SCREENS);

// Migrated screens (docs/REACT_MIGRATION.md): each one drawn by React must look the same as its legacy
// picture above. It is compared with the SAME reference file as the legacy test, so a pixel difference
// (beyond the tolerance) fails here. Text/structure/interaction parity is in pilot-<view>.spec.ts.
const MIGRATED: Array<{ view: string; name: string; heading: string; root?: string }> = [
  { view: "terms", name: "terms", heading: "Terms of Service" },
  { view: "privacy", name: "privacy", heading: "Privacy Policy" },
  { view: "refundPolicy", name: "refund-policy", heading: "Refund & Cancellation Policy" },
  { view: "contactUs", name: "contact-us", heading: "Contact us", root: ".contact-us-page" },
];
for (const m of MIGRATED) {
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      test.describe(`${m.name} drawn by React / guest / ${theme} / ${vp.label}px`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test(`looks like the legacy ${m.heading} page`, async ({ page }) => {
          const { log } = await openApp(page, { signedIn: false, theme }, `/?react=${m.view}`);
          await goTo(page, m.view);
          await expect(page.locator(`#app #levro-react-root ${m.root ?? ".legal-page"}`)).toContainText(m.heading);
          expect(log.blocked, "requests to unknown hosts").toEqual([]);
          expect(log.writes, "writes sent to Supabase").toEqual([]);
          await freezeForScreenshot(page);
          await expect(page).toHaveScreenshot(`guest-${theme}-${vp.label}-${m.name}.png`);
        });
      });
    }
  }
}
