import { expect, test, type Page } from "@playwright/test";
import { ADMIN_USER_ROW, BUYER, FIXED_NOW, PD_COMMISSION, PD_FULL, PD_HOSTILE, PD_PAUSED, PD_RELATED, PD_RENT, PD_ROWS, PD_SERVICE, PD_SIMPLE, PD_VARIANTS, PD_VENDOR } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions } from "./support/network";

// A product's page drawn by React (src/views/product-detail: the frame, the buy / rent / admin / owner cards and the states) against
// the legacy renderProductDetail(). The gallery, variety choice, totals, delivery switch, buying, owner actions, reviews, comments
// and the "You may also like" shelf stay owned by the existing code, so what is compared is the frame AND what the existing code makes
// of it: same markup once everything has loaded, same database requests and writes, same behaviour of every control.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=productDetail" };

type Item = "full" | "related" | "simple" | "rent" | "service" | "commission" | "paused" | "hostile" | "missing";
const IDS: Record<Item, string> = { full: PD_FULL.id, related: PD_RELATED.id, simple: PD_SIMPLE.id, rent: PD_RENT.id, service: PD_SERVICE.id, commission: PD_COMMISSION.id, paused: PD_PAUSED.id, hostile: PD_HOSTILE.id, missing: "00000000-0000-4000-8000-0000000009ff" };
const TABLES = { products: PD_ROWS, product_variants: PD_VARIANTS };

/** What is on screen: the React placeholder's content, or #app's. Handlers, attribute order, style spelling and class spacing are normalised. */
async function screenMarkup(page: Page, ignore: string[] = []): Promise<string> {
  return page.evaluate((ignored) => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return "";
    const copy = host.cloneNode(true) as HTMLElement;
    ignored.forEach((sel) => copy.querySelectorAll(sel).forEach((n) => (n.innerHTML = "…")));
    copy.querySelectorAll("*").forEach((n) => {
      Array.from(n.attributes)
        .filter((a) => a.name.startsWith("on"))
        .forEach((a) => n.removeAttribute(a.name));
    });
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => (n.style.cssText ? n.setAttribute("style", n.style.cssText) : n.removeAttribute("style")));
    copy.querySelectorAll("[class]").forEach((n) => n.setAttribute("class", (n.getAttribute("class") ?? "").trim().replace(/\s+/g, " ")));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    // Random ids the old builders hand out (gallery/lightbox) differ run to run.
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/\b(pkgGallery|lv|gal|vd)-[\w-]{5,}\b/g, "$1-ID").trim();
  }, ignore);
}

/** The first place two pages differ, with a little context (a whole page of markup is too long to read in a failure). */
function firstDifference(a: string, b: string): string {
  if (a === b) return "";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: legacy …${a.slice(Math.max(0, i - 80), i + 160)}…  vs  react …${b.slice(Math.max(0, i - 80), i + 160)}…`;
}

/** Every Supabase read about this product (and the related-equipment shelf). */
function watch(page: Page, id: string) {
  const reads: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/rest/v1/") && r.method() === "GET" && (u.search.includes(id) || u.search.includes("category.name"))) reads.push(`${u.pathname}${u.search}`);
  });
  return reads;
}

async function settle(page: Page, rounds = 12) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

async function open(page: Page, mode: Mode, item: Item, opts: { theme?: "light" | "dark"; signedIn?: boolean; extra?: Partial<FixtureOptions>; params?: Record<string, unknown> } = {}) {
  const reads = watch(page, IDS[item]);
  const session = await openApp(page, { signedIn: opts.signedIn ?? true, theme: opts.theme ?? "light", tables: TABLES, ...opts.extra }, START[mode]);
  await goTo(page, "productDetail", { productId: IDS[item], ...opts.params });
  await settle(page);
  return { ...session, reads };
}

test.describe("Product page: React matches legacy", () => {
  for (const item of ["full", "related", "simple", "rent", "service", "commission", "paused", "hostile", "missing"] as const) {
    test(`${item}: same markup once everything has loaded, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; reads: string[]; rpcs: string[]; writes: string[]; errors: string[] }> = {
        legacy: { markup: "", reads: [], rpcs: [], writes: [], errors: [] },
        react: { markup: "", reads: [], rpcs: [], writes: [], errors: [] },
      };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const { reads, log } = await open(page, mode, item);
        // For the product with a related shelf the old page loses a race and leaves "Loading reviews…" (see the test below): not compared.
        out[mode] = { markup: await screenMarkup(page, item === "related" ? ["[id^=productReviewsBody-]"] : []), reads: [...reads].sort(), rpcs: (item === "related" ? log.rpcs.filter((r) => !["get_product_reviews", "get_reviewable_order_for_product"].includes(r)) : log.rpcs).sort(), writes: [...log.writes].sort(), errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(40);
      expect(firstDifference(out.legacy.markup, out.react.markup)).toBe("");
      expect(out.legacy.reads.length).toBeGreaterThan(0);
      expect(out.react.reads).toEqual(out.legacy.reads);
      expect(out.react.rpcs).toEqual(out.legacy.rpcs);
      expect(out.react.writes).toEqual(out.legacy.writes);
      expect(out.react.errors).toEqual(out.legacy.errors);
      const m = out.react.markup;
      if (item === "full") {
        expect(m).toContain("Save ₦5,000");
        expect(m).toContain("(formerly Ada Foods)");
        expect(m).toContain("Rent this item");
        expect(m).toContain("Place order");
        expect(m).toContain("Regular tray");
        expect(out.react.rpcs).toContain("increment_product_view");
      }
      if (item === "related") expect(m).toContain("You may also need"); // Blood Pressure Machine has a related-equipment shelf
      if (item === "service") expect(m).toContain("Book Now");
      if (item === "paused") expect(m).toContain("This product is not currently available.");
      if (item === "missing") expect(m).toContain("Product not found.");
      expect(m).toContain("You may also like");
    });
  }

  test("the owner card is the same in both versions", async ({ browser }) => {
    const out: Record<Mode, string> = { legacy: "", react: "" };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "simple", { extra: { tables: { ...TABLES, vendors: [{ ...PD_VENDOR, user_id: BUYER.id }] } } });
      out[mode] = await screenMarkup(page);
      await page.context().close();
    }
    expect(out.legacy).toContain("Manage this listing");
    expect(out.react).toBe(out.legacy);
  });

  test("for a listing with a related shelf, React loads the reviews; the old page loses a race and leaves \"Loading reviews…\"", async ({ browser }) => {
    const body: Record<Mode, string> = { legacy: "", react: "" };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "related");
      body[mode] = (await page.locator("[id^=productReviewsBody-]").textContent()) ?? "";
      await page.context().close();
    }
    // Existing behaviour of the old page, not copied: it asks for the reviews before its HTML is on the page when the listing
    // awaits the related shelf first, finds nothing to fill, and the placeholder stays for good.
    expect(body.legacy).toContain("Loading reviews");
    expect(body.react).not.toContain("Loading reviews");
  });

  test("a failed load shows the error message in both versions", async ({ browser }) => {
    const out: Record<Mode, string> = { legacy: "", react: "" };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "full", { extra: { failTables: ["product_variants", "product_engagement_settings"], tables: { ...TABLES, products: [] } } });
      out[mode] = await screenMarkup(page);
      await page.context().close();
    }
    expect(out.react).toBe(out.legacy);
  });

  test("text from the database is escaped (HTML in a product or shop name shows as text, in both versions)", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "hostile");
      await expect(page.locator(".product-detail-title")).toContainText('<i>Fancy</i> & "Quoted" Cake');
      await expect(page.locator(".product-detail-title i")).toHaveCount(0);
      await expect(page.locator(".product-detail-vendor-link")).toContainText('<u>Shop</u> & "Co"');
      await expect(page.locator(".product-detail-vendor-link u")).toHaveCount(0);
      await page.context().close();
    }
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "full");
    await expect(react.locator("#app > #levro-react-root > .product-detail-card")).toHaveCount(1);
    await expect(react.locator("#app > #levro-react-root > .lm-related")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "full");
    await expect(legacy.locator("#app > .product-detail-card")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  for (const mode of MODES) {
    test(`${mode}: gallery, varieties, quantity and the delivery switch do what they did`, async ({ page }) => {
      await open(page, mode, "full");
      await expect(page.locator("#productGalleryCount")).toHaveText("1");
      await page.locator(".product-gallery-thumb").nth(2).click();
      await settle(page, 2);
      await expect(page.locator("#productGalleryCount")).toHaveText("3");
      await expect(page.locator(".product-gallery-thumb").nth(2)).toHaveClass(/active/);

      // Varieties: the second one in the list is "Large tray" (the first, by sort order, is "Regular tray").
      await expect(page.locator("#selectedVariantName")).toHaveText("Regular tray");
      await page.locator(".product-gallery-variety").filter({ hasText: "Large tray" }).click();
      await settle(page, 2);
      await expect(page.locator("#selectedVariantName")).toHaveText("Large tray");
      await expect(page.locator("#selectedVariantPrice")).toHaveText("₦32,000");
      await expect(page.locator("#productPriceHeroBody")).toContainText("₦32,000");
      await expect(page.locator("#selectedProductVariantId")).toHaveValue("00000000-0000-4000-8000-0000000009c2");

      await page.locator("#buyQty").fill("3");
      await settle(page, 2);
      await expect(page.locator("#serviceTotalPreview")).toContainText("₦96,000");

      await page.locator("#rentStart").fill("2026-03-05");
      await page.locator("#rentEnd").fill("2026-03-08");
      await page.locator("#rentQty").fill("2");
      await settle(page, 2);
      await expect(page.locator("#rentTotalPreview")).toContainText("Total: ₦");
    });

    test(`${mode}: the delivery switch shows and hides the address and the price breakdown`, async ({ page }) => {
      await open(page, mode, "simple");
      await expect(page.locator("#buyDeliveryFields")).not.toHaveClass(/hidden/);
      await expect(page.locator("#buyPriceBreakdown")).toContainText("You'll pay");
      await page.locator('input[name="buyDeliveryMethod"][value="pickup"]').check();
      await settle(page, 2);
      await expect(page.locator("#buyDeliveryFields")).toHaveClass(/hidden/);
      await page.locator('input[name="buyDeliveryMethod"][value="delivery"]').check();
      await settle(page, 2);
      await expect(page.locator("#buyDeliveryFields")).not.toHaveClass(/hidden/);
    });

    test(`${mode}: a distance-priced shop asks for the buyer's location, and is switched to pickup when it is refused`, async ({ page }) => {
      await open(page, mode, "full");
      await expect(page.locator('input[name="buyDeliveryMethod"][value="pickup"]')).toBeChecked();
      await expect(page.locator("#buyDeliveryFields")).toHaveClass(/hidden/);
    });

    test(`${mode}: save, share, comments, "About" and Place order without an address`, async ({ page }) => {
      const { log } = await open(page, mode, "simple");
      const before = log.writes.length;
      await page.locator(".product-detail-top-actions .fav-btn").click();
      await settle(page, 3);
      await expect(page.locator(".product-detail-top-actions .fav-btn")).toHaveClass(/active/);
      expect(log.writes.length).toBeGreaterThan(before);

      await page.locator('.product-detail-top-actions button[aria-label="Share product"]').click();
      await settle(page, 2);
      await expect(page.locator("#storefrontShareModal")).not.toHaveClass(/hidden/);
      await page.locator("#storefrontShareModal").getByRole("button", { name: /close/i }).first().click().catch(() => undefined);

      await page.locator(".pd-about summary").click();
      await expect(page.locator(".pd-about")).toHaveAttribute("open", "");

      await page.locator("#buyAddress").fill("");
      await page.getByRole("button", { name: "Place order" }).click();
      await settle(page, 3);
      await expect(page.locator("#buyError")).not.toHaveClass(/hidden/);

      await page.locator('.product-detail-top-actions button[aria-label="Open comments"]').click();
      await settle(page, 3);
      await expect(page.locator("#productCommentsPanel")).toBeAttached();
    });

    test(`${mode}: a long description has a Read more toggle`, async ({ page }) => {
      await open(page, mode, "full");
      await page.locator(".pd-about summary").click();
      await page.locator(".read-more-toggle").first().click();
      await expect(page.locator(".read-more-toggle").first()).toHaveText("Read less");
      await page.locator(".read-more-toggle").first().click();
      await expect(page.locator(".read-more-toggle").first()).toHaveText("Read more");
    });

    test(`${mode}: the vendor link opens the storefront and Back returns to the product`, async ({ page }) => {
      await open(page, mode, "simple");
      await page.locator(".product-detail-vendor-link").click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
      await page.goBack();
      await settle(page, 10);
      await expect(page.locator("body")).toHaveAttribute("data-view", "productDetail");
      await expect(page.locator(".product-detail-title")).toContainText("Chin Chin Tub");
    });

    test(`${mode}: the owner sees the owner card and no buy or rent card`, async ({ page }) => {
      // (A product without a related-equipment shelf: for those the old page wins its race to fill the numbers in.)
      const { log } = await open(page, mode, "simple", {
        extra: { tables: { ...TABLES, vendors: [{ ...PD_VENDOR, user_id: BUYER.id }] }, rpcs: { get_vendor_stats: [{ favorites_count: 12, revenue: 3400, sales_count: 5 }] } },
      });
      await expect(page.locator(".owner-listing-management")).toHaveCount(1);
      await expect(page.locator("#buyDeliveryFields, #rentDeliveryFields")).toHaveCount(0);
      expect(log.rpcs).toContain("get_vendor_stats");
      // Existing behaviour, kept: the old page asks for the numbers but looks for their slots inside the product card, while the
      // owner card is the card after it, so the numbers stay at 0 in both versions (a bug in the old page, to fix separately).
      await expect(page.locator("[data-owner-stat=saved]")).toHaveText("0");
      await expect(page.locator("[data-owner-stat=revenue]")).toHaveText("₦0");
    });

    test(`${mode}: an administrator sees the notice instead of the buy and rent cards`, async ({ page }) => {
      await open(page, mode, "full", { extra: { tables: { ...TABLES, users: [ADMIN_USER_ROW] } } });
      await expect(page.locator("#app")).toContainText("Admin accounts can't make purchases on Levromart.");
      await expect(page.locator("#buyQty, #rentStart")).toHaveCount(0);
    });

    test(`${mode}: a deep link opens the product; nothing is written beyond the view counter`, async ({ page }) => {
      const log = await installFixtures(page, { signedIn: true, theme: "light", tables: TABLES });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&product=${PD_FULL.id}`);
      await settle(page, 16);
      await expect(page.locator("body")).toHaveAttribute("data-view", "productDetail");
      await expect(page.locator(".product-detail-title")).toContainText("Jollof Party Pack");
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("a guest sees the same page", async ({ browser }) => {
    const out: Record<Mode, { markup: string; writes: string[]; rpcs: string[] }> = { legacy: { markup: "", writes: [], rpcs: [] }, react: { markup: "", writes: [], rpcs: [] } };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const { log } = await open(page, mode, "full", { signedIn: false });
      out[mode] = { markup: await screenMarkup(page), writes: log.writes, rpcs: [...log.rpcs].sort() };
      await page.context().close();
    }
    expect(out.react).toEqual(out.legacy);
  });

  test("opening the comments and the reviews from a link (openComments / scrollToReviews) does the same", async ({ browser }) => {
    const out: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "full", { params: { scrollToReviews: true } });
      out[mode] = [String(await page.evaluate(() => Math.round(window.scrollY) > 0))];
      await page.context().close();
    }
    expect(out.react).toEqual(out.legacy);
  });

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "full");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    await settle(page, 16);
    await expect(page.locator(".product-detail-title")).toContainText("Jollof Party Pack");
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/ProductDetailPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
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
    await expect(page.locator(".product-detail-card")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "full", { theme: "dark" });
      colours[mode] = await page.evaluate(() =>
        [".product-detail-card", ".product-detail-title", ".product-gallery-thumb.active", ".product-detail-vendor-link", ".pd-about", ".product-price-hero", ".pph-now", ".product-detail-stats", "#buyQty", ".delivery-method-row", ".product-payment-plan-notice", ".btn", ".product-reviews-card", ".product-comments-card"].map((sel) => {
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
        // The old CSS gives every card `content-visibility:auto` (a 280px placeholder while off screen): which height an
        // off-screen card has depends on whether it has been painted yet, not on who drew it. Measure with it off.
        await page.addStyleTag({ content: ".product-card-wrap,.vendor-card,.review-card{content-visibility:visible!important}" });
        await settle(page, 2);
        boxes[mode] = await page.evaluate(() =>
          [".product-detail-card", ".product-detail-top-actions", ".product-detail-title", ".product-detail-media", ".product-gallery-thumbs", "#productGalleryVarieties", ".product-detail-info", ".product-price-hero", ".product-detail-stats", "#rentStart", "#buyQty", ".pd-buy-actions", ".product-reviews-card", ".product-comments-card", ".hscroll"].map((sel) => {
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
    for (const item of ["full", "simple", "rent"] as const) {
      for (const mode of MODES) {
        test.describe(`product ${item} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, item, { theme });
            await expect(page.locator(".product-detail-card")).toHaveCount(1);
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`product-${item}-${theme}-${vp.label}.png`, { fullPage: false });
          });
        });
      }
    }
  }
}
