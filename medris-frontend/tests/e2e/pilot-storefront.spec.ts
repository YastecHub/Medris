import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW, SHOP, SHOP_PACKAGES, SHOP_PRODUCTS, SHOP_REVIEWS, SHOP_RPCS, STOREFRONT_OWNER_ID } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions } from "./support/network";

// A vendor's storefront drawn by React (src/views/storefront: the frame and the vendor's header) against the legacy
// renderStorefront(). The grid, chips, catalogue tabs, follow button, stats, packages and reviews stay owned by the existing
// code, so what is compared is the frame AND what the existing code makes of it: same markup once everything has loaded, same
// database requests and writes, same behaviour of every control, same address bar, same page title.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=storefront" };

type Data = "full" | "bare" | "no-products" | "paused" | "missing";
const FULL: Partial<FixtureOptions> = {
  tables: { vendors: [SHOP], products: SHOP_PRODUCTS, reviews: SHOP_REVIEWS, vendor_packages: SHOP_PACKAGES },
  rpcs: SHOP_RPCS,
};
const DATA: Record<Data, Partial<FixtureOptions>> = {
  full: FULL,
  // A shop with nothing else filled in: no cover, bio, years, hours, CAC, sector, previous name, reviews or packages.
  bare: {
    tables: { vendors: [{ ...SHOP, cover_url: null, bio: null, cac_number: null, opening_hours: null, sector: null, previous_business_name: null, logo_url: null, address: null, city: null }], products: SHOP_PRODUCTS.slice(0, 2), reviews: [], vendor_packages: [] },
    rpcs: { get_vendor_stats: [{ review_count: 0, avg_rating: 0 }], get_vendor_follow_state: [{ following: true, follower_count: 1 }] },
  },
  "no-products": { tables: { vendors: [SHOP], products: [], reviews: [], vendor_packages: [] }, rpcs: SHOP_RPCS },
  paused: { tables: { vendors: [{ ...SHOP, is_active: false }], products: SHOP_PRODUCTS } },
  missing: { tables: { vendors: [], products: [] } },
};

/** What is on screen: the React placeholder's content, or #app's. Handlers, attribute order, style spelling and class spacing are normalised. */
async function screenMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return "";
    const copy = host.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("*").forEach((n) => {
      Array.from(n.attributes)
        .filter((a) => a.name.startsWith("on"))
        .forEach((a) => n.removeAttribute(a.name));
    });
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => (n.style.cssText ? n.setAttribute("style", n.style.cssText) : n.removeAttribute("style")));
    copy.querySelectorAll<HTMLElement>("[class]").forEach((n) => n.setAttribute("class", n.className.trim().replace(/\s+/g, " ")));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    // Random ids the old card builders hand out (gallery/lightbox) differ run to run.
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/\b(pkgGallery|lv|gal|vd)-[\w-]{5,}\b/g, "$1-ID").trim();
  });
}

/** Every Supabase read, RPC name and write the page made, as sets (the order of parallel requests is not significant). */
function watch(page: Page) {
  const reads: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    // Only what concerns this shop (the app also polls other things on timers, e.g. incoming calls, with times in the query).
    if (u.pathname.startsWith("/rest/v1/") && r.method() === "GET" && u.search.includes(SHOP.id)) reads.push(`${u.pathname}${u.search}`);
  });
  return reads;
}

async function settle(page: Page, rounds = 12) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

/**
 * The app's own CSS gives every .review-card `content-visibility:auto` with a 280px placeholder, so which height an
 * off-screen card has at a given moment depends on whether the browser happens to have painted it yet (it flips between
 * runs and between legacy and React). That is not something either version decides, so layout is measured with it off.
 */
async function measurableLayout(page: Page) {
  await page.addStyleTag({ content: ".review-card{content-visibility:visible!important}" });
  await settle(page, 2);
}

async function open(page: Page, mode: Mode, data: Data, opts: { theme?: "light" | "dark"; signedIn?: boolean; extra?: Partial<FixtureOptions>; vendorId?: string } = {}) {
  const reads = watch(page);
  const session = await openApp(page, { signedIn: opts.signedIn ?? true, theme: opts.theme ?? "light", ...DATA[data], ...opts.extra }, START[mode]);
  await goTo(page, "storefront", { vendorId: opts.vendorId ?? SHOP.id });
  await settle(page);
  return { ...session, reads };
}

const gridNames = (page: Page) => page.locator("#storefrontGrid .product-card, #storefrontGrid .product-card-wrap").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)));

test.describe("Storefront: React matches legacy", () => {
  for (const data of ["full", "bare", "no-products", "paused", "missing"] as const) {
    test(`${data}: same markup once everything has loaded, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; reads: string[]; rpcs: string[]; writes: string[]; title: string; errors: string[] }> = {
        legacy: { markup: "", reads: [], rpcs: [], writes: [], title: "", errors: [] },
        react: { markup: "", reads: [], rpcs: [], writes: [], title: "", errors: [] },
      };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const { reads, log } = await open(page, mode, data);
        out[mode] = { markup: await screenMarkup(page), reads: [...reads].sort(), rpcs: [...log.rpcs].sort(), writes: [...log.writes].sort(), title: await page.title(), errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(40);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.legacy.reads.some((r) => r.includes("/rest/v1/vendors"))).toBe(true);
      expect(out.react.reads).toEqual(out.legacy.reads);
      expect(out.react.rpcs).toEqual(out.legacy.rpcs);
      expect(out.react.writes).toEqual(out.legacy.writes);
      expect(out.react.title).toBe(out.legacy.title);
      expect(out.react.errors).toEqual(out.legacy.errors);
      const m = out.react.markup;
      if (data === "full") {
        expect(m).toContain("(formerly Ada Foods)");
        expect(m).toContain("CAC verified");
        expect(m).toContain("12 Fixture Road, Lagos");
        expect(m).toContain("1,234");
        expect(m).toContain("Office Lunch Bundle");
        expect(out.react.title).toBe("Ada's Kitchen | Levromart");
        expect(out.react.rpcs).toContain("increment_vendor_profile_view");
      }
      if (data === "paused") expect(m).toContain("currently paused");
      if (data === "missing") expect(m).toContain("Storefront not found.");
      if (data === "no-products") expect(m).toContain("No products or services listed yet.");
    });
  }

  test("an unexpected failure shows the retry card, in both versions, and Try again asks again", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const reads = watch(page);
      await installFixtures(page, { signedIn: true, theme: "light", ...FULL });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(START[mode]);
      await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
      await settle(page, 6);
      // supabase-js reports a dropped connection as an error value (the page then says "not found"); the retry card is for a
      // query that throws. Make the first lookup throw, like the old code's catch expects.
      // (`sb` is a top-level const of the old scripts: a global, but not a property of window.)
      await page.evaluate(`(() => {
        const original = sb.from.bind(sb);
        let thrown = false;
        sb.from = (table) => {
          if (table === "vendors" && !thrown) { thrown = true; throw new Error("fixture: lookup failed"); }
          return original(table);
        };
      })()`);
      await page.evaluate((id) => (window as unknown as { navigate: (v: string, p: unknown) => void }).navigate("storefront", { vendorId: id }), SHOP.id);
      await settle(page, 12);
      await expect(page.locator("#app")).toContainText("Couldn't load this storefront");
      const before = reads.length;
      await page.getByRole("button", { name: "Try again" }).click();
      await settle(page, 14);
      await expect(page.locator(".storefront-profile-name")).toContainText("Ada's Kitchen");
      expect(reads.length).toBeGreaterThan(before);
      await page.context().close();
    }
  });

  test("text from the database is escaped (HTML in a product name or review shows as text, in both versions)", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "full");
      await expect(page.locator(".storefront-product-mini strong").filter({ hasText: "Fancy" })).toHaveText('<i>Fancy</i> & "Quoted" Cake');
      await expect(page.locator(".storefront-product-mini strong i")).toHaveCount(0);
      await expect(page.locator("#vendorReviews")).toContainText("Lovely food <b>fast</b>");
      await expect(page.locator("#vendorReviews b")).toHaveCount(0);
      await page.context().close();
    }
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "full");
    await expect(react.locator("#app > #levro-react-root > .storefront-profile")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "full");
    await expect(legacy.locator("#app > .storefront-profile")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  for (const mode of MODES) {
    test(`${mode}: catalogue tabs, search and category chips do what they did`, async ({ page }) => {
      await open(page, mode, "full");
      await expect(page.locator("#storefrontProductsCount")).toHaveText("(6)");
      await expect(page.locator("#storefrontServicesCount")).toHaveText("(1)");
      await expect(page.locator("#storefrontPackagesCount")).toHaveText("(1)");
      const products = await gridNames(page);
      expect(products.length).toBe(6);
      expect(page.locator("#storefrontCategoryChips .storefront-category-chip")).toHaveCount(4); // All, Meals, Snacks, Rentals (the item without a category adds none)

      await page.locator("#storefrontCategoryChips").getByRole("button", { name: "Snacks" }).click();
      await settle(page, 2);
      expect((await gridNames(page)).length).toBe(2);
      await page.locator("#storefrontCategoryChips").getByRole("button", { name: "All" }).click();
      await page.locator("#storefrontSearch").fill("tent");
      await settle(page, 2);
      expect((await gridNames(page)).length).toBe(1);
      await page.locator("#storefrontSearch").fill("zzzz");
      await settle(page, 2);
      await expect(page.locator("#storefrontGrid")).toContainText("No products found");
      await page.locator("#storefrontSearch").fill("");

      await page.locator("#storefrontServicesTab").click();
      await settle(page, 2);
      await expect(page.locator("#storefrontServicesTab")).toHaveClass(/active/);
      expect((await gridNames(page)).length).toBe(1);
      await page.locator("#storefrontPackagesTab").click();
      await settle(page, 2);
      await expect(page.locator("#storefrontPackagesSection")).not.toHaveClass(/storefront-tab-panel-hidden/);
      await expect(page.locator("#storefrontProductsShell")).toHaveClass(/storefront-tab-panel-hidden/);
      await expect(page.locator("#storefrontPackagesGrid")).toContainText("Office Lunch Bundle");
      await page.locator("#storefrontProductsTab").click();
      await settle(page, 2);
      expect((await gridNames(page)).length).toBe(6);
    });

    test(`${mode}: the "Store options" sheet opens and closes, and Share opens the share box`, async ({ page }) => {
      await open(page, mode, "full");
      await page.locator(".storefront-banner-more").click();
      await settle(page, 2);
      await expect(page.locator("#storefrontMoreSheetRoot")).toHaveClass(/open|is-open|show/);
      await expect(page.locator("#storefrontMoreSheet")).toContainText("CAC verified");
      await page.locator("#storefrontMoreSheet .levro-sheet-close").click();
      await settle(page, 2);
      await expect(page.locator("#storefrontMoreSheetRoot")).not.toHaveClass(/open|is-open|show/);
      await page.locator(".storefront-banner-more").click();
      await page.locator("#storefrontMoreSheet").getByRole("button", { name: "Share storefront" }).click();
      await settle(page, 2);
      await expect(page.locator("#storefrontShareModal")).not.toHaveClass(/hidden/);
    });

    test(`${mode}: the follow button, the bio toggle and the "Latest from" cards work`, async ({ page }) => {
      const { log } = await open(page, mode, "full");
      await expect(page.locator("#storefrontFollowWrap .follow-btn")).toHaveAttribute("aria-label", /Follow Ada/);
      const before = [...log.rpcs, ...log.writes];
      await page.locator("#storefrontFollowWrap .follow-btn").click();
      await settle(page, 4);
      const added = [...log.rpcs, ...log.writes].filter((x, i) => x !== before[i]).length;
      expect(added).toBeGreaterThanOrEqual(0); // the exact writes are compared between versions in the next test

      await page.locator(".storefront-bio-toggle").click();
      await expect(page.locator("#storefrontBioWrap")).toHaveClass(/expanded|open|show/);

      await page.locator(".storefront-product-mini").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "productDetail");
      await page.goBack();
      await settle(page, 10);
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
      await expect(page.locator(".storefront-profile-name")).toContainText("Ada's Kitchen");
    });

    test(`${mode}: the owner sees the cover editor and a Messages button, and no view is counted`, async ({ page }) => {
      const { log } = await open(page, mode, "full", { extra: { tables: { ...FULL.tables, vendors: [{ ...SHOP, user_id: "00000000-0000-4000-8000-0000000000b1" }] } } });
      await expect(page.locator(".storefront-profile")).toHaveAttribute("data-own-storefront", "1");
      await expect(page.locator(".storefront-cover-edit")).toHaveCount(1);
      await expect(page.locator(".storefront-own-message-icon")).toHaveCount(1);
      await expect(page.locator("#storefrontFollowWrap")).toHaveCount(0);
      expect(log.rpcs).not.toContain("increment_vendor_profile_view");
      expect(STOREFRONT_OWNER_ID).toBeTruthy();
    });
  }

  test("following and unfollowing sends the same requests in both versions", async ({ browser }) => {
    const out: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const { log } = await open(page, mode, "full");
      const base = log.rpcs.length + log.writes.length;
      await page.locator("#storefrontFollowWrap .follow-btn").click();
      await settle(page, 6);
      out[mode] = [...log.rpcs, ...log.writes].slice(base);
      await page.context().close();
    }
    expect(out.react).toEqual(out.legacy);
  });

  test("a guest sees the same page (nothing written beyond the view counter)", async ({ browser }) => {
    const out: Record<Mode, { markup: string; writes: string[]; rpcs: string[] }> = { legacy: { markup: "", writes: [], rpcs: [] }, react: { markup: "", writes: [], rpcs: [] } };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const { log } = await open(page, mode, "full", { signedIn: false });
      out[mode] = { markup: await screenMarkup(page), writes: log.writes, rpcs: [...log.rpcs].sort() };
      await page.context().close();
    }
    expect(out.react).toEqual(out.legacy);
    expect(out.react.writes).toEqual([]);
  });

  for (const mode of MODES) {
    test(`${mode}: the address bar, the page title and Back`, async ({ page }) => {
      await open(page, mode, "full");
      expect(new URL(page.url()).searchParams.get("storefront")).toBe(SHOP.id);
      await expect(page).toHaveTitle("Ada's Kitchen | Levromart");
      await goTo(page, "terms");
      await expect(page).toHaveTitle("Levromart"); // the old code puts the title back when you leave a storefront
      await page.goBack();
      await settle(page, 10);
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
    });

    test(`${mode}: a deep link opens the storefront`, async ({ page }) => {
      const log = await installFixtures(page, { signedIn: true, theme: "light", ...FULL });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&storefront=${SHOP.id}`);
      await settle(page, 16);
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
      await expect(page.locator(".storefront-profile-name")).toContainText("Ada's Kitchen");
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "full");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    await settle(page, 16);
    await expect(page.locator(".storefront-profile-name")).toContainText("Ada's Kitchen");
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/StorefrontPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
      await open(page, mode, "full");
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("leaving the React page removes it completely", async ({ page }) => {
    await open(page, "react", "full");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator(".storefront-profile")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "full", { theme: "dark" });
      colours[mode] = await page.evaluate(() =>
        [".storefront-cover", ".storefront-profile-name", ".storefront-bio", ".storefront-meta", ".storefront-stats", ".storefront-avatar", ".storefront-product-mini", ".storefront-catalog-tab.active", ".storefront-search-wrap input", ".storefront-category-chip", ".storefront-reviews"].map((sel) => {
          const el = document.querySelector("#app " + sel);
          if (!el) return sel + ": missing";
          const cs = getComputedStyle(el);
          return `${sel}: ${cs.color} | ${cs.backgroundColor} | ${cs.fontSize} | ${cs.fontWeight} | ${cs.borderTopColor} | ${cs.borderRadius} | ${cs.marginBottom}`;
        }),
      );
      await page.context().close();
    }
    expect(colours.react).toEqual(colours.legacy);
  });

  for (const width of [390, 1280]) {
    test(`${width}px: the boxes are exactly where legacy puts them`, async ({ browser }) => {
      const boxes: Record<string, unknown[]> = {};
      for (const mode of MODES) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await ctx.newPage();
        await open(page, mode, "full");
        await measurableLayout(page);
        boxes[mode] = await page.evaluate(() =>
          [".storefront-profile", ".storefront-cover", ".storefront-avatar", ".storefront-profile-name", ".storefront-bio", ".storefront-meta", ".storefront-stats", ".storefront-featured", ".storefront-product-mini", ".storefront-catalog-tabs", ".storefront-products-toolbar", "#storefrontGrid", "#vendorReviews"].map((sel) => {
            const r = document.querySelector("#app " + sel)?.getBoundingClientRect();
            return r ? [r.x, r.y + window.scrollY, r.width, r.height].map((n) => Math.round(n * 10) / 10) : null;
          }),
        );
        await ctx.close();
      }
      const flat = (b: unknown[]) => b.flat() as Array<number | null>;
      const [a, b] = [flat(boxes.legacy!), flat(boxes.react!)];
      expect(b.length).toBe(a.length);
      a.forEach((v, i) => {
        if (v === null) expect(b[i]).toBeNull();
        else expect(Math.abs((b[i] as number) - v), `box value #${i}: legacy ${v}, react ${b[i]}`).toBeLessThan(0.5);
      });
    });
  }
});

// Pixel parity: legacy and React are each compared with the SAME reference picture (made from legacy).
for (const theme of ["light", "dark"] as const) {
  for (const vp of [{ label: "390", width: 390, height: 844 }, { label: "1280", width: 1280, height: 800 }]) {
    for (const data of ["full", "bare"] as const) {
      for (const mode of MODES) {
        test.describe(`storefront ${data} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, data, { theme });
            await expect(page.locator(".storefront-profile")).toHaveCount(1);
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`storefront-${data}-${theme}-${vp.label}.png`, { fullPage: false });
          });
        });
      }
    }
  }
}
