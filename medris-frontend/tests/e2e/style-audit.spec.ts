import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_USER_ROW, BUYER, DIRECTORY_PRODUCTS, DIRECTORY_SECTORS, DIRECTORY_VENDORS, FOLLOWED_ROWS, NOTIFICATION_ROWS, NOTIF_OWNER_TABLES,
  PD_COMMISSION, PD_FULL, PD_RENT, PD_ROWS, PD_SERVICE, PD_SIMPLE, PD_VARIANTS, PD_VENDOR, SHOP, SHOP_PACKAGES, SHOP_PRODUCTS, SHOP_REVIEWS, SHOP_RPCS,
  WISHLIST_PACKAGE_ROWS, WISHLIST_PRODUCT_ROWS,
} from "./fixtures/data";
import { goTo, openApp } from "./support/app";
import { type FixtureOptions } from "./support/network";

// A style audit of every migrated screen. The markup tests prove the HTML is the same and the pixel tests prove the first screenful looks
// the same, but neither sees what is hidden or below the fold, and the old stylesheets have rules that depend on more than the class names
// (for instance on a button's inline `onclick` attribute, or on being a direct child of #app). So here EVERY element of the screen, in both
// versions, is compared on its computed look: colours, borders, shadows, fonts, spacing, display. Hidden things (menus, sheets, panels) are
// included because computed styles exist for them too.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const PROPS = [
  "color", "background-color", "background-image", "border-top-color", "border-top-width", "border-top-style", "border-bottom-color", "border-bottom-width",
  "border-left-width", "border-right-width", "border-radius", "box-shadow", "font-size", "font-weight", "font-family", "font-style", "line-height",
  "letter-spacing", "text-transform", "text-decoration-line", "text-align", "opacity", "display", "visibility", "cursor", "position", "overflow-x",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "gap",
  "flex-direction", "align-items", "justify-content", "object-fit", "z-index",
];

interface Screen {
  name: string;
  view: string;
  params?: Record<string, unknown>;
  signedIn?: boolean;
  extra?: Partial<FixtureOptions>;
  /** Extra steps after the screen has opened (e.g. type a search). */
  after?: (page: Page) => Promise<void>;
}

const PD_TABLES = { products: PD_ROWS, product_variants: PD_VARIANTS };
const SCREENS: Screen[] = [
  { name: "terms", view: "terms" },
  { name: "privacy", view: "privacy" },
  { name: "refundPolicy", view: "refundPolicy" },
  { name: "contactUs", view: "contactUs" },
  { name: "customerFollowing", view: "customerFollowing", signedIn: true, extra: { tables: { vendor_follows: FOLLOWED_ROWS } } },
  { name: "wishlist", view: "wishlist", signedIn: true, extra: { tables: { favorites: WISHLIST_PRODUCT_ROWS, package_favorites: WISHLIST_PACKAGE_ROWS } } },
  { name: "notifications", view: "notifications", signedIn: true, extra: { tables: { notifications: NOTIFICATION_ROWS, ...NOTIF_OWNER_TABLES } } },
  { name: "vendors", view: "vendors", extra: { tables: { vendors: DIRECTORY_VENDORS, products: DIRECTORY_PRODUCTS, sectors: DIRECTORY_SECTORS } } },
  { name: "storefront", view: "storefront", params: { vendorId: SHOP.id }, signedIn: true, extra: { tables: { vendors: [SHOP], products: SHOP_PRODUCTS, reviews: SHOP_REVIEWS, vendor_packages: SHOP_PACKAGES }, rpcs: SHOP_RPCS } },
  { name: "productDetail (variants, rent and buy)", view: "productDetail", params: { productId: PD_FULL.id }, signedIn: true, extra: { tables: PD_TABLES } },
  { name: "productDetail (simple)", view: "productDetail", params: { productId: PD_SIMPLE.id }, signedIn: true, extra: { tables: PD_TABLES } },
  { name: "productDetail (rent only)", view: "productDetail", params: { productId: PD_RENT.id }, signedIn: true, extra: { tables: PD_TABLES } },
  { name: "productDetail (timed service)", view: "productDetail", params: { productId: PD_SERVICE.id }, signedIn: true, extra: { tables: PD_TABLES } },
  { name: "productDetail (commission service)", view: "productDetail", params: { productId: PD_COMMISSION.id }, signedIn: true, extra: { tables: PD_TABLES } },
  { name: "productDetail (owner)", view: "productDetail", params: { productId: PD_SIMPLE.id }, signedIn: true, extra: { tables: { ...PD_TABLES, vendors: [{ ...PD_VENDOR, user_id: BUYER.id }] } } },
  { name: "productDetail (administrator)", view: "productDetail", params: { productId: PD_FULL.id }, signedIn: true, extra: { tables: { ...PD_TABLES, users: [ADMIN_USER_ROW] } } },
  { name: "search (typed)", view: "search", signedIn: true, after: async (page) => { await page.locator("#searchPageInput").fill("jollof"); for (let i = 0; i < 8; i++) await page.clock.runFor(500); } },
];

async function collect(page: Page): Promise<string[]> {
  return page.evaluate((props) => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return [];
    return Array.from(host.querySelectorAll("*")).map((el) => {
      const cs = getComputedStyle(el);
      const klass = (el.getAttribute("class") ?? "").trim().replace(/\s+/g, ".");
      return `${el.tagName.toLowerCase()}.${klass} :: ${props.map((p) => `${p}=${cs.getPropertyValue(p)}`).join(" | ")}`;
    });
  }, PROPS);
}

async function look(page: Page, s: Screen, mode: Mode, theme: "light" | "dark", width: number): Promise<string[]> {
  await page.setViewportSize({ width, height: 900 });
  await openApp(page, { signedIn: s.signedIn ?? false, theme, ...s.extra }, mode === "legacy" ? "/?react=off" : `/?react=${s.view}`);
  await goTo(page, s.view, s.params ?? {});
  for (let i = 0; i < 12; i++) await page.clock.runFor(500);
  await s.after?.(page);
  // Nothing may be mid-animation, and the old CSS's off-screen placeholder size (content-visibility) depends on painting, not on who drew the page.
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.product-card-wrap,.vendor-card,.review-card{content-visibility:visible!important}" });
  for (let i = 0; i < 2; i++) await page.clock.runFor(500);
  return collect(page);
}

for (const s of SCREENS) {
  for (const theme of ["light", "dark"] as const) {
    test(`style audit: ${s.name} (${theme}): every element looks the same in React and legacy`, async ({ browser }) => {
      const seen: Record<Mode, string[]> = { legacy: [], react: [] };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        seen[mode] = await look(page, s, mode, theme, theme === "light" ? 390 : 1280);
        await page.context().close();
      }
      expect(seen.legacy.length, "the screen drew").toBeGreaterThan(3);
      expect(seen.react.length, "same number of elements").toBe(seen.legacy.length);
      const diffs: string[] = [];
      seen.legacy.forEach((l, i) => {
        const r = seen.react[i]!;
        if (l === r) return;
        const [lh, lp] = l.split(" :: ") as [string, string];
        const [, rp] = r.split(" :: ") as [string, string];
        const a = lp.split(" | "), b = rp.split(" | ");
        const changed = a.filter((x, k) => x !== b[k]).map((x, k) => `${x.split("=")[0]}: legacy ${x.split("=")[1]} / react ${b[a.indexOf(x)]?.split("=")[1]}${k < 0 ? "" : ""}`);
        diffs.push(`#${i} <${lh.slice(0, 80)}> ${changed.join("; ")}`);
      });
      expect(diffs.slice(0, 12), `${diffs.length} elements differ`).toEqual([]);
    });
  }
}
