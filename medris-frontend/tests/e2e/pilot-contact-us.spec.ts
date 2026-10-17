import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW } from "./fixtures/data";
import { goTo, openApp } from "./support/app";
import { installFixtures } from "./support/network";

// Contact us drawn by React (src/views/contact-us) against the legacy renderContactUs().
// Both versions are driven with the same fixtures and the same steps and must come out the same.
// Pixel parity is in first-wave.spec.ts (same reference pictures as the legacy page).

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=contactUs" };
const PAGE = "#app .contact-us-page";

/**
 * Markup without inline handlers. Style attributes are compared by their computed text, and attributes
 * are listed in alphabetical order (React sets e.g. <img src> after the other attributes; the order has
 * no effect on the page).
 */
async function pageMarkup(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "";
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[onclick]").forEach((n) => n.removeAttribute("onclick"));
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => n.setAttribute("style", n.style.cssText));
    [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("*"))].forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    return copy.outerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  }, PAGE);
}

async function open(page: Page, mode: Mode, theme: "light" | "dark" = "light") {
  const session = await openApp(page, { signedIn: false, theme }, START[mode]);
  await goTo(page, "contactUs");
  return session;
}

test.describe("Contact us: React matches legacy", () => {
  test("same markup, same text, same classes, same links", async ({ browser }) => {
    const result: Record<string, string> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode);
      result[mode] = await pageMarkup(page);
      await page.context().close();
    }
    expect(result.legacy!.length).toBeGreaterThan(1500);
    expect(result.legacy).toContain("tel:+2348063227669");
    expect(result.react).toBe(result.legacy);
  });

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react");
    await expect(react.locator("#app > #levro-react-root > .contact-us-page")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy");
    await expect(legacy.locator("#app > .contact-us-page")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  for (const mode of MODES) {
    test(`${mode}: social buttons report their click and open a new tab; the request button opens the form; Back returns`, async ({ page }) => {
      await open(page, mode);
      // Record social clicks and stop links from really leaving the page.
      await page.evaluate(() => {
        const w = window as unknown as { __social: string[]; trackSocialClick?: (k: string) => void };
        w.__social = [];
        w.trackSocialClick = (k: string) => void w.__social.push(k);
        document.addEventListener("click", (e) => (e.target as HTMLElement).closest("a")?.getAttribute("target") === "_blank" && e.preventDefault(), true);
      });
      for (const name of ["Instagram", "TikTok", "LinkedIn"]) await page.getByRole("link", { name }).click();
      expect(await page.evaluate(() => (window as unknown as { __social: string[] }).__social)).toEqual(["instagram", "tiktok", "linkedin"]);
      for (const link of await page.locator(`${PAGE} .contact-us-social-btn`).all()) {
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener");
      }
      await expect(page.getByRole("link", { name: /WhatsApp to 0806 322 7669/ })).toHaveAttribute("href", "https://wa.me/2348063227669");

      await page.getByRole("button", { name: "Send a request" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "supportRequest");
      await page.goBack();
      for (let i = 0; i < 6; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "contactUs");
      await expect(page.locator(`${PAGE} h2`)).toContainText("Contact us");
    });

    test(`${mode}: the address and history entry, and the page starts at the top`, async ({ page }) => {
      await openApp(page, { signedIn: false, theme: "light" }, START[mode]);
      await page.evaluate(() => window.scrollTo(0, 400));
      await goTo(page, "contactUs");
      expect(new URL(page.url()).searchParams.get("appView")).toBe("contactUs");
      for (let i = 0; i < 10 && (await page.evaluate(() => window.scrollY)) > 3; i++) await page.clock.runFor(200);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(3);
    });

    test(`${mode}: a deep link to the Contact us page opens it`, async ({ page }) => {
      // A signed-in buyer (a signed-out visitor meets the sign-in screen first, in both versions).
      await installFixtures(page, { signedIn: true, theme: "light" });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=contactUs&appParams=%7B%7D`);
      for (let i = 0; i < 10; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "contactUs");
      await expect(page.locator(`${PAGE} h2`)).toContainText("Contact us");
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
    });
  }

  test("reloading on the Contact us page keeps working (persisted route is not a stale snapshot)", async ({ page }) => {
    await open(page, "react");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 8; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator(`${PAGE} h2`)).toContainText("Contact us");
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => {
        if (/\/assets\/ContactUsPage-[\w-]+\.js/.test(r.url())) chunks[mode].push(r.url());
      });
      await open(page, mode);
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("leaving the React Contact us page removes it completely", async ({ page }) => {
    await open(page, "react");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator("#app .legal-page h2")).toHaveText("Terms of Service");
  });

  test("dark mode: the React Contact us page uses the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "dark");
      colours[mode] = await page.evaluate(() =>
        [".contact-us-sub", ".contact-us-row", ".contact-us-row-label", ".contact-us-row strong", ".contact-us-socials-title", ".contact-us-social-btn", ".contact-us-handle", ".contact-us-help", ".contact-us-help strong", ".vl-add", ".contact-us-tag"].map((sel) => {
          const el = document.querySelector("#app .contact-us-page " + sel);
          if (!el) return sel + ": missing";
          const cs = getComputedStyle(el);
          return `${sel}: ${cs.color} | ${cs.backgroundColor} | ${cs.fontSize} | ${cs.fontWeight} | ${cs.borderTopColor} | ${cs.marginTop} | ${cs.marginBottom}`;
        }),
      );
      await page.context().close();
    }
    expect(colours.react).toEqual(colours.legacy);
  });

  for (const width of [390, 1280]) {
    test(`${width}px: the page boxes are exactly where legacy puts them`, async ({ browser }) => {
      const boxes: Record<string, unknown[]> = {};
      for (const mode of MODES) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await ctx.newPage();
        await open(page, mode);
        boxes[mode] = await page.evaluate(() =>
          ["", " h2", " .contact-us-card", " .contact-us-row:last-child", " .contact-us-socials", " .contact-us-social-btn:last-child", " .contact-us-help", " .contact-us-tag"].map((sel) => {
            const r = document.querySelector("#app .contact-us-page" + sel)?.getBoundingClientRect();
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
