import { expect, test, type Page } from "@playwright/test";
import type { LevroReact } from "../../src/bridge/view-registry";
import { goTo, openApp } from "./support/app";

// The view registry and the one hook in the legacy navigate() (docs/REACT_MIGRATION.md, section 5).
// No screen is converted yet, so the mechanism is exercised with a stand-in React host that the
// test attaches itself. The screenshot suite in first-wave.spec.ts is the proof that, with every
// switch off, the legacy screens still look exactly as before.

type NavigateFn = (view: string, params?: Record<string, unknown>, push?: boolean) => Promise<void>;
interface Calls {
  rendered: string[];
  unmounted: number;
}
declare global {
  interface Window {
    __calls?: Calls;
    navigate: NavigateFn;
    levroReact?: LevroReact;
  }
}

/** Switches the pilot (`terms`) on and replaces the real React host with a stand-in one. */
async function switchOnWithFakeHost(page: Page, mode: "ok" | "throws") {
  await page.evaluate((m) => {
    const calls: Calls = { rendered: [], unmounted: 0 };
    window.__calls = calls;
    const r = window.levroReact!;
    r.use("terms");
    r.attach({
      async render(view, params, container) {
        if (m === "throws") throw new Error("boom");
        calls.rendered.push(view);
        container.innerHTML = '<div id="fake-react-screen">React drew ' + view + "</div>";
      },
      unmount() {
        calls.unmounted++;
      },
    });
  }, mode);
}

test.describe("view registry (nothing converted yet)", () => {
  test("OFF by default: the registry exists, nothing is on, legacy screens render as before", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    const state = await page.evaluate(() => window.levroReact!.state);
    expect(state.on).toEqual([]);
    expect(state.migrated).toEqual(["terms", "privacy", "refundPolicy", "contactUs", "customerFollowing", "wishlist", "notifications", "vendors", "storefront"]); // these have React versions, but none is on
    await goTo(page, "terms");
    await expect(page.locator("#app")).toContainText("Terms of Service");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
  });

  test("a screen that has no React version stays legacy even when asked for by name or 'all'", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    await page.evaluate(() => window.levroReact!.use("leaderboard,home"));
    expect(await page.evaluate(() => window.levroReact!.isOn("leaderboard"))).toBe(false);
    await goTo(page, "leaderboard");
    await expect(page.locator("#app")).toContainText("Leaderboard");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
  });

  test("?react= is stored, removed from the address bar, and ?react=off wins", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" }, "/?react=terms,privacy");
    expect(new URL(page.url()).searchParams.has("react")).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("medris:react-views"))).toBe("terms,privacy");
    await page.evaluate(() => window.levroReact!.use("off"));
    expect(await page.evaluate(() => localStorage.getItem("medris:react-views"))).toBe("off");
    await page.evaluate(() => window.levroReact!.use(null));
    expect(await page.evaluate(() => localStorage.getItem("medris:react-views"))).toBeNull();
  });

  test("ON: React draws the screen into a placeholder, the legacy screen does not render", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    await switchOnWithFakeHost(page, "ok");
    await goTo(page, "terms");
    await expect(page.locator("#app #levro-react-root #fake-react-screen")).toHaveText("React drew terms");
    await expect(page.locator("#app")).not.toContainText("Terms of Service");
    expect(await page.evaluate(() => window.__calls!.rendered)).toEqual(["terms"]);
  });

  test("leaving a React screen unmounts it, and the next legacy screen is untouched", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    await switchOnWithFakeHost(page, "ok");
    await goTo(page, "terms");
    expect(await page.evaluate(() => window.__calls!.unmounted)).toBe(0);
    await goTo(page, "privacy");
    expect(await page.evaluate(() => window.__calls!.unmounted)).toBeGreaterThanOrEqual(1);
    await expect(page.locator("#app")).toContainText("Privacy Policy");
    await expect(page.locator("#fake-react-screen")).toHaveCount(0);
  });

  test("a React screen is never saved as a legacy snapshot: switching OFF shows the real legacy screen", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    await switchOnWithFakeHost(page, "ok");
    await goTo(page, "terms");
    await goTo(page, "privacy");
    await page.evaluate(() => window.levroReact!.use("off"));
    await goTo(page, "terms");
    await expect(page.locator("#app")).toContainText("Terms of Service");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
    expect(saved).not.toContain("levro-react-root");
  });

  test("a React screen that fails falls back to the legacy screen and is switched off for the session", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    const warnings: string[] = [];
    page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
    await switchOnWithFakeHost(page, "throws");
    await goTo(page, "terms");
    await expect(page.locator("#app")).toContainText("Terms of Service");
    await expect(page.locator("#fake-react-screen")).toHaveCount(0);
    expect(await page.evaluate(() => window.levroReact!.state.failed)).toEqual(["terms"]);
    expect(warnings.join("\n")).toContain('React view "terms" failed');
  });
});
