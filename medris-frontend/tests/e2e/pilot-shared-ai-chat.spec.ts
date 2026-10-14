import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW } from "./fixtures/data";
import { freezeForScreenshot, goTo, openApp } from "./support/app";
import { installFixtures, type FixtureOptions } from "./support/network";

// A chat shared from Levi (read-only, opened from a ?share= link) drawn by React (src/views/shared-ai-chat) against the legacy
// renderSharedAiChat(). Both versions are driven with the same fixtures and must come out the same: what the database is asked, what is
// shown (messages, date separators, Levi's hidden tags removed, the "no longer available" card) and what the buttons do.

type Mode = "legacy" | "react";
const MODES = ["legacy", "react"] as const;
const START: Record<Mode, string> = { legacy: "/?react=off", react: "/?react=sharedAiChat" };
const TOKEN = "fixture-share-token";

const day = (offset: number, hh = 10) => new Date(new Date(FIXED_NOW).getTime() + offset * 86400000 + (hh - 10) * 3600000).toISOString();
const ROWS = [
  { role: "user", content: "Where can I find a cheap laptop?", created_at: day(-9, 9), title: "Laptop <b>hunt</b> & \"deals\"" },
  { role: "assistant", content: "Try the Electronics sector. [[NAV:vendors]] Here are some <i>ideas</i> & more.", created_at: day(-9, 9) },
  { role: "user", content: "Thanks, add the first one to my cart", created_at: day(-1, 18), title: "x" },
  { role: "assistant", content: "Done! [[ADDCART productId=00000000-0000-4000-8000-000000000101 quantity=1]] It is in your cart.", created_at: day(-1, 18) },
  { role: "user", content: "Great", created_at: day(0, 8), title: "x" },
  { role: "assistant", content: "Anything else?", created_at: day(0, 8) },
];
type Data = "chat" | "single" | "gone" | "failed";
const DATA: Record<Data, Partial<FixtureOptions>> = {
  chat: { rpcs: { get_shared_ai_conversation: ROWS } },
  single: { rpcs: { get_shared_ai_conversation: [{ role: "user", content: "Hello", created_at: day(0), title: null }] } },
  gone: { rpcs: { get_shared_ai_conversation: [] } },
  failed: { rpcs: { get_shared_ai_conversation: null } },
};

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
    return copy.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

async function settle(page: Page, rounds = 10) {
  for (let i = 0; i < rounds; i++) await page.clock.runFor(500);
}

async function open(page: Page, mode: Mode, data: Data, opts: { theme?: "light" | "dark"; signedIn?: boolean } = {}) {
  const session = await openApp(page, { signedIn: opts.signedIn ?? false, theme: opts.theme ?? "light", ...DATA[data] }, START[mode]);
  await goTo(page, "sharedAiChat", { token: TOKEN });
  await settle(page);
  return session;
}

test.describe("Shared AI chat: React matches legacy", () => {
  for (const data of ["chat", "single", "gone", "failed"] as const) {
    test(`${data}: same markup and text, and the same request`, async ({ browser }) => {
      const out: Record<Mode, { markup: string; rpcs: string[]; writes: string[]; errors: string[] }> = {
        legacy: { markup: "", rpcs: [], writes: [], errors: [] },
        react: { markup: "", rpcs: [], writes: [], errors: [] },
      };
      for (const mode of MODES) {
        const page = await (await browser.newContext()).newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const bodies: string[] = [];
        page.on("request", (r) => r.url().includes("get_shared_ai_conversation") && bodies.push(r.postData() ?? ""));
        const { log } = await open(page, mode, data);
        out[mode] = { markup: await screenMarkup(page), rpcs: [...log.rpcs, ...bodies].sort(), writes: log.writes, errors };
        await page.context().close();
      }
      expect(out.legacy.markup.length).toBeGreaterThan(40);
      expect(out.react.markup).toBe(out.legacy.markup);
      expect(out.react.rpcs).toEqual(out.legacy.rpcs);
      expect(out.react.rpcs.some((r) => r.includes(TOKEN))).toBe(true);
      expect(out.react.writes).toEqual(out.legacy.writes);
      expect(out.react.errors).toEqual(out.legacy.errors);
      const m = out.react.markup;
      if (data === "chat") {
        expect(m).toContain("Laptop &lt;b&gt;hunt&lt;/b&gt; &amp; \"deals\""); // title is text, not HTML
        expect(m).toContain("Here are some &lt;i&gt;ideas&lt;/i&gt; &amp; more.");
        expect(m).not.toContain("[[NAV");
        expect(m).not.toContain("[[ADDCART");
        expect(m.match(/conv-date-sep/g)?.length).toBe(3);
        expect(m).toContain("Today");
        expect(m).toContain("Yesterday");
      }
      if (data === "gone" || data === "failed") expect(m).toContain("This chat link is no longer available.");
    });
  }

  for (const mode of MODES) {
    test(`${mode}: the buttons go to Home; a signed-in visitor sees the same page`, async ({ page }) => {
      await open(page, mode, "chat", { signedIn: true });
      await page.getByRole("button", { name: "Try Levromart" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "home");
      await goTo(page, "sharedAiChat", { token: TOKEN });
      await settle(page, 6);
      await expect(page.locator(".shared-ai-chat .ai-chat-msg")).toHaveCount(6);
    });

    test(`${mode}: the gone-card button goes to Home`, async ({ page }) => {
      await open(page, mode, "gone");
      await page.getByRole("button", { name: "Go to Levromart" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-view", "home");
    });

    test(`${mode}: the shared link opens the chat for a signed-in visitor (and nothing is written)`, async ({ page }) => {
      // (A signed-out visitor meets the sign-in screen first, in both versions; the link opens the chat once signed in.)
      const log = await installFixtures(page, { signedIn: true, theme: "light", ...DATA.chat });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.goto(`${START[mode]}&share=${TOKEN}`);
      await settle(page, 14);
      await expect(page.locator("body")).toHaveAttribute("data-view", "sharedAiChat");
      await expect(page.locator(".shared-ai-chat .ai-chat-msg")).toHaveCount(6);
      await expect(page.locator("#app #levro-react-root")).toHaveCount(mode === "react" ? 1 : 0);
      expect(log.writes.filter((w) => w !== "POST users")).toEqual([]);
    });
  }

  test("React draws into the placeholder; legacy draws straight into #app", async ({ browser }) => {
    const react = await (await browser.newContext()).newPage();
    await open(react, "react", "chat");
    await expect(react.locator("#app > #levro-react-root > .shared-ai-chat")).toHaveCount(1);
    const legacy = await (await browser.newContext()).newPage();
    await open(legacy, "legacy", "chat");
    await expect(legacy.locator("#app > .shared-ai-chat")).toHaveCount(1);
    await expect(legacy.locator("#levro-react-root")).toHaveCount(0);
  });

  test("the React screen is only downloaded when it is switched on and opened", async ({ browser }) => {
    const chunks: Record<Mode, string[]> = { legacy: [], react: [] };
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      page.on("request", (r) => /\/assets\/SharedAiChatPage-[\w-]+\.js/.test(r.url()) && chunks[mode].push(r.url()));
      await open(page, mode, "chat");
      await page.context().close();
    }
    expect(chunks.legacy).toEqual([]);
    expect(chunks.react.length).toBe(1);
  });

  test("leaving the React page removes it completely", async ({ page }) => {
    await open(page, "react", "chat");
    await goTo(page, "terms");
    await expect(page.locator("#levro-react-root")).toHaveCount(0);
    await expect(page.locator(".shared-ai-chat")).toHaveCount(0);
  });

  test("dark mode: the same colours as legacy", async ({ browser }) => {
    const colours: Record<string, string[]> = {};
    for (const mode of MODES) {
      const page = await (await browser.newContext()).newPage();
      await open(page, mode, "chat", { theme: "dark" });
      colours[mode] = await page.evaluate(() =>
        [".shared-ai-chat", ".conv-date-sep", ".ai-chat-msg.user", ".ai-chat-msg.assistant", ".btn"].map((sel) => {
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
        await open(page, mode, "chat");
        boxes[mode] = await page.evaluate(() =>
          ["", ".flex img", ".flex strong", ".shared-ai-chat", ".conv-date-sep", ".ai-chat-msg.user", ".ai-chat-msg.assistant", ".ai-chat-msg:last-child", ".btn"].map((sel) => {
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
    for (const data of ["chat", "gone"] as const) {
      for (const mode of MODES) {
        test.describe(`shared chat ${data} / ${theme} / ${vp.label}px`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });
          test(`${mode} looks like the reference`, async ({ page }) => {
            await open(page, mode, data, { theme });
            await freezeForScreenshot(page);
            await expect(page).toHaveScreenshot(`shared-chat-${data}-${theme}-${vp.label}.png`, { fullPage: false });
          });
        });
      }
    }
  }
}
