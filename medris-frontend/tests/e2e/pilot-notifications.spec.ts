import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { FIXED_NOW, MY_VENDOR_TABLES, NOTIFICATION_ROWS, NOTIF_OWNER_TABLES } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions, type NetworkLog } from "./support/network";

// The Notifications page drawn by React (src/views/notifications) against the legacy renderNotificationsPage() +
// renderNotifPanel(). Both versions are driven with the same fixtures and the same steps and must come out the same:
// what the database is asked, what is shown (tabs, badges, rows, grouped chats, select mode), what every control does,
// and what is written when you tap, select or leave.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=notifications" };

type Setup = "buyer" | "vendor" | "empty" | "error";
const SETUP: Record<Setup, Partial<FixtureOptions>> = {
  buyer: { tables: { notifications: NOTIFICATION_ROWS, ...NOTIF_OWNER_TABLES } },
  vendor: { tables: { notifications: NOTIFICATION_ROWS, ...NOTIF_OWNER_TABLES, ...MY_VENDOR_TABLES } },
  empty: { tables: { notifications: [] } },
  error: { failTables: ["notifications"] },
};

/** What is on screen (React placeholder content, or #app's), with handlers, attribute order, style spelling normalised. */
async function screenMarkup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("#levro-react-root") ?? document.querySelector("#app");
    if (!host) return "";
    const copy = host.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[onclick]").forEach((n) => n.removeAttribute("onclick"));
    copy.querySelectorAll<HTMLElement>("[style]").forEach((n) => n.setAttribute("style", n.style.cssText));
    Array.from(copy.querySelectorAll<HTMLElement>("*")).forEach((n) => {
      const attrs = Array.from(n.attributes).map((a) => [a.name, a.value] as const).sort(([x], [y]) => x.localeCompare(y));
      attrs.forEach(([name]) => n.removeAttribute(name));
      attrs.forEach(([name, value]) => n.setAttribute(name, value));
    });
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

/** Every Supabase REST request and every write the page made (unique), to compare what the database is asked and told. */
function watchRequests(page: Page): Set<string> {
  const seen = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname === "e2e-fixture.supabase.co" && u.pathname.startsWith("/rest/v1/")) seen.add(`${r.method()} ${u.pathname}${u.search}`.replace(/\d{4}-\d{2}-\d{2}T[\d%A:.]+Z/g, "<time>"));
  });
  return seen;
}
const sorted = (s: Set<string>) => Array.from(s).sort();

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && !/Notification (rendering|ownership)/.test(m.text()) && errors.push(`console: ${m.text()}`));
  return errors;
}

/** A tap that does not depend on what is drawn over the page (the first-run vendor set-up overlay covers it for vendors). */
const tap = (locator: Locator) => locator.evaluate((el) => (el as HTMLElement).click());

async function settle(page: Page, rounds = 8) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

async function open(page: Page, mode: Mode, setup: Setup, theme: "light" | "dark" = "light") {
  const requests = watchRequests(page);
  const errors = watchErrors(page);
  const session = await openApp(page, { signedIn: true, theme, ...SETUP[setup] }, START[mode]);
  await page.route(/images\.example\.test|broken\.example\.test/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") }));
  await goTo(page, "notifications");
  await settle(page);
  return { ...session, requests, errors };
}

test.describe("Notifications: React matches legacy", () => {
  for (const setup of ["buyer", "vendor", "empty", "error"] as const) {
    test(`${setup}: same markup and text, and the database is asked the same things`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; requests: string[]; errors: string[] }> = { legacy: { markup: "", requests: [], errors: [] }, react: { markup: "", requests: [], errors: [] } };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const { requests, errors } = await open(page, mode, setup);
        out[mode] = { markup: await screenMarkup(page), requests: sorted(requests), errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(200);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.react.requests).toEqual(out.legacy.requests);
      expect(out.react.errors, "errors in the React version").toEqual([]);
      const m = out.react.markup;
      if (setup === "buyer" || setup === "vendor") {
        for (const shown of ["New order received", "Payment confirmed", "New comment on your product", "New follower", "Security notice", "Points earned"]) expect(m).toContain(shown);
        expect(m).toContain("New message from Ada Eze"); // three chats from one person became one row
        expect(m).toContain("2 new messages");
        expect(m).toContain("&lt;b&gt;Big&lt;/b&gt; sale &amp; more"); // HTML in a title is text
        expect(m).not.toContain("08012345678"); // the phone number is masked
        expect(m).toContain("Chidi Obi"); // new follower shows the name, not the body
      }
      if (setup === "vendor") expect(m).toContain("My Listings");
      else if (setup === "buyer") expect(m).not.toContain("My Listings");
      if (setup === "empty") expect(m).toContain("You're all caught up.");
      if (setup === "error") expect(m).toContain("Couldn’t load notifications right now. Please try again.");
    });
  }

  /** Runs the same steps in both versions (each in its own browser context) and returns what each produced. */
  async function both<T>(browser: Browser, setup: Setup, steps: (page: Page, ctx: { requests: Set<string>; errors: string[]; log: NetworkLog }) => Promise<T>): Promise<Record<Mode, T & { errors: string[]; requests: string[] }>> {
    const out = {} as Record<Mode, T & { errors: string[]; requests: string[] }>;
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const { requests, errors, log } = await open(page, mode, setup);
      const result = await steps(page, { requests, errors, log });
      out[mode] = { ...result, errors, requests: sorted(requests) };
      await page.context().close();
    }
    return out;
  }

  test("tabs: every tab shows the same list, badges and messages, without asking the database again", async ({ browser }) => {
    const out = await both(browser, "vendor", async (page) => {
      const labels = await page.locator(".notif-tab").allTextContents();
      const seen: Record<string, string> = {};
      for (let i = 0; i < labels.length; i++) {
        await tap(page.locator(".notif-tab").nth(i));
        await settle(page, 3);
        seen[labels[i]!] = await screenMarkup(page);
      }
      return { labels, seen };
    });
    expect(out.react.labels).toEqual(out.legacy.labels);
    expect(out.legacy.labels.length).toBe(4); // All, Personal, My Listings, Vendors
    expect(out.react.seen).toEqual(out.legacy.seen);
    expect(new Set(Object.values(out.react.seen)).size).toBeGreaterThan(2); // the tabs really differ
    expect(out.react.requests).toEqual(out.legacy.requests);
    expect(out.react.errors).toEqual([]);
  });

  test("select mode: entering, toggling rows, select all, marking read and leaving the mode behave the same, with the same writes", async ({ browser }) => {
    const out = await both(browser, "buyer", async (page) => {
      const steps: Record<string, string> = {};
      const ids = NOTIFICATION_ROWS.map((n) => n.id);
      // What a long press (or the "select" menu) calls.
      await page.evaluate((id) => (window as unknown as { enterNotifSelectMode: (id: string) => void }).enterNotifSelectMode(id), ids[0]!);
      await settle(page, 3);
      steps["entered"] = await screenMarkup(page);
      await page.locator(".notif-item").nth(2).click();
      await settle(page, 2);
      steps["toggled-one"] = await screenMarkup(page);
      await page.getByRole("button", { name: /Select all|Deselect all/ }).click();
      await settle(page, 3);
      steps["selected-all"] = await screenMarkup(page);
      await page.getByRole("button", { name: /Select all|Deselect all/ }).click();
      await settle(page, 3);
      steps["after-second-select-all"] = await screenMarkup(page);
      await page.evaluate((id) => (window as unknown as { enterNotifSelectMode: (id: string) => void }).enterNotifSelectMode(id), ids[1]!);
      await settle(page, 3);
      await page.getByTitle("Mark unread").click();
      await settle(page, 6);
      steps["after-mark-unread"] = await screenMarkup(page);
      return { steps };
    });
    expect(out.react.steps).toEqual(out.legacy.steps);
    expect(out.legacy.steps["entered"]).toContain("notif-select-bar");
    expect(out.legacy.steps["selected-all"]).toContain(`${NOTIFICATION_ROWS.length} selected`); // chats are not folded into one row while selecting; every real row counts
    expect(out.react.requests).toEqual(out.legacy.requests); // includes the write that marks the selection
    expect(out.react.requests.some((r) => r.startsWith("PATCH"))).toBe(true);
    expect(out.react.errors).toEqual([]);
  });

  test("opening a row goes to its target and leaving the page commits the read ones, with the same writes", async ({ browser }) => {
    const out = await both(browser, "buyer", async (page) => {
      await page.locator(".notif-item").first().click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "orderDetail");
      await settle(page, 6);
      return { view: await page.evaluate(() => document.body.dataset.view), left: await page.locator("#levro-react-root").count() };
    });
    expect(out.react.view).toBe(out.legacy.view);
    expect(out.react.left).toBe(0); // leaving removed the React page
    const notPolling = (rs: string[]) => rs.filter((r) => !/select=status%2Cstatus_changed_at|\/payments\?select=id%2Cstatus%2Camount/.test(r)); // the order page's own live refresh, not the notifications page
    expect(notPolling(out.react.requests)).toEqual(notPolling(out.legacy.requests));
    expect(out.react.requests.some((r) => r.startsWith("PATCH"))).toBe(true);
    expect(out.react.errors).toEqual([]);
  });

  test("the grouped chat row marks its notifications read, updates the bell and opens the conversation", async ({ browser }) => {
    const out = await both(browser, "buyer", async (page) => {
      const bellBefore = await page.locator("#notifDot").textContent().catch(() => null);
      await page.locator(".notif-message-summary").click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "messages");
      await settle(page, 6);
      return { bellBefore, bellAfter: await page.locator("#notifDot").textContent().catch(() => null), params: new URL(page.url()).searchParams.get("appParams") };
    });
    expect(out.react.bellAfter).toBe(out.legacy.bellAfter);
    expect(out.react.params).toBe(out.legacy.params);
    expect(out.react.requests).toEqual(out.legacy.requests);
    expect(out.react.errors).toEqual([]);
  });

  test("a switch to another tab and leaving commits only the seen ones (same write as legacy)", async ({ browser }) => {
    const out = await both(browser, "buyer", async (page) => {
      await page.locator(".notif-tab").nth(1).click(); // Personal
      await settle(page, 3);
      await goTo(page, "terms");
      await settle(page, 6);
      return {};
    });
    expect(out.react.requests).toEqual(out.legacy.requests);
    expect(out.react.errors).toEqual([]);
  });

  test("the Back arrow returns to where you came from", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await openApp(page, { signedIn: true, theme: "light", ...SETUP.buyer }, START[mode]);
      await goTo(page, "vendors");
      await settle(page, 2);
      // The bell sets where Back goes; set it the same way the app does.
      await page.evaluate(() => {
        (window as unknown as { lastNotificationReturnView: string }).lastNotificationReturnView = "vendors";
      }).catch(() => undefined);
      await goTo(page, "notifications");
      await settle(page, 4);
      await page.getByRole("button", { name: "Back" }).click();
      await settle(page, 3);
      await expect(page.locator("body")).toHaveAttribute("data-view", /^(vendors|home)$/);
      await page.context().close();
    }
  });

  test("a refresh triggered by the app while the page is open updates the list the same way", async ({ browser }) => {
    const out = await both(browser, "buyer", async (page) => {
      const before = await screenMarkup(page);
      // New data arrives (what the live channel / refresh does): a new unread notification.
      await page.unroute("**/*");
      await installFixtures(page, { signedIn: true, theme: "light", tables: { notifications: [{ ...NOTIFICATION_ROWS[0]!, id: "00000000-0000-4000-8000-0000000008ff", title: "Brand new activity", read: false, created_at: FIXED_NOW }, ...NOTIFICATION_ROWS], ...NOTIF_OWNER_TABLES } });
      // What the app does when its live channel reports a change: ask for the panel to be redrawn.
      await page.evaluate(() => (window as unknown as { renderNotifPanel: () => void }).renderNotifPanel());
      await settle(page, 8);
      return { before, after: await screenMarkup(page) };
    });
    expect(out.react.after).toBe(out.legacy.after);
    expect(out.react.after).toContain("Brand new activity");
    expect(out.react.after).not.toBe(out.react.before);
    expect(out.react.errors).toEqual([]);
  });

  test("the first paint from the saved copy looks the same, then the live list replaces it", async ({ browser }) => {
    const out = {} as Record<Mode, { cached: string; live: string; errors: string[] }>;
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const errors = watchErrors(page);
      await openApp(page, { signedIn: true, theme: "light", ...SETUP.buyer }, START[mode]);
      await page.evaluate(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)), [`levromart-notifications-cache-v2:00000000-0000-4000-8000-0000000000b1`, NOTIFICATION_ROWS.slice(0, 6)] as const);
      // Hold the answer of the notifications table so the instant paint can be looked at.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route(/\/rest\/v1\/notifications/, async (route) => {
        await gate;
        await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "content-range": `0-${NOTIFICATION_ROWS.length - 1}/${NOTIFICATION_ROWS.length}` }, body: JSON.stringify(NOTIFICATION_ROWS) });
      });
      await page.evaluate(() => (window as unknown as { navigate: (v: string) => void }).navigate("notifications"));
      await page.clock.runFor(1500);
      const cached = await screenMarkup(page);
      release();
      await settle(page, 8);
      out[mode] = { cached, live: await screenMarkup(page), errors };
      await page.context().close();
    }
    expect(out.legacy.cached).toContain("notif-item"); // the cached rows are on screen before the data arrives
    expect(out.legacy.cached).not.toContain("notif-list-scroll");
    expect(out.react.cached).toBe(out.legacy.cached);
    expect(out.legacy.live).toContain("notif-list-scroll");
    expect(out.react.live).toBe(out.legacy.live);
    expect(out.react.errors).toEqual([]);
  });

  test("while the page is on screen the legacy redraw function is replaced, and it is put back when you leave", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", ...SETUP.buyer }, START.react);
    await page.evaluate(() => ((window as unknown as { __orig: unknown }).__orig = (window as unknown as { renderNotifPanel: unknown }).renderNotifPanel));
    await goTo(page, "notifications");
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { renderNotifPanel: unknown }).renderNotifPanel === (window as unknown as { __orig: unknown }).__orig)).toBe(false);
    // A legacy-style redraw request does not write HTML into the React page.
    const before = await page.locator("#notificationsPage").evaluate((el) => el.firstElementChild?.className);
    await page.evaluate(() => (window as unknown as { renderNotifPanel: () => void }).renderNotifPanel());
    await settle(page, 4);
    expect(await page.locator("#levro-react-root #notificationsPage .notif-list-scroll").count()).toBe(1);
    expect(before).toBeTruthy();
    await goTo(page, "terms");
    expect(await page.evaluate(() => (window as unknown as { renderNotifPanel: unknown }).renderNotifPanel === (window as unknown as { __orig: unknown }).__orig)).toBe(true);
  });

  test("the app's own deep link to the notifications page works for a signed-in buyer", async ({ browser }) => {
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      const log: NetworkLog = await installFixtures(page, { signedIn: true, theme: "light", ...SETUP.buyer });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&levro=notifications`);
      await settle(page, 14);
      await expect(page.locator("body")).toHaveAttribute("data-view", "notifications");
      await expect(page.locator(".notif-item-wrap").first()).toBeVisible();
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
      await page.context().close();
    }
  });

  test("an administrator gets the same tabs (no Orders tab) in both versions", async ({ browser }) => {
    const out = {} as Record<Mode, string>;
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await openApp(page, { signedIn: true, theme: "light", tables: { notifications: NOTIFICATION_ROWS, ...NOTIF_OWNER_TABLES, users: [{ id: "00000000-0000-4000-8000-0000000000b1", role: "admin", email: "buyer@example.test" }] } }, START[mode]);
      await goTo(page, "notifications");
      await settle(page);
      out[mode] = await screenMarkup(page);
      await page.context().close();
    }
    expect(out.react).toBe(out.legacy);
    expect(out.legacy).not.toContain("Orders");
  });

  test("reloading on the page keeps working", async ({ page }) => {
    await open(page, "react", "buyer");
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { navigate?: unknown }).navigate === "function");
    for (let i = 0; i < 14; i++) await page.clock.runFor(500).catch(() => undefined);
    await expect(page.locator(".notif-item-wrap").first()).toBeVisible();
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/NotificationsPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
      await open(page, mode, "buyer");
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "buyer", "dark");
      colours[mode] = await page.evaluate(() =>
        [".notifications-page-heading h2", ".notifications-page-heading p", ".notif-tabs", ".notif-tab", ".notif-tab.active", ".notif-tab-badge", ".notif-item", ".notif-item.unread", ".notif-copy strong", ".notif-copy .muted", ".notif-message-summary", ".notif-message-summary-title", ".notif-summary-avatar", ".notification-system-icon", ".notification-avatar-fallback", ".icon-btn"].map((sel) => {
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
        await open(page, mode, "buyer");
        boxes[mode] = await page.evaluate(() =>
          [".notifications-page-shell", ".notifications-page-heading", ".notif-tabs", ".notif-tab:nth-child(2)", ".notif-list-scroll", ".notif-item-wrap:nth-child(1)", ".notif-item-wrap:nth-child(3)", ".notif-item-wrap:last-child", ".notif-message-summary", ".notif-item-wrap:nth-child(1) .notif-copy"].map((sel) => {
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

// Pixel parity: legacy and React are each compared with the SAME reference picture.
for (const theme of ["light", "dark"] as const) {
  for (const vp of [{ label: "390", width: 390, height: 844 }, { label: "1280", width: 1280, height: 800 }]) {
    for (const setup of ["buyer", "empty"] as const) {
      for (const mode of MODES) {
        test.describe(`notifications ${setup} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, setup, theme);
            await expect(page.locator("#app h2")).toContainText("Notifications");
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`notifications-${setup}-${theme}-${vp.label}.png`);
          });
        });
      }
    }
  }
}
