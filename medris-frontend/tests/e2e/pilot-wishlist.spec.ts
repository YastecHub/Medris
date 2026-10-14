import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW, WISHLIST_PACKAGE_ROWS, WISHLIST_PRODUCT_ROWS } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions, type NetworkLog } from "./support/network";

// "Your Wishlist" drawn by React (src/views/wishlist, with the shared ProductCard / PackageCard in src/components)
// against the legacy renderWishlist(). Both versions are driven with the same fixtures and the same steps and must
// come out the same: what the database is asked, what is shown, what every button on a card does.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=wishlist" };

type Data = "populated" | "empty";
const DATA: Record<Data, Partial<FixtureOptions>> = {
  populated: { tables: { favorites: WISHLIST_PRODUCT_ROWS, package_favorites: WISHLIST_PACKAGE_ROWS } },
  empty: { tables: { favorites: [], package_favorites: [] } },
};

/** What is on screen (React placeholder content, or #app's), with handlers, attribute order, style spelling and random ids normalised. */
async function screenMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return "";
    const copy = host.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[onclick],[onkeydown],[onerror]").forEach((n) => ["onclick", "onkeydown", "onerror"].forEach((a) => n.removeAttribute(a)));
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => n.setAttribute("style", n.style.cssText));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value.replace(/(pkgGallery-[0-9a-f-]+)-[a-z0-9]{5}$/, "$1-RANDOM")] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

/** Every Supabase REST request the page made (unique paths with queries), to compare what the database is asked. */
function watchRequests(page: Page): Set<string> {
  const seen = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    // (Times in a query, such as "created_at=gt.<now minus a minute>", are replaced so equal requests compare equal.)
    if (u.hostname === "e2e-fixture.supabase.co" && u.pathname.startsWith("/rest/v1/")) seen.add(`${r.method()} ${u.pathname}${u.search}`.replace(/\d{4}-\d{2}-\d{2}T[\d%A:.]+Z/g, "<time>"));
  });
  return seen;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(`console: ${m.text()}`));
  return errors;
}

async function open(page: Page, mode: Mode, data: Data, theme: "light" | "dark" = "light") {
  const requests = watchRequests(page);
  const errors = watchErrors(page);
  const session = await openApp(page, { signedIn: true, theme, ...DATA[data] }, START[mode]);
  await page.route(/broken\.example\.test/, (route) => route.abort());
  await goTo(page, "wishlist");
  for (let i = 0; i < 8; i++) await page.clock.runFor(500);
  return { ...session, requests, errors };
}

const sorted = (s: Set<string>) => Array.from(s).sort();

test.describe("Wishlist: React matches legacy", () => {
  for (const data of ["populated", "empty"] as const) {
    test(`${data}: same markup and text, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; requests: string[]; errors: string[] }> = { legacy: { markup: "", requests: [], errors: [] }, react: { markup: "", requests: [], errors: [] } };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const { requests, errors } = await open(page, mode, data);
        out[mode] = { markup: await screenMarkup(page), requests: sorted(requests), errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(100);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.react.requests).toEqual(out.legacy.requests);
      expect(out.react.errors, "errors in the React version").toEqual([]);
      if (data === "populated") {
        const m = out.react.markup;
        for (const shown of ["Jollof Party Pack", "Blender 500W", "Camping Tent", "Logo Design", "Student Starter Bundle", "Mystery Box", "Party Pack"]) expect(m).toContain(shown);
        for (const hidden of ["Paused Listing", "Unverified Seller Item", "Hidden Bundle"]) expect(m).not.toContain(hidden);
        expect(m).toContain("product-old-price"); // the discounted item
        expect(m).toContain("Negotiable"); // the commission service
        expect(m).toContain("Name your price");
        expect(m).toContain("/km"); // the distance-priced item shows the rate
        expect(m).toContain("Free delivery"); // package without a fee
        expect(m).toContain("2× Notebook, 1× Pen &lt;set&gt;");
      } else {
        expect(out.react.markup).toContain("Nothing saved yet.");
      }
    });
  }

  test("text from the database is escaped (HTML in a product or item name shows as text, in both versions)", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      await expect(page.locator(".pc-name").filter({ hasText: "Fancy" })).toHaveText('<i>Fancy</i> & "Quoted" Bag');
      await expect(page.locator(".pc-name i")).toHaveCount(0);
      await expect(page.locator(".package-card-includes").first()).toContainText("Pen <set>");
      await page.context().close();
    }
  });

  test("a hostile product name (quotes, HTML) is plain text and cannot add attributes to the card, in both versions", async ({ browser }) => {
    const evil = 'x" onmouseover="window.__pwned=1" data-x="<img src=x onerror=alert(1)>';
    const rows = [{ product_id: "00000000-0000-4000-8000-000000000499", product: { ...WISHLIST_PRODUCT_ROWS[1]!.product, id: "00000000-0000-4000-8000-000000000499", name: evil } }];
    const markups: string[] = [];
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const errors = watchErrors(page);
      await openApp(page, { signedIn: true, theme: "light", tables: { favorites: rows, package_favorites: [] } }, START[mode]);
      await goTo(page, "wishlist");
      for (let i = 0; i < 8; i++) await page.clock.runFor(500);
      await expect(page.locator(".pc-name")).toHaveText(evil);
      const card = page.locator(".product-card-wrap");
      expect(await card.evaluate((el) => Array.from(el.querySelectorAll("*")).flatMap((n) => Array.from(n.attributes).map((a) => a.name)).filter((n) => (n.startsWith("on") && n !== "onerror" && n !== "onclick") || n === "data-x"))).toEqual([]);
      await expect(page.locator(".card-cart-btn")).toHaveAttribute("aria-label", `Add ${evil} to cart`);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      expect(errors).toEqual([]);
      markups.push(await screenMarkup(page));
      await page.context().close();
    }
    expect(markups[1]).toBe(markups[0]);
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "populated");
    await expect(react.locator("#app > #levro-react-root > .grid")).toHaveCount(2);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "populated");
    await expect(legacy.locator("#app > .grid")).toHaveCount(2);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  test("broken pictures: a broken product photo gets the app's placeholder and a broken vendor logo becomes the initials tile, in both versions", async ({ browser }) => {
    const seen: Record<string, unknown> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      seen[mode] = await page.evaluate(() => ({
        photo: document.querySelector('[data-product-id$="409"] .product-img img')?.getAttribute("src")?.slice(0, 40),
        logoSlot: (() => {
          const tile = document.querySelector<HTMLElement>('[data-product-id$="410"] .product-img .img-initials');
          return tile ? `${tile.className}|${tile.getAttribute("aria-label")}|${tile.style.getPropertyValue("--ih")}|${tile.textContent}` : "missing";
        })(),
      }));
      await page.context().close();
    }
    expect(seen.react).toEqual(seen.legacy);
    expect(String((seen.react as { photo: string }).photo)).toContain("data:image/svg+xml");
    expect(String((seen.react as { logoSlot: string }).logoSlot)).toContain("img-initials");
  });

  for (const mode of MODES) {
    test(`${mode}: the heart removes and re-adds a saved product (same writes), a product card opens the product`, async ({ page }) => {
      const { log } = await open(page, mode, "populated");
      const first = page.locator(".product-card-wrap").first();
      const heart = first.locator(".fav-btn");
      await expect(heart).toHaveAttribute("class", /fav-btn/);
      const before = await heart.innerHTML();
      await heart.click();
      for (let i = 0; i < 4; i++) await page.clock.runFor(300);
      expect(log.writes.filter((w) => /favorites/.test(w))).toHaveLength(1);
      expect(await heart.innerHTML()).not.toBe(before); // the icon flipped
      await heart.click();
      for (let i = 0; i < 4; i++) await page.clock.runFor(300);
      expect(await heart.innerHTML()).toBe(before);
      expect(log.writes.filter((w) => /favorites/.test(w))).toHaveLength(2);

      await first.locator(".card").click({ position: { x: 20, y: 60 } });
      await expect(page.locator("body")).toHaveAttribute("data-view", "productDetail");
      expect(new URL(page.url()).searchParams.get("product")).toBe("00000000-0000-4000-8000-000000000401");
      await page.goBack();
      for (let i = 0; i < 8; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "wishlist");
      await expect(page.locator(".product-card-wrap")).toHaveCount(8);
    });

    test(`${mode}: quick add puts the item in the cart (same call, tick shown) without opening the product`, async ({ page }) => {
      const { log } = await open(page, mode, "populated");
      const btn = page.locator(".product-card-wrap .card-cart-btn").first();
      await btn.click();
      await expect(btn.locator("i")).toHaveClass(/fa-check/); // the tick shows at once (the page clock is frozen, so it stays)
      for (let i = 0; i < 4; i++) await page.clock.runFor(300);
      expect(log.rpcs.filter((r) => r === "add_to_cart")).toHaveLength(1);
      await expect(page.locator("body")).toHaveAttribute("data-view", "wishlist");
    });

    test(`${mode}: package cards open the package by click and by keyboard; the comment button opens its comments`, async ({ page }) => {
      await open(page, mode, "populated");
      // (A click on the photo opens the picture viewer instead, so click the title row.)
      await page.locator(".package-listing-card").first().locator(".package-card-title-row").click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "packageDetail");
      expect(new URL(page.url()).searchParams.get("package")).toBe("00000000-0000-4000-8000-000000000501");
      await page.goBack();
      for (let i = 0; i < 8; i++) await page.clock.runFor(500);

      await page.locator(".package-listing-card").nth(1).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-view", "packageDetail");
      expect(new URL(page.url()).searchParams.get("package")).toBe("00000000-0000-4000-8000-000000000502");
      await page.goBack();
      for (let i = 0; i < 8; i++) await page.clock.runFor(500);

      await page.locator(".package-card-comment-btn").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "packageDetail");
    });

    test(`${mode}: a signed-out visitor sees the log-in message`, async ({ page }) => {
      await openApp(page, { signedIn: false, theme: "light" }, START[mode]);
      await goTo(page, "wishlist");
      for (let i = 0; i < 6; i++) await page.clock.runFor(500);
      await expect(page.locator("#app")).toContainText("Log in to save items to your wishlist.");
    });

    test(`${mode}: a deep link opens the page for a signed-in buyer; only the expected requests are made`, async ({ page }) => {
      const log: NetworkLog = await installFixtures(page, { signedIn: true, theme: "light", ...DATA.populated });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=wishlist&appParams=%7B%7D`);
      for (let i = 0; i < 12; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "wishlist");
      await expect(page.locator(".product-card-wrap")).toHaveCount(8);
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "populated");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 14; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator(".product-card-wrap")).toHaveCount(8);
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/WishlistPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
      await open(page, mode, "populated");
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("leaving the React page removes it completely", async ({ page }) => {
    await open(page, "react", "populated");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated", "dark");
      colours[mode] = await page.evaluate(() =>
        ["h2", ".section-title", ".product-card-wrap .card", ".pc-name", ".product-card-compact-price", ".product-old-price", ".product-current-price", ".product-card-total-line", ".fav-btn", ".card-cart-btn", ".card-svc-tag", ".package-listing-card", ".package-card-title-row .badge", ".package-card-includes", ".package-card-delivery", ".package-card-comment-btn"].map((sel) => {
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
        await open(page, mode, "populated");
        boxes[mode] = await page.evaluate(() =>
          [".grid", ".product-card-wrap:nth-child(1)", ".product-card-wrap:nth-child(3)", ".product-card-wrap:nth-child(8)", ".product-card-wrap:nth-child(1) .product-img", ".product-card-wrap:nth-child(1) .pc-title-row", ".package-listing-card:nth-child(1)", ".package-listing-card:nth-child(2)", ".package-listing-card:nth-child(3)"].map((sel) => {
            const nodes = document.querySelectorAll("#app " + sel);
            const r = nodes[0]?.getBoundingClientRect();
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

// Pixel parity: legacy and React are each compared with the SAME reference picture.
for (const theme of ["light", "dark"] as const) {
  for (const vp of [{ label: "390", width: 390, height: 844 }, { label: "1280", width: 1280, height: 800 }]) {
    for (const data of ["populated", "empty"] as const) {
      for (const mode of MODES) {
        test.describe(`wishlist ${data} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, data, theme);
            await expect(page.locator("#app h2")).toContainText("Your Wishlist");
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`wishlist-${data}-${theme}-${vp.label}.png`);
          });
        });
      }
    }
  }
}
