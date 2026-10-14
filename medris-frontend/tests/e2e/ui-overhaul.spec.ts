import { expect, test, type Page } from "@playwright/test";
import { DIRECTORY_PRODUCTS, DIRECTORY_SECTORS, DIRECTORY_VENDORS, PD_FULL, PD_ROWS, PD_VARIANTS, PD_VENDOR } from "./fixtures/data";
import { goTo, openApp } from "./support/app";

// Checks for the UI overhaul (legacy pages; none of this is behind the React switch).

const settle = async (page: Page, rounds = 10) => { for (let i = 0; i < rounds; i++) await page.clock.runFor(500); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const BUYER_ROW = { id: "00000000-0000-4000-8000-0000000000b1", email: "buyer@example.test", name: "Test Buyer", full_name: "Test Buyer", role: "buyer", phone: "08010000000" };

test.describe("Desktop shell", () => {
  test("1440px: a sidebar with the icon and label side by side, items packed from the top", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const nav = await page.evaluate(() => {
      const n = document.getElementById("bottomNav")!;
      const r = n.getBoundingClientRect();
      const items = Array.from(n.querySelectorAll<HTMLElement>(".bottom-nav-item")).map((i) => {
        const b = i.getBoundingClientRect();
        const ic = i.querySelector(".bn-icon")!.getBoundingClientRect();
        const lb = i.querySelector(":scope > span:last-child")!.getBoundingClientRect();
        return { top: b.top, height: b.height, iconRight: ic.right, labelLeft: lb.left, iconMid: ic.top + ic.height / 2, labelMid: lb.top + lb.height / 2 };
      });
      return { width: r.width, items, bodyPad: parseFloat(getComputedStyle(document.body).paddingLeft) };
    });
    expect(nav.width).toBeGreaterThanOrEqual(220);
    expect(nav.width).toBeLessThanOrEqual(270);
    expect(nav.bodyPad).toBe(nav.width);
    expect(nav.items.length).toBeGreaterThanOrEqual(4);
    for (const it of nav.items) {
      expect(it.height).toBeLessThanOrEqual(60);
      expect(it.labelLeft).toBeGreaterThanOrEqual(it.iconRight); // label to the right of the icon
      expect(Math.abs(it.labelMid - it.iconMid)).toBeLessThan(6); // on the same line
    }
    const gaps = nav.items.slice(1).map((it, i) => it.top - nav.items[i].top);
    for (const g of gaps) expect(g).toBeLessThan(70); // not spread over the screen height
  });

  for (const [w, h] of [[1024, 768], [1280, 800], [1920, 1080]] as const) {
    test(`${w}x${h}: no sideways scrolling, content sits beside the sidebar`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
      await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
      for (const view of ["home", "vendors"]) {
        await goTo(page, view);
        await settle(page, 4);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, appLeft: document.getElementById("app")!.getBoundingClientRect().left, navRight: document.getElementById("bottomNav")!.getBoundingClientRect().right }));
        expect(m.sw, `${view} overflows sideways`).toBeLessThanOrEqual(m.cw);
        expect(m.appLeft, `${view} content is under the sidebar`).toBeGreaterThanOrEqual(m.navRight);
      }
    });
  }

  test("390px phone: still a bottom bar with every item on one row", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const m = await page.evaluate(() => {
      const n = document.getElementById("bottomNav")!;
      const r = n.getBoundingClientRect();
      const tops = Array.from(n.querySelectorAll(".bottom-nav-item")).map((i) => Math.round(i.getBoundingClientRect().top));
      return { width: r.width, bottom: r.bottom, vh: innerHeight, rows: new Set(tops).size, pad: parseFloat(getComputedStyle(document.body).paddingLeft) };
    });
    expect(m.width).toBeGreaterThan(300);
    expect(m.rows).toBe(1);
    expect(m.pad).toBe(0);
    expect(m.bottom).toBeLessThanOrEqual(m.vh);
  });
});

test.describe("Request a photo", () => {
  test("picked photos and typed text survive leaving the form and coming back", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    await goTo(page, "requestEquipment");
    await settle(page, 6);
    await page.fill("#reqTitle", "Cordless drill");
    await page.setInputFiles("#reqPhotoInput", [1, 2, 3].map((n) => ({ name: `${n}.png`, mimeType: "image/png", buffer: PNG })));
    await settle(page, 6);
    expect(await page.locator("#reqPhotoBox .req-ph:not(.add)").count()).toBe(3);
    const tile = await page.locator("#reqPhotoBox .req-ph").first().boundingBox();
    expect(tile!.width).toBeLessThanOrEqual(90); // thumbnails stay small
    await goTo(page, "home");
    await goTo(page, "requestEquipment");
    await settle(page, 8);
    expect(await page.inputValue("#reqTitle")).toBe("Cordless drill");
    expect(await page.locator("#reqPhotoBox .req-ph:not(.add)").count()).toBe(3);
  });
});

test.describe("Product page", () => {
  const PRODUCT = { productId: PD_FULL.id };
  test("the comments dropdown under the reviews is gone; the top buttons are plain round buttons", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
    await goTo(page, "productDetail", PRODUCT);
    await settle(page);
    expect(await page.locator(".product-comments-card").isVisible()).toBe(false);
    const sizes = await page.locator(".product-detail-top-actions > button").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height), getComputedStyle(e).borderTopWidth]; }));
    expect(sizes).toHaveLength(3);
    for (const [w, h, border] of sizes) { expect(w).toBe(sizes[0][0]); expect(w).toBe(h); expect(w).toBeGreaterThanOrEqual(36); expect(border).toBe("0px"); }
  });

  test("every reply under a comment shows, including replies to replies", async ({ page }) => {
    const me = BUYER_ROW.id;
    const c = (id: string, parent: string | null, n: number) => ({ id, product_id: PD_FULL.id, user_id: me, parent_comment_id: parent, content: `comment ${id}`, author_name: "Test Buyer", author_avatar_url: null, created_at: `2026-03-01T10:0${n}:00Z`, updated_at: `2026-03-01T10:0${n}:00Z` });
    const rows = [c("root", null, 0), c("r1", "root", 1), c("r2", "r1", 2), c("r3", "r2", 3), c("r4", "root", 4)];
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS, product_comments: rows } }, "/?react=off");
    await goTo(page, "productDetail", PRODUCT);
    await settle(page);
    await page.evaluate((id) => (window as unknown as { lvOpenProductComments: (id: string) => void }).lvOpenProductComments(id), PD_FULL.id);
    await settle(page);
    await page.locator(".comment-replies-toggle").first().evaluate((e: HTMLElement) => e.click());
    await settle(page, 2);
    const replies = page.locator(".comment-replies-dropdown .product-comment-row");
    await expect(replies).toHaveCount(4);
    const texts = await replies.locator(".product-comment-body").allTextContents();
    expect(texts.map((t) => t.trim())).toEqual(["comment r1", "comment r2", "comment r3", "comment r4"]);
  });

  test("delivery is light orange and pickup is blue when chosen", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
    await goTo(page, "productDetail", { productId: PD_ROWS[1].id });
    await settle(page);
    const color = (value: string) => page.locator(`.delivery-method-row input[value=${value}]`).evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.locator(".delivery-method-row input[value=delivery]").evaluate((e: HTMLInputElement) => e.click());
    expect(await color("delivery")).toBe("rgb(253, 186, 116)");
    await page.locator(".delivery-method-row input[value=pickup]").evaluate((e: HTMLInputElement) => e.click());
    expect(await color("pickup")).toBe("rgb(147, 197, 253)");
  });
});

test.describe("Verified ticks and follow bell", () => {
  test("a verified student vendor shows a green tick image instead of the student icon", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], vendors: DIRECTORY_VENDORS.map((v) => ({ ...v, student_verified: true })), products: DIRECTORY_PRODUCTS, sectors: DIRECTORY_SECTORS } }, "/?react=off");
    await goTo(page, "vendors");
    await page.evaluate(() => (document.getElementById("vendorsViewGridBtn") as HTMLElement).click());
    await settle(page, 24);
    const ticks = page.locator("i.lv-svi");
    expect(await ticks.count()).toBeGreaterThan(0);
    const bg = await ticks.first().evaluate((e) => { const s = getComputedStyle(e); return { img: s.backgroundImage, w: s.width }; });
    expect(bg.img).toContain("data:image/svg+xml");
    expect(parseFloat(bg.w)).toBeGreaterThan(10);
    const glyph = await ticks.first().evaluate((e) => getComputedStyle(e, "::before").content);
    expect(glyph).toBe("none"); // the student-cap glyph is not drawn any more
  });

  test("the bell shows the chosen mode: all = bell, relevant = star, off = bell with a slash", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const classes = await page.evaluate(async () => {
      const out: Record<string, string> = {};
      for (const mode of ["all", "relevant", "off"]) {
        document.querySelector(".storefront-follow-wrap")?.remove();
        const w = document.createElement("div");
        w.className = "storefront-follow-wrap";
        w.dataset.followVendorId = "v-test";
        w.innerHTML = `<div class="storefront-follow-controls"><button class="follow-settings-btn"><i class="fa-solid fa-bell"></i></button></div><div class="follow-menu hidden">${["all", "relevant", "off"].map((m) => `<button class="follow-mode-row" data-notify-mode="${m}" aria-pressed="${m === mode}"></button>`).join("")}</div>`;
        document.querySelector("#app")!.appendChild(w);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        out[mode] = w.querySelector("i")!.className;
      }
      return out;
    });
    await settle(page, 2);
    expect(classes.all).toBe("fa-solid fa-bell");
    expect(classes.relevant).toBe("fa-solid fa-star");
    expect(classes.off).toBe("fa-regular fa-bell-slash");
  });
});

test("Settings no longer prints the version line", async ({ page }) => {
  await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
  await goTo(page, "settings");
  await settle(page, 4);
  expect(await page.locator("#app").innerText()).not.toMatch(/version\s*1\.0/i);
});

test("Create account: the Google button and campus field follow dark mode", async ({ page }) => {
  await openApp(page, { signedIn: false, theme: "dark" }, "/?react=off");
  await page.evaluate(() => { (window as unknown as { showLogin: () => void }).showLogin(); setTimeout(() => document.getElementById("lvSwitchLink")?.click(), 50); });
  await settle(page, 4);
  const lightness = (sel: string) => page.locator(sel).first().evaluate((e) => { const m = getComputedStyle(e).backgroundColor.match(/\d+/g)!.map(Number); return (m[0] + m[1] + m[2]) / 3; });
  expect(await lightness("#googleAuthBtn")).toBeLessThan(80);
  expect(await lightness(".lv-campus-btn")).toBeLessThan(80);
});

test.describe("Temporary WhatsApp contact", () => {
  const open = async (page: Page, vendorRow: Record<string, unknown>) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS, vendors: [vendorRow] } }, "/?react=off");
    await goTo(page, "productDetail", { productId: PD_FULL.id });
    await settle(page);
  };
  const VENDOR = { id: PD_VENDOR.id, user_id: PD_VENDOR.user_id, business_name: "Ada's Kitchen", verification_status: "verified", is_active: true, phone: "08000000000", whatsapp_number: "08031234567" };

  test("Message vendor offers in-app or WhatsApp, and WhatsApp opens the vendor's number", async ({ page }) => {
    await open(page, VENDOR);
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
    await page.getByRole("button", { name: /message vendor/i }).first().evaluate((e: HTMLElement) => e.click());
    await settle(page, 3);
    const items = page.locator("#mediaActionSheet .media-action-sheet-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Message in app");
    await expect(items.nth(1)).toContainText("Chat on WhatsApp");
    await items.nth(1).evaluate((e: HTMLElement) => e.click());
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["https://wa.me/2348031234567"]);
  });

  test("a vendor with no number goes straight to in-app chat (no chooser)", async ({ page }) => {
    await open(page, { ...VENDOR, phone: null, whatsapp_number: null });
    await page.getByRole("button", { name: /message vendor/i }).first().evaluate((e: HTMLElement) => e.click());
    await settle(page, 3);
    expect(await page.locator("#mediaActionSheet").count()).toBe(0);
  });

  test("with the switch off there is no Message vendor button on the product page", async ({ page }) => {
    await open(page, VENDOR);
    await page.evaluate(() => { (window as unknown as { LV_TEMP_WHATSAPP: boolean }).LV_TEMP_WHATSAPP = false; });
    await goTo(page, "productDetail", { productId: PD_ROWS[1].id });
    await settle(page);
    expect(await page.getByRole("button", { name: /message vendor/i }).count()).toBe(0);
  });
});
