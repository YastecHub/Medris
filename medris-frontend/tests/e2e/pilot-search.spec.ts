import { expect, test, type Page } from "@playwright/test";
import { PRODUCTS } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { type FixtureOptions } from "./support/network";

// The search page drawn by React (src/views/search: the page frame) against the legacy renderSearchPage(). Typing, the delayed query,
// the filter tabs, the suggestions and results, the recent-searches buttons and the long-press stay owned by the existing code, so what
// is compared is the frame AND what the existing code makes of it: same markup once results have loaded, same database requests, same
// behaviour of every control, same saved search history.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=search" };
const HISTORY_KEY = "levromart-search-history-v1";

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
    copy.querySelectorAll("[class]").forEach((n) => n.setAttribute("class", (n.getAttribute("class") ?? "").trim().replace(/\s+/g, " ")));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/\b(pkgGallery|lv|gal|vd)-[\w-]{5,}\b/g, "$1-ID").trim();
  });
}

function firstDifference(a: string, b: string): string {
  if (a === b) return "";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: legacy …${a.slice(Math.max(0, i - 80), i + 160)}…  vs  react …${b.slice(Math.max(0, i - 80), i + 160)}…`;
}

/** Every Supabase read made while the search page is open (from the moment it is opened), without the app's timed polls. */
function watch(page: Page) {
  const reads: string[] = [];
  let on = false;
  page.on("request", (r) => {
    if (!on) return;
    const u = new URL(r.url());
    if (u.pathname.startsWith("/rest/v1/") && r.method() === "GET" && !/voice_calls|notifications|conversations|messages/.test(u.pathname)) reads.push(`${u.pathname}${u.search}`);
  });
  return { reads, start: () => (on = true) };
}

async function settle(page: Page, rounds = 12) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

async function open(page: Page, mode: Mode, opts: { theme?: "light" | "dark"; signedIn?: boolean; history?: string[]; extra?: Partial<FixtureOptions> } = {}) {
  const watcher = watch(page);
  if (opts.history) await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [HISTORY_KEY, JSON.stringify(opts.history)]);
  const session = await openApp(page, { signedIn: opts.signedIn ?? true, theme: opts.theme ?? "light", ...opts.extra }, START[mode]);
  watcher.start();
  await goTo(page, "search");
  await settle(page);
  return { ...session, reads: watcher.reads };
}

async function type(page: Page, text: string) {
  await page.locator("#searchPageInput").fill(text);
  await settle(page, 8);
}

test.describe("Search page: React matches legacy", () => {
  for (const scenario of ["empty", "history", "typed", "no-match"] as const) {
    test(`${scenario}: same markup once the results have loaded, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; reads: string[]; writes: string[]; errors: string[]; focused: string }> = {
        legacy: { markup: "", reads: [], writes: [], errors: [], focused: "" },
        react: { markup: "", reads: [], writes: [], errors: [], focused: "" },
      };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const { reads, log } = await open(page, mode, { history: scenario === "history" ? ["jollof", "laptop <b>x</b>", "tent"] : undefined });
        if (scenario === "typed") await type(page, "jollof");
        if (scenario === "no-match") await type(page, "zzzz-no-such-thing");
        out[mode] = {
          markup: await screenMarkup(page),
          reads: [...reads].sort(),
          writes: [...log.writes].sort(),
          errors,
          focused: await page.evaluate(() => document.activeElement?.id ?? ""),
        };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(300);
      expect(firstDifference(out.legacy.markup, out.react.markup)).toBe("");
      expect(out.react.reads).toEqual(out.legacy.reads);
      expect(out.react.writes).toEqual(out.legacy.writes);
      expect(out.react.errors).toEqual(out.legacy.errors);
      expect(out.react.focused).toBe(out.legacy.focused);
      expect(out.legacy.focused).toBe("searchPageInput");
      if (scenario === "history") {
        expect(out.react.markup).toContain("laptop &lt;b&gt;x&lt;/b&gt;"); // HTML in a saved search shows as text
        expect(out.react.markup).not.toContain("<b>x</b>");
      }
    });
  }

  for (const mode of MODES) {
    test(`${mode}: filter tabs, the clear button, Enter and the recent-searches buttons do what they did`, async ({ page }) => {
      await open(page, mode, { history: ["jollof", "tent"] });
      await expect(page.locator(".search-page-filter.active")).toHaveText("All");
      await expect(page.locator("#searchPageHistory .search-page-chip")).toHaveText(["jollof", "tent"]);

      await type(page, "jollof");
      await expect(page.locator("#searchPageClearBtn")).not.toHaveClass(/hidden/);
      for (const tab of ["Products", "Vendors", "Services", "Packages", "All"]) {
        await page.locator(".search-page-filter").filter({ hasText: new RegExp(`^${tab}$`) }).click();
        await settle(page, 6);
        await expect(page.locator(".search-page-filter.active")).toHaveText(tab);
      }

      await page.locator("#searchPageClearBtn").click();
      await settle(page, 4);
      await expect(page.locator("#searchPageInput")).toHaveValue("");
      await expect(page.locator("#searchPageClearBtn")).toHaveClass(/hidden/);

      await page.locator("#searchPageHistory .search-page-chip").first().click();
      await settle(page, 6);
      await expect(page.locator("#searchPageInput")).toHaveValue("jollof");

      await page.locator("#searchPageInput").fill("tent");
      await page.locator("#searchPageInput").press("Enter");
      await settle(page, 6);
      expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), HISTORY_KEY)).toBeInstanceOf(Array);
    });

    test(`${mode}: a result opens its page and the term is saved to the history; Back returns to Home`, async ({ page }) => {
      await open(page, mode);
      await type(page, PRODUCTS[0].name.split(" ")[0]!);
      await page.locator("#searchPageResults .search-result-row").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", /productDetail|storefront|packageDetail/);
      expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), HISTORY_KEY)).toEqual([PRODUCTS[0].name.split(" ")[0]]);
      await page.goBack();
      await settle(page, 10);
      await expect(page.locator("body")).toHaveAttribute("data-view", "search");
      await page.locator(".search-page-back").click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "home");
    });

    test(`${mode}: "Clear" empties the recent searches`, async ({ page }) => {
      await open(page, mode, { history: ["a", "b"] });
      await page.locator(".search-page-history-head button").click();
      await expect(page.locator("#searchPageHistory .search-page-chip")).toHaveCount(0);
      expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull();
    });

    test(`${mode}: a signed-out visitor and a reload`, async ({ page }) => {
      await open(page, mode, { signedIn: false });
      await expect(page.locator(".search-page")).toHaveCount(1);
      await page.reload();
      await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
      await settle(page, 14);
      await expect(page.locator("body")).toHaveAttribute("data-view", /search|home/);
    });
  }

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react");
    await expect(react.locator("#app > #levro-react-root > .search-page")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy");
    await expect(legacy.locator("#app > .search-page")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/SearchPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
      await open(page, mode);
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("leaving the React page removes it completely", async ({ page }) => {
    await open(page, "react");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator(".search-page")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, { theme: "dark", history: ["jollof"] });
      colours[mode] = await page.evaluate(() =>
        [".search-page-head", ".search-page-back", ".search-page-input-wrap", "#searchPageInput", ".search-page-filter", ".search-page-filter.active", ".search-page-history-head", ".search-page-chip", ".search-page-section"].map((sel) => {
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
        await open(page, mode, { history: ["jollof", "tent"] });
        await page.addStyleTag({ content: ".product-card-wrap,.vendor-card,.review-card{content-visibility:visible!important}" });
        await settle(page, 2);
        boxes[mode] = await page.evaluate(() =>
          [".search-page", ".search-page-head", ".search-page-bar", ".search-page-back", ".search-page-input-wrap", "#searchPageInput", ".search-page-filters", ".search-page-filter:last-child", "#searchPageResults", ".search-page-history-block", ".search-page-chip", ".search-page-section"].map((sel) => {
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
    for (const scenario of ["history", "typed"] as const) {
      for (const mode of MODES) {
        test.describe(`search ${scenario} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, { theme, history: scenario === "history" ? ["jollof", "laptop", "tent"] : undefined });
            if (scenario === "typed") await type(page, "jollof");
            await expect(page.locator(".search-page")).toHaveCount(1);
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`search-${scenario}-${theme}-${vp.label}.png`, { fullPage: false });
          });
        });
      }
    }
  }
}
