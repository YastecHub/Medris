import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW } from "./fixtures/data";
import { goTo, openApp } from "./support/app";
import { installFixtures } from "./support/network";

// Refund & Cancellation Policy drawn by React (src/views/refund-policy) against the legacy renderRefundPolicy().
// Both versions are driven with the same fixtures and the same steps and must come out the same.
// Pixel parity is in first-wave.spec.ts (same reference pictures as the legacy page).

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=refundPolicy" };

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
  await goTo(page, "refundPolicy");
  return session;
}

test.describe("Refund policy: React matches legacy", () => {
  test("same markup, same text, same classes", async ({ browser }) => {
    const result: Record<string, string> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode);
      result[mode] = await legalMarkup(page);
      await page.context().close();
    }
    expect(result.legacy!.length).toBeGreaterThan(2000);
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

  for (const mode of MODES) {
    test(`${mode}: the address and history entry, and the page starts at the top`, async ({ page }) => {
      await openApp(page, { signedIn: false, theme: "light" }, START[mode]);
      await page.evaluate(() => window.scrollTo(0, 400));
      await goTo(page, "refundPolicy");
      expect(new URL(page.url()).searchParams.get("appView")).toBe("refundPolicy");
      for (let i = 0; i < 10 && (await page.evaluate(() => window.scrollY)) > 3; i++) await page.clock.runFor(200);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(3);
    });

    test(`${mode}: a deep link to the Refund policy page opens it`, async ({ page }) => {
      // A signed-in buyer (a signed-out visitor meets the sign-in screen first, in both versions).
      await installFixtures(page, { signedIn: true, theme: "light" });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&appView=refundPolicy&appParams=%7B%7D`);
      for (let i = 0; i < 10; i++) await page.clock.runFor(500);
      await expect(page.locator("body")).toHaveAttribute("data-view", "refundPolicy");
      await expect(page.locator("#app .legal-page h2")).toHaveText("Refund & Cancellation Policy");
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
    });
  }

  test("reloading on the Refund policy page keeps working (persisted route is not a stale snapshot)", async ({ page }) => {
    await open(page, "react");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 8; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator("#app .legal-page h2")).toHaveText("Refund & Cancellation Policy");
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => {
        if (/\/assets\/RefundPolicyPage-[\w-]+\.js/.test(r.url())) chunks[mode].push(r.url());
      });
      await open(page, mode);
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("switching only the refund policy on leaves Terms legacy, and the two React pages do not interfere", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" }, "/?react=refundPolicy");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator("#app .legal-page h2")).toHaveText("Terms of Service");
    await page.evaluate(() => window.levroReact!.use("terms,refundPolicy"));
    await goTo(page, "refundPolicy");
    await expect(page.locator("#app #levro-react-root .legal-page h2")).toHaveText("Refund & Cancellation Policy");
    await goTo(page, "terms");
    await expect(page.locator("#app #levro-react-root .legal-page h2")).toHaveText("Terms of Service");
    await expect(page.locator("#levro-react-root")).toHaveCount(1);
  });

  test("dark mode: the React Refund policy page uses the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
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
    test(`${width}px: the page boxes are exactly where legacy puts them`, async ({ browser }) => {
      const boxes: Record<string, unknown[]> = {};
      for (const mode of MODES) {
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
