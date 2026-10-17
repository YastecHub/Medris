import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW } from "./fixtures/data";
import { goTo, openApp } from "./support/app";
import { installFixtures } from "./support/network";

// Pilot screen: Terms of Service drawn by React (src/views/terms) against the legacy renderTerms().
// Both versions are driven with the same fixtures and the same steps and must come out the same.
// Pixel parity is in first-wave.spec.ts (same reference pictures); this file covers the content,
// the structure, the links, Back, deep links and what is (not) loaded.

type Mode = "legacy" | "react";
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=terms" };

/** The page's markup without things that may legitimately differ: inline handlers and whitespace between tags. */
async function legalMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("#app .legal-page");
    if (!el) return "";
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[onclick]").forEach((n) => n.removeAttribute("onclick"));
    return copy.outerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

async function open(page: Page, mode: Mode, theme: "light" | "dark" = "light") {
  const session = await openApp(page, { signedIn: false, theme }, START[mode]);
  await goTo(page, "terms");
  return session;
}

test.describe("Terms: React matches legacy", () => {
  test("same markup, same text, same classes", async ({ browser }) => {
    const result: Record<string, string> = {};
    for (const mode of ["legacy", "react"] as const) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode);
      result[mode] = await legalMarkup(page);
      await page.context().close();
    }
    expect(result.legacy.length).toBeGreaterThan(5000);
    expect(result.react).toBe(result.legacy);
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react");
    await expect(react.locator("#app > #levro-react-root > .legal-page")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy");
    await expect(legacy.locator("#app > .legal-page")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  for (const mode of ["legacy", "react"] as const) {
    test(`${mode}: links open the Refund policy and the support form, and Back returns to Terms`, async ({ page }) => {
      await open(page, mode);
      await page.getByRole("link", { name: "Refund & Cancellation Policy" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "refundPolicy");
      await expect(page.locator("#app")).toContainText("Refund");
      expect(page.url()).not.toMatch(/#$/); // the "#" link did not change the address

      await page.goBack();
      for (let i = 0; i < 6; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "terms");
      await expect(page.locator("#app .legal-page h2")).toHaveText("Terms of Service");

      await page.getByRole("link", { name: "support request" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "supportRequest");
    });
  }

  for (const mode of ["legacy", "react"] as const) {
    test(`${mode}: the address, history entry and page start (scrolled to the top)`, async ({ page }) => {
      await openApp(page, { signedIn: false, theme: "light" }, START[mode]);
      await page.evaluate(() => window.scrollTo(0, 400));
      await goTo(page, "terms");
      expect(new URL(page.url()).searchParams.get("appView")).toBe("terms");
      // The app scrolls to the top with a short animation: let the frozen page clock run it out.
      // (The legacy page itself sometimes comes to rest a pixel or two below 0, so allow a few pixels.)
      for (let i = 0; i < 10 && (await page.evaluate(() => window.scrollY)) > 3; i++) await page.clock.runFor(200);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(3);
      expect(await page.evaluate(() => document.body.classList.contains("product-detail-view"))).toBe(false);
    });
  }

  for (const mode of ["legacy", "react"] as const) {
    test(`${mode}: a deep link to the Terms page opens it`, async ({ page }) => {
      // A signed-in buyer (a signed-out visitor meets the sign-in screen first, in both versions).
      // The link itself must take them to the page.
      await installFixtures(page, { signedIn: true, theme: "light" });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=terms&appParams=%7B%7D`);
      for (let i = 0; i < 10; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "terms");
      await expect(page.locator("#app .legal-page h2")).toHaveText("Terms of Service");
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
    });
  }

  test("reloading on the Terms page keeps working (persisted route is not a stale snapshot)", async ({ page }) => {
    await open(page, "react");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 8; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator("#app .legal-page")).toHaveCount(1);
    await expect(page.locator("#app .legal-page h2")).toHaveText("Terms of Service");
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunkRequests: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of ["legacy", "react"] as const) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => {
        if (/\/assets\/TermsPage-[\w-]+\.js/.test(r.url())) chunkRequests[mode].push(r.url());
      });
      await open(page, mode);
      await page.context().close();
    }
    expect(chunkRequests.legacy).toEqual([]);
    expect(chunkRequests.react.length).toBe(1);
  });

  test("leaving the React Terms page removes it completely", async ({ page }) => {
    await open(page, "react");
    await goTo(page, "privacy");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator("#app")).toContainText("Privacy Policy");
  });

  test("dark mode: the React Terms page uses the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of ["legacy", "react"] as const) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "dark");
      colours[mode] = await page.evaluate(() =>
        ["h2", "h3", "p.muted", "p", "li", "a"].map((sel) => {
          const el = document.querySelector("#app .legal-page " + sel);
          if (!el) return sel + ": missing";
          const cs = getComputedStyle(el);
          return `${sel}: ${cs.color} | ${cs.fontSize} | ${cs.fontWeight} | ${cs.lineHeight} | ${cs.marginTop} | ${cs.marginBottom}`;
        }),
      );
      await page.context().close();
    }
    expect(colours.react).toEqual(colours.legacy);
  });

  for (const width of [390, 1280]) {
    test(`${width}px: the page boxes are exactly where legacy puts them (the placeholder adds no layout)`, async ({ browser }) => {
      const boxes: Record<string, unknown[]> = {};
      for (const mode of ["legacy", "react"] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await ctx.newPage();
        await open(page, mode);
        boxes[mode] = await page.evaluate(() =>
          ["", " h2", " h3", " ul", " li:last-child", " p:last-of-type"].map((sel) => {
            const r = document.querySelector("#app .legal-page" + sel)?.getBoundingClientRect();
            return r ? [r.x, r.y + window.scrollY, r.width, r.height].map((n) => Math.round(n * 10) / 10) : null;
          }),
        );
        await ctx.close();
      }
      // Within half a pixel: the app has a sub-pixel horizontal slide-in that can land on 16 or 16.1.
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
