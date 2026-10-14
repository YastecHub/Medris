import { expect, test, type Page } from "@playwright/test";
import { DIRECTORY_PRODUCTS, DIRECTORY_SECTORS, DIRECTORY_VENDORS, FIXED_NOW } from "./fixtures/data";
import { goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions } from "./support/network";

// The vendors directory drawn by React (src/views/vendors: the page frame) against the legacy
// renderVendorsDirectory(). The cards, filters, map and chips stay owned by the existing code, so what is
// compared is the frame AND what the existing code makes of it: same markup after the load, same database
// requests, same behaviour of every control.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=vendors" };

type Data = "populated" | "empty" | "error";
const DATA: Record<Data, Partial<FixtureOptions>> = {
  populated: { tables: { vendors: DIRECTORY_VENDORS, products: DIRECTORY_PRODUCTS, sectors: DIRECTORY_SECTORS } },
  empty: { tables: { vendors: [], products: [], sectors: DIRECTORY_SECTORS } },
  error: { failTables: ["vendors"] },
};

/** What is on screen: the React placeholder's content, or #app's. Handlers, attribute order and style spelling are normalised. */
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
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => n.setAttribute("style", n.style.cssText));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    // Random ids the old card builders hand out (gallery/lightbox) differ run to run.
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/\b(lv|gal|vd)-[a-z0-9]{5,}\b/g, "$1-ID").trim();
  });
}

/** Every Supabase read the page made, so legacy and React can be compared as sets (order of parallel reads is not significant). */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/rest/v1/") && r.method() === "GET") seen.push(`${u.pathname}${u.search}`);
  });
  return seen;
}

async function settle(page: Page, rounds = 12) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

async function open(page: Page, mode: Mode, data: Data, opts: { theme?: "light" | "dark"; signedIn?: boolean; view?: "grid" | "list" | "map" } = {}) {
  const requests = watchRequests(page);
  const view = opts.view ?? "list";
  await page.addInitScript((v) => {
    try {
      localStorage.setItem("levromart_vendors_view", v);
    } catch {
      /* storage unavailable */
    }
  }, view);
  const session = await openApp(page, { signedIn: opts.signedIn ?? false, theme: opts.theme ?? "light", ...DATA[data] }, START[mode]);
  await goTo(page, "vendors");
  await settle(page);
  return { ...session, requests };
}

const cardNames = (page: Page) => page.locator("#vendorsGrid .vd-card, #vendorsGrid .vc2").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));

test.describe("Vendors directory: React matches legacy", () => {
  for (const data of ["populated", "empty", "error"] as const) {
    test(`${data}: same markup after the load, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; requests: string[]; errors: string[] }> = {
        legacy: { markup: "", requests: [], errors: [] },
        react: { markup: "", requests: [], errors: [] },
      };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const { requests } = await open(page, mode, data);
        out[mode] = { markup: await screenMarkup(page), requests: [...requests].sort(), errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(400);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.legacy.requests.some((r) => r.includes("/rest/v1/vendors"))).toBe(true);
      expect(out.react.requests).toEqual(out.legacy.requests);
      expect(out.react.errors).toEqual(out.legacy.errors);
      if (data === "populated") {
        const m = out.react.markup;
        expect(m).toContain("Ada&#39;s Kitchen".replace("&#39;", "'"));
        expect(m).toContain("Brisk Tech");
        expect(m).not.toContain("Not Verified Yet");
        expect(m).not.toContain("Paused Shop");
        expect(m).toContain("Food &amp; Drinks");
        expect(m).toContain("Electronics");
      }
    });
  }

  test("React draws the frame into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "populated");
    await expect(react.locator("#app > #levro-react-root > .vd-page")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "populated");
    await expect(legacy.locator("#app > .vd-page")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  test("text from the database is escaped (a name with HTML in it shows as text, in both versions)", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      await expect(page.locator("#vendorsGrid").getByText('<b>Bold</b> & "Quotes" Store')).toHaveCount(1);
      await expect(page.locator("#vendorsGrid b")).toHaveCount(0);
      await page.context().close();
    }
  });

  for (const mode of MODES) {
    test(`${mode}: the controls do what they did: tabs, search, filters, arrangement, view modes`, async ({ page }) => {
      const writes: string[] = [];
      const { log } = await open(page, mode, "populated");
      writes.push(...log.writes);

      const all = await cardNames(page);
      expect(all.length).toBe(4); // 6 rows, 2 are hidden (unverified, paused)

      // Tabs: Buy / Rent / Buy & Rent narrow the list by what vendors sell.
      await page.locator('#vendorsListingTabs [data-filter="rent"]').click();
      await settle(page, 4);
      expect((await cardNames(page)).join("|")).toContain("Campus Rentals");
      expect((await cardNames(page)).length).toBe(1);
      await expect(page.locator('#vendorsListingTabs [data-filter="rent"]')).toHaveClass(/active/);
      await page.locator('#vendorsListingTabs [data-filter="both"]').click();
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(1);
      await page.locator('#vendorsListingTabs [data-filter="all"]').click();
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(4);

      // Search by vendor name or by something it sells.
      await page.locator("#vendorSearchInput").fill("laptop");
      await settle(page, 4);
      expect(await cardNames(page)).toEqual([expect.stringContaining("Brisk Tech")]);
      await page.locator("#vendorSearchInput").fill("");
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(4);

      // Filters panel, with the options the loader filled in.
      await page.locator("#vendorsFiltersToggle").click();
      await expect(page.locator("#vendorsFiltersPanel")).not.toHaveClass(/hidden/);
      await expect(page.locator("#vendorsFiltersToggle")).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#vendorCityFilter option")).toHaveText(["All cities", "Abuja", "Lagos"]);
      await expect(page.locator("#vendorCategoryFilter option")).toHaveText(["Known for: anything", "Beauty", "Electronics", "Events", "Food"]);
      await expect(page.locator("#vendorSectorFilter option")).toHaveText(["All sectors", "Food & Drinks", "Tech & Gadgets"]);
      await page.locator("#vendorCityFilter").selectOption("Lagos");
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(2);
      await page.locator("#vendorCityFilter").selectOption("");
      await page.locator("#vendorCategoryFilter").selectOption("Electronics");
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(2);
      await page.locator("#vendorCategoryFilter").selectOption("");
      await page.locator("#vendorSectorFilter").selectOption({ label: "Tech & Gadgets" });
      await settle(page, 4);
      expect((await cardNames(page)).length).toBe(2);
      await page.locator("#vendorSectorFilter").selectOption("");

      // Arrangement.
      await page.locator("#vendorSortFilter").selectOption("alphabetical");
      await settle(page, 4);
      const names = await cardNames(page);
      expect(names.length).toBe(4);
      expect(names[0]).toContain("Bold"); // punctuation sorts before letters
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.locator("#vendorsFiltersPanel")).toHaveClass(/hidden/);

      // View modes: grid, list, map — and the choice is remembered.
      for (const view of ["grid", "list", "map"] as const) {
        await page.locator(`#vendorsView${view[0]!.toUpperCase()}${view.slice(1)}Btn`).click();
        await settle(page, 3);
        await expect(page.locator(`#vendorsView${view[0]!.toUpperCase()}${view.slice(1)}Btn`)).toHaveClass(/active/);
        expect(await page.evaluate(() => localStorage.getItem("levromart_vendors_view"))).toBe(view);
      }
      await expect(page.locator("#vendorsMapWrap")).not.toHaveClass(/hidden/);
      await expect(page.locator("#vendorsGrid")).toHaveClass(/hidden/);
      expect(log.writes.filter((w) => !writes.includes(w))).toEqual([]);
    });

    test(`${mode}: a vendor card opens its storefront and Back returns to the directory`, async ({ page }) => {
      await open(page, mode, "populated");
      await page.locator("#vendorsGrid").getByText("Brisk Tech").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
      expect(new URL(page.url()).searchParams.get("storefront")).toBe("00000000-0000-4000-8000-000000000402");
      await page.goBack();
      await settle(page, 8);
      await expect(page.locator("body")).toHaveAttribute("data-view", "vendors");
      expect((await cardNames(page)).length).toBe(4);
    });

    test(`${mode}: a search with no matches shows the empty message`, async ({ browser }) => {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      await page.locator("#vendorSearchInput").fill("zzzz-no-such-thing");
      await settle(page, 4);
      await expect(page.locator("#vendorsGrid")).toContainText(/no vendors/i);
      await page.context().close();
    });

    test(`${mode}: a deep link opens the directory; nothing is written`, async ({ page }) => {
      const log = await installFixtures(page, { signedIn: true, theme: "light", ...DATA.populated });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=vendors&appParams=%7B%7D`);
      await settle(page, 14);
      await expect(page.locator("body")).toHaveAttribute("data-view", "vendors");
      expect((await cardNames(page)).length).toBeGreaterThan(0);
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("each visit starts again: the listing tab and search reset, exactly as in legacy", async ({ browser }) => {
    const states: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      await page.locator('#vendorsListingTabs [data-filter="buy"]').click();
      await settle(page, 3);
      await goTo(page, "terms");
      await goTo(page, "vendors");
      await settle(page);
      states[mode] = [await page.locator("#vendorsListingTabs .active").getAttribute("data-filter") ?? "", await page.locator("#vendorSearchInput").inputValue(), String((await cardNames(page)).length)];
      await page.context().close();
    }
    expect(states.react).toEqual(states.legacy);
    expect(states.legacy[0]).toBe("all");
  });

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "populated");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    await settle(page, 14);
    expect((await cardNames(page)).length).toBeGreaterThan(0);
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/VendorsPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
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
    await expect(page.locator(".vd-page")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated", { theme: "dark" });
      colours[mode] = await page.evaluate(() =>
        [".vd-title h2", ".vd-title-ico", ".vd-view", ".vd-tab", ".vd-tab.active", ".vd-search", ".vd-search input", ".vd-filter-btn", "#vendorsGrid > *"].map((sel) => {
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
          ["", " .vd-head", " .vd-views", " .vd-seg", " .vd-tools", " .vd-search", " .vd-filter-btn", " #vendorsGrid", " #vendorsGrid > :first-child", " #vendorsGrid > :last-child"].map((sel) => {
            const r = document.querySelector("#app .vd-page" + sel)?.getBoundingClientRect();
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
