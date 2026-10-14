import { expect, type Page } from "@playwright/test";
import { FIXED_NOW } from "../fixtures/data";
import { installFixtures, type NetworkLog } from "./network";

export type Theme = "light" | "dark";
export interface Session {
  page: Page;
  log: NetworkLog;
}

/** Opens the app with all network answered by fixtures and waits until the legacy runtime is ready. */
export async function openApp(page: Page, opts: { signedIn: boolean; theme: Theme }, path = "/"): Promise<Session> {
  const log = await installFixtures(page, opts);
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await page.goto(path);
  await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function" && !!document.querySelector("#app"));
  // Let the first render settle (the clock is frozen, so wait on the DOM, not on time).
  await page.clock.runFor(3000);
  // A guest lands on the sign-in screen first; "Browse as guest" is what a real visitor taps.
  if (!opts.signedIn) {
    const guest = page.locator(".lv-guest");
    if (await guest.isVisible()) {
      await guest.click();
      await page.clock.runFor(3000);
      await expect(page.locator("body")).toHaveAttribute("data-view", "home");
    }
  }
  return { page, log };
}

/** Goes to a screen the same way the app does: through the global navigate(). */
export async function goTo(page: Page, view: string, params: Record<string, unknown> = {}) {
  await page.evaluate(([v, p]) => (window as unknown as { navigate: (v: string, p?: unknown) => unknown }).navigate(v, p), [view, params] as const);
  // The page clock is frozen, so move it forward in small steps until the app has switched views.
  for (let i = 0; i < 20; i++) {
    await page.clock.runFor(500);
    if ((await page.locator("body").getAttribute("data-view")) === view) break;
  }
  await page.clock.runFor(1500);
  await expect(page.locator("body")).toHaveAttribute("data-view", view);
}

/** Removes things that legitimately differ between runs so screenshots compare cleanly. */
export async function freezeForScreenshot(page: Page) {
  await page.addStyleTag({
    // The "Install Levromart" banner appears on a timer in a normal browser tab; hide it so it
    // cannot make a picture differ from run to run.
    content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}#levroInstallBanner{display:none!important}",
  });
  await page.evaluate(() => document.fonts?.ready);
}
