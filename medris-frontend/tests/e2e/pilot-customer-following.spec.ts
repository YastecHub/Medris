import { expect, test, type Page } from "@playwright/test";
import { ADMIN_USER_ROW, FIXED_NOW, FOLLOWED_ROWS } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions } from "./support/network";

// "Vendors you follow" drawn by React (src/views/customer-following) against the legacy
// renderCustomerFollowing(). Both versions are driven with the same fixtures and the same steps and
// must come out the same: what the database is asked, what is shown, what the buttons do.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=customerFollowing" };

type Data = "populated" | "empty" | "error";
const DATA: Record<Data, Partial<FixtureOptions>> = {
  populated: { tables: { vendor_follows: FOLLOWED_ROWS } },
  empty: { tables: { vendor_follows: [] } },
  error: { failTables: ["vendor_follows"] },
};

/** What is on screen: the React placeholder's content, or #app's. Handlers, attribute order and style spelling are normalised. */
async function screenMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return "";
    const copy = host.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[onclick],[oninput]").forEach((n) => {
      n.removeAttribute("onclick");
      n.removeAttribute("oninput");
    });
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => n.setAttribute("style", n.style.cssText));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

/**
 * The requests the SCREEN made for its list: the vendor_follows read that embeds the vendors. (The app itself
 * also reads vendor_follows for other reasons, on timers; those are not what is being compared.)
 */
function watchFollowRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith("/rest/v1/vendor_follows") && u.search.includes("vendors")) seen.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  return seen;
}

async function open(page: Page, mode: Mode, data: Data, theme: "light" | "dark" = "light") {
  const requests = watchFollowRequests(page);
  const session = await openApp(page, { signedIn: true, theme, ...DATA[data] }, START[mode]);
  await goTo(page, "customerFollowing");
  for (let i = 0; i < 6; i++) await page.clock.runFor(500);
  return { ...session, requests };
}

test.describe("Vendors you follow: React matches legacy", () => {
  for (const data of ["populated", "empty", "error"] as const) {
    test(`${data}: same markup and text, and the database is asked the same thing`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; requests: string[] }> = { legacy: { markup: "", requests: [] }, react: { markup: "", requests: [] } };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const { requests } = await open(page, mode, data);
        out[mode] = { markup: await screenMarkup(page), requests };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(40);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.legacy.requests.length).toBeGreaterThan(0);
      expect(out.react.requests).toEqual(out.legacy.requests);
      if (data === "populated") {
        const m = out.react.markup;
        expect(m).toContain("Ada&#39;s Kitchen".replace("&#39;", "'")); // apostrophe is plain text
        expect(m).toContain("Brisk Tech");
        expect(m).not.toContain("Not Verified Yet");
        expect(m).not.toContain("Paused Shop");
        expect(m).toContain("★ 0.0 · 0 reviews");
        expect(m).toContain("Online"); // vendor without a city
        expect(m).toContain("★ 3.3 · 1 reviews".replace("3.3", Number(3.25).toFixed(1)));
      }
    });
  }

  test("text from the database is escaped (a name with HTML in it shows as text, in both versions)", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "populated");
      await expect(page.locator(".customer-following-card strong").filter({ hasText: "Bold" })).toHaveText('<b>Bold</b> & "Quotes" Store');
      await expect(page.locator(".customer-following-card b")).toHaveCount(0);
      await page.context().close();
    }
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "populated");
    await expect(react.locator("#app > #levro-react-root > .customer-following-page")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "populated");
    await expect(legacy.locator("#app > .customer-following-page")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  for (const mode of MODES) {
    test(`${mode}: search filters the cards, a card opens the storefront, Back button goes home`, async ({ page }) => {
      await open(page, mode, "populated");
      // NOTE (existing behaviour, kept): the app's own filter sets display:none on non-matching cards, but a CSS
      // rule keeps them displayed anyway, so the list does not visibly shrink in either version.
      const visible = async () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".customer-following-card"))
            .filter((c) => c.style.display !== "none") // lmFilterFollowing hides non-matches with an inline display:none
            .map((c) => c.querySelector("strong")?.textContent ?? ""),
        );
      expect(await visible()).toEqual(["Ada's Kitchen", "Brisk Tech", '<b>Bold</b> & "Quotes" Store']);
      await page.getByPlaceholder("Search vendors you follow…").fill("brisk");
      expect(await visible()).toEqual(["Brisk Tech"]);
      await page.getByPlaceholder("Search vendors you follow…").fill("");
      expect((await visible()).length).toBe(3);

      await page.locator(".customer-following-card").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "storefront");
      expect(new URL(page.url()).searchParams.get("storefront")).toBe("00000000-0000-4000-8000-000000000301");
      await page.goBack();
      for (let i = 0; i < 8; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "customerFollowing");
      await expect(page.locator(".customer-following-card")).toHaveCount(3);

      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "home");
    });

    test(`${mode}: the empty state's "Explore vendors" opens the vendors page`, async ({ page }) => {
      await open(page, mode, "empty");
      await page.getByRole("button", { name: "Explore vendors" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "vendors");
    });

    test(`${mode}: after a failed load "Try again" asks again and shows the list once the network is back`, async ({ page }) => {
      const { requests } = await open(page, mode, "error");
      const before = requests.length;
      await expect(page.getByText("Could not load the vendors you follow.")).toBeVisible();
      // The network comes back: from now on the table answers.
      await page.unroute("**/*").catch(() => undefined);
      await installFixtures(page, { signedIn: true, theme: "light", tables: { vendor_follows: FOLLOWED_ROWS } });
      await page.getByRole("button", { name: "Try again" }).click();
      for (let i = 0; i < 10; i++) await page.clock.runFor(500);
      expect(requests.length).toBeGreaterThan(before);
      await expect(page.locator(".customer-following-card")).toHaveCount(3);
    });

    test(`${mode}: a signed-out visitor and an administrator get the "customer accounts" message`, async ({ browser }) => {
      const guest = await (await browser.newContext()).newPage();
      await openApp(guest, { signedIn: false, theme: "light" }, START[mode]);
      await goTo(guest, "customerFollowing");
      for (let i = 0; i < 6; i++) await guest.clock.runFor(500);
      await expect(guest.locator("#app")).toContainText("This page is available for customer accounts.");
      await guest.context().close();

      const admin = await (await browser.newContext()).newPage();
      await openApp(admin, { signedIn: true, theme: "light", tables: { users: [ADMIN_USER_ROW], vendor_follows: FOLLOWED_ROWS } }, START[mode]);
      await goTo(admin, "customerFollowing");
      for (let i = 0; i < 6; i++) await admin.clock.runFor(500);
      await expect(admin.locator("#app")).toContainText("This page is available for customer accounts.");
      await expect(admin.locator(".customer-following-card")).toHaveCount(0);
    });

    test(`${mode}: a deep link opens the page for a signed-in buyer; nothing is written`, async ({ page }) => {
      const log = await installFixtures(page, { signedIn: true, theme: "light", ...DATA.populated });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=customerFollowing&appParams=%7B%7D`);
      for (let i = 0; i < 10; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "customerFollowing");
      await expect(page.locator(".customer-following-card")).toHaveCount(3);
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "populated");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 12; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator(".customer-following-card")).toHaveCount(3);
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/CustomerFollowingPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
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
        [".customer-following-head h2", ".customer-following-head p", ".lm-fol-search", ".lm-fol-search input", ".customer-following-card", ".customer-following-avatar", ".customer-following-copy strong", ".customer-following-copy span", ".customer-following-card > i", ".icon-btn"].map((sel) => {
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
          ["", " .customer-following-head", " .lm-fol-search", " .customer-following-grid", " .customer-following-card:first-child", " .customer-following-card:last-child", " .customer-following-avatar"].map((sel) => {
            const r = document.querySelector("#app .customer-following-page" + sel)?.getBoundingClientRect();
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
        test.describe(`following ${data} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, data, theme);
            await expect(page.locator(".customer-following-page")).toBeVisible();
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`following-${data}-${theme}-${vp.label}.png`);
          });
        });
      }
    }
  }
}
