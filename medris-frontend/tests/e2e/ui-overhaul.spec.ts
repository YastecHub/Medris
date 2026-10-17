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
    const sorted = [...nav.items].sort((a, b) => a.top - b.top);
    const gaps = sorted.slice(1).map((it, i) => it.top - sorted[i]!.top);
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

test.describe("Round 2 feedback", () => {
  test("a tick is drawn only for a vendor marked verified", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const shown = await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<i id="t1" data-vt="x" class="fa-solid fa-circle-check sr-verified"></i><i id="t2" data-vt="y" class="fa-solid fa-circle-check sr-verified lv-on"></i>');
      return ["t1", "t2"].map((id) => getComputedStyle(document.getElementById(id)!).display);
    });
    expect(shown[0]).toBe("none");
    expect(shown[1]).not.toBe("none");
  });

  test("the product picture box is exactly as tall as the picture (no grey strip below it)", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
    await page.route(/images\.example\.test/, (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="720" viewBox="0 0 600 720"><rect width="600" height="720" fill="#e8a33d"/></svg>' }));
    await goTo(page, "productDetail", { productId: PD_FULL.id });
    await settle(page, 14);
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".product-detail-card .product-gallery-main img"); return !!i && i.complete && i.naturalHeight > 0; }, undefined, { timeout: 8000 }).catch(() => undefined);
    await settle(page, 4);
    const m = await page.evaluate(() => {
      const box = document.querySelector(".product-detail-card .product-gallery-main")!.getBoundingClientRect();
      const img = document.querySelector(".product-detail-card .product-gallery-main img")!.getBoundingClientRect();
      return { box: box.height, img: img.height };
    });
    expect(Math.abs(m.box - m.img)).toBeLessThan(2);
  });

  test("dashboard row icons are solid text colour, not faded", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "dark", tables: { users: [BUYER_ROW] } }, "/?react=off");
    await goTo(page, "profile").catch(() => undefined);
    const color = await page.evaluate(() => { document.getElementById("app")!.insertAdjacentHTML("beforeend", '<span id="zi" class="lv-row-ico"><i class="fa-solid fa-heart"></i></span>'); return getComputedStyle(document.getElementById("zi")!).color; });
    expect(color).toBe("rgb(255, 255, 255)");
  });
});

test.describe("Temporary WhatsApp contact", () => {
  const VENDOR = { id: PD_VENDOR.id, user_id: PD_VENDOR.user_id, business_name: "Ada's Kitchen", verification_status: "verified", is_active: true, phone: "08000000000", whatsapp_number: "08031234567" };
  const open = async (page: Page, vendorRow: Record<string, unknown>) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS, vendors: [vendorRow] } }, "/?react=off");
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
  };
  const message = (page: Page) => page.evaluate((id) => (window as unknown as { startConversationWithVendor: (id: string) => Promise<void> }).startConversationWithVendor(id), VENDOR.id);

  test("messaging a vendor offers in-app or WhatsApp, and WhatsApp opens the vendor's number", async ({ page }) => {
    await open(page, VENDOR);
    await message(page);
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
    await message(page);
    await settle(page, 3);
    expect(await page.locator("#mediaActionSheet").count()).toBe(0);
  });

  test("with the switch off there is no chooser", async ({ page }) => {
    await open(page, VENDOR);
    await page.evaluate(() => { (window as unknown as { LV_TEMP_WHATSAPP: boolean }).LV_TEMP_WHATSAPP = false; });
    await message(page);
    await settle(page, 3);
    expect(await page.locator("#mediaActionSheet").count()).toBe(0);
  });

  test("the product page has no Message vendor button (it comes with a confirmed order)", async ({ page }) => {
    await open(page, VENDOR);
    await goTo(page, "productDetail", { productId: PD_FULL.id });
    await settle(page);
    expect(await page.getByRole("button", { name: /message vendor/i }).count()).toBe(0);
  });
});

test.describe("Round 3", () => {
  test("search history keeps at most 7 searches", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const stored = await page.evaluate(() => {
      for (let i = 1; i <= 10; i++) (window as unknown as { writeSearchHistory: (t: string) => void }).writeSearchHistory("term " + i);
      return JSON.parse(localStorage.getItem("levromart-search-history-v1") || "[]");
    });
    expect(stored).toHaveLength(7);
    expect(stored[0]).toBe("term 10");
  });

  test("tapping a suggested vendor records the typed search", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], vendors: DIRECTORY_VENDORS, products: DIRECTORY_PRODUCTS, sectors: DIRECTORY_SECTORS } }, "/?react=off");
    await goTo(page, "search");
    await settle(page);
    await page.evaluate(() => {
      const input = document.getElementById("searchPageInput") as HTMLInputElement;
      input.value = "brisk";
      document.getElementById("searchPageResults")!.insertAdjacentHTML("afterbegin", '<div class="lv-svr"><button class="lv-svr-item" data-vid="x">x</button></div>');
      (document.querySelector("#searchPageResults .lv-svr-item") as HTMLElement).click();
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("levromart-search-history-v1") || "[]"))).toContain("brisk");
  });

  test("the truck and pin icons on the product page are plain text colour", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "dark", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
    await goTo(page, "productDetail", { productId: PD_ROWS[1].id });
    await settle(page);
    const colours = await page.evaluate(() => Array.from(document.querySelectorAll(".pd-step-title i, #buyDeliveryFields .df-label i")).map((e) => getComputedStyle(e).color));
    expect(colours.length).toBeGreaterThan(0);
    for (const c of colours) expect(c).toBe("rgb(255, 255, 255)");
  });

  test("dragging the product page sideways moves it; letting go slides to the next product without a reload", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], products: PD_ROWS, product_variants: PD_VARIANTS } }, "/?react=off");
    await goTo(page, "productDetail", { productId: PD_FULL.id });
    await settle(page);
    const moved = await page.evaluate(() => {
      const touch = (type: string, x: number, y: number) => {
        const t = new Touch({ identifier: 1, target: document.querySelector(".product-detail-info")!, clientX: x, clientY: y });
        document.querySelector(".product-detail-info")!.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] }));
      };
      touch("touchstart", 300, 400); touch("touchmove", 260, 402); touch("touchmove", 200, 404);
      const during = getComputedStyle(document.getElementById("app")!).transform;
      const hint = !!document.querySelector(".lv-swipe-hint");
      touch("touchend", 200, 404);
      return { during, hint };
    });
    expect(moved.during).not.toBe("none");
    expect(moved.hint).toBe(true);
    // let go past the flick threshold: the next product slides in, with no reload flash and nothing left behind
    await expect.poll(async () => { await page.clock.runFor(400); return page.evaluate(() => document.querySelector(".product-detail-card")?.getAttribute("data-product-detail-id")); }, { timeout: 20000 }).not.toBe(PD_FULL.id);
    await expect.poll(async () => { await page.clock.runFor(400); return page.evaluate(() => document.querySelectorAll(".lv-swipe-snap,.lv-swipe-wait").length); }, { timeout: 10000 }).toBe(0);
    expect(await page.evaluate(() => document.getElementById("app")!.style.transform)).toBe("");
    expect(await page.evaluate(() => document.getElementById("app")!.style.opacity)).toBe("");
  });
});

test("the order badge says what a confirmed order is waiting on", async ({ page }) => {
  await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
  const label = (order: Record<string, unknown>) => page.evaluate((o) => (window as unknown as { lvOrderStageLabel: (o: unknown) => string }).lvOrderStageLabel(o), order);
  const pay = (payment_type: string, status = "paid") => ({ payment_type, status });
  const base = { status: "confirmed", order_type: "sale" };
  // pay before delivery / pickup
  expect(await label({ ...base, delivery_method: "pickup", payments: [] })).toBe("");
  expect(await label({ ...base, delivery_method: "pickup", payments: [pay("sale_price")] })).toBe("Payment confirmed");
  expect(await label({ ...base, delivery_method: "delivery", payment_timing: "pay_before", payments: [pay("sale_price")] })).toBe("Payment confirmed");
  // pay after delivery: deposit first, then the balance
  const after = { ...base, delivery_method: "delivery", payment_timing: "pay_after" };
  expect(await label({ ...after, payments: [pay("delivery_deposit_20")] })).toBe("Deposit confirmed · balance due");
  expect(await label({ ...after, payments: [pay("delivery_deposit_20"), pay("sale_price")] })).toBe("Payment confirmed");
  // a reported (pending) payment is still "payment unresolved", never relabelled; other statuses untouched
  expect(await label({ ...after, payments: [pay("delivery_deposit_20", "pending")] })).toBe("");
  expect(await label({ ...after, status: "completed", payments: [pay("sale_price")] })).toBe("");
  expect(await label({ ...after, __paymentUnresolved: true, payments: [pay("delivery_deposit_20")] })).toBe("");
});

test("a student-verified vendor's name gets the green tick wherever it is printed (leaderboard, lists)", async ({ page }) => {
  await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW], vendors: DIRECTORY_VENDORS.map((v, i) => ({ ...v, student_verified: i === 0 })) } }, "/?react=off");
  const name = DIRECTORY_VENDORS[0].business_name, other = DIRECTORY_VENDORS[1].business_name;
  await page.evaluate(([a, b]) => {
    document.getElementById("app")!.insertAdjacentHTML("beforeend", `<div id="zz"><div class="lb-row"><div class="lb-row-copy"><strong id="n1"><span class="nm">${a}</span></strong></div></div><div class="fn-copy"><strong id="n2">${b}</strong></div></div>`);
  }, [name, other]);
  await settle(page, 6);
  expect(await page.locator("#zz .nm + .lv-svi, #zz .nm .lv-svi, #n1 .lv-svi").count()).toBe(1);
  expect(await page.locator("#n2 .lv-svi").count()).toBe(0); // not student-verified: no tick
});

test.describe("Round 4", () => {
  test("a verified vendor's tick shows right after the name on their storefront", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const shown = await page.evaluate(() => {
      document.getElementById("app")!.insertAdjacentHTML("beforeend", '<div class="storefront-name-row"><h1 class="storefront-profile-name">Shop <i id="zt" data-vt="v" class="fa-solid fa-circle-check vendor-inline-verified lv-on"></i></h1><span class="lv-camp-line"><span class="lcl-v"><i class="fa-solid fa-user-graduate"></i></span></span></div>');
      const t = getComputedStyle(document.getElementById("zt")!);
      return { display: t.display, w: parseFloat(t.width) };
    });
    expect(shown.display).not.toBe("none");
    expect(shown.w).toBeGreaterThan(10);
  });

  test("the campus picker is not shown again once a school was picked on this device or put off recently", async ({ browser }) => {
    // control: with nothing remembered the picker does appear (so the checks below are not vacuous)
    const control = await (await browser.newContext()).newPage();
    await openApp(control, { signedIn: true, theme: "light", tables: { users: [{ ...BUYER_ROW, campus_id: null }] } }, "/?react=off");
    await settle(control, 12);
    expect(await control.locator("#lvCampus").count()).toBeGreaterThan(0);
    for (const store of [["lv-campus", "unilag"], ["lv-campus-later", String(Date.now())]] as const) {
      const page = await (await browser.newContext()).newPage();
      await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), store);
      await openApp(page, { signedIn: true, theme: "light", tables: { users: [{ ...BUYER_ROW, campus_id: null }] } }, "/?react=off");
      await settle(page, 12);
      expect(await page.locator("#lvCampus").count(), `picker shown with ${store[0]}`).toBe(0);
    }
  });

  test("opening listing options moves the drawer to the page body and hides the bottom bar until it is closed", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const r = await page.evaluate(() => {
      document.getElementById("app")!.insertAdjacentHTML("beforeend", '<div class="vl-more-wrap"><button id="zb" onclick="vlToggleMenu(this)">x</button><div class="vl-menu hidden"><button>Duplicate</button></div></div>');
      (document.getElementById("zb") as HTMLElement).click();
      const nav = () => getComputedStyle(document.getElementById("bottomNav")!).display;
      const sh = document.querySelector(".vl-sheet") as HTMLElement | null; const open = { pos: sh ? getComputedStyle(sh).position : "", bottom: sh ? getComputedStyle(sh).bottom : "", icon: sh ? getComputedStyle(sh.querySelector("button")!).display : "", navDisplay: nav(), inBody: !!document.querySelector("body > .vl-sheet"), backdrop: !!document.querySelector(".lv-sheet-backdrop") };
      (window as unknown as { vlCloseMenus: () => void }).vlCloseMenus();
      return { open, closed: { navDisplay: nav(), inBody: !!document.querySelector("body > .vl-sheet"), backdrop: !!document.querySelector(".lv-sheet-backdrop") } };
    });
    expect(r.open).toMatchObject({ pos: "fixed", bottom: "0px", navDisplay: "none", inBody: true, backdrop: true });
    expect(r.closed.navDisplay).not.toBe("none");
    expect(r.closed.inBody).toBe(false);
    expect(r.closed.backdrop).toBe(false);
  });
  test("delivery by distance never charges more than N1000 per km", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const fees = await page.evaluate(() => [(0, eval)("distanceDeliveryFee(3000, 2)"), (0, eval)("distanceDeliveryFee(300, 2)")]);
    expect(fees).toEqual([2000, 600]);
  });

  test("a long vendor name is cut with dots but its tick stays visible", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const r = await page.evaluate(() => {
      const app = document.getElementById("app")!;
      app.insertAdjacentHTML("beforeend", '<div id="zw" style="width:140px"><strong id="zn" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A very very long vendor business name here<i class="fa-solid fa-circle-check lv-svi"></i></strong></div>');
      
      document.body.appendChild(document.createElement("i")).className = "lv-tick-probe";
      return null;
    });
    expect(r).toBeNull();
    await page.evaluate(() => document.getElementById("app")!.appendChild(document.createElement("div"))); // wake the tick observer
    await page.waitForFunction(() => document.getElementById("zn")?.classList.contains("lv-nm-flex"), null, { timeout: 8000 }).catch(() => {});
    const box = await page.evaluate(() => { const w = document.getElementById("zw")!.getBoundingClientRect(), t = document.querySelector("#zn .lv-svi")!.getBoundingClientRect(); return { right: t.right, wrapRight: w.right, w: t.width }; });
    expect(box.w).toBeGreaterThan(5);
    expect(box.right).toBeLessThanOrEqual(box.wrapRight + 1);
  });
  test("the map button on Vendors opens a dedicated map page with its own search and category chips", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light", tables: { vendors: DIRECTORY_VENDORS, products: DIRECTORY_PRODUCTS, sectors: DIRECTORY_SECTORS } }, "/?react=off");
    await goTo(page, "vendors");
    await page.locator("#vendorsViewMapBtn").click();
    for (let i = 0; i < 12; i++) { await page.clock.runFor(500); if ((await page.locator("body").getAttribute("data-view")) === "vendorsMap") break; }
    await expect(page.locator("body")).toHaveAttribute("data-view", "vendorsMap");
    await expect(page.locator("#vmPage #vmpQ")).toBeVisible();
    const box = await page.locator("#vmPage").boundingBox();
    expect(box!.height).toBeGreaterThan(200); // a real screen, not the small inline box
    await page.locator(".vmp-back").click();
    for (let i = 0; i < 12; i++) await page.clock.runFor(500);
    await expect(page.locator("body")).toHaveAttribute("data-view", "vendors");
  });
  test("admin new-school buttons are styled (green approve, red reject), not plain black pills", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const c = await page.evaluate(() => {
      document.getElementById("app")!.insertAdjacentHTML("beforeend", '<div class="ac-sub-a"><button class="ok" id="zok">Approve</button><button id="zmid">Same as</button><button class="no" id="zno">Reject</button></div>');
      const g = (id: string) => getComputedStyle(document.getElementById(id)!);
      return { ok: g("zok").backgroundImage, mid: g("zmid").backgroundColor, no: g("zno").color, pad: g("zok").paddingTop };
    });
    expect(c.ok).toContain("gradient");
    expect(c.mid).not.toBe("rgb(0, 0, 0)");
    expect(c.no).toBe("rgb(220, 38, 38)");
    expect(parseFloat(c.pad)).toBeGreaterThan(8);
  });
  test("desktop sidebar lists Home first", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("#bottomNav .bottom-nav-item")).map((b) => ({ t: b.textContent!.trim(), y: b.getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.t));
    expect(labels[0]).toMatch(/^Home/);
  });

  test("swiping the page sideways no longer opens the profile or notification panels", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    await openApp(page, { signedIn: true, theme: "light", tables: { users: [BUYER_ROW] } }, "/?react=off");
    await page.evaluate(() => {
      const el = document.getElementById("app")!;
      const fire = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: 300 }));
      fire("pointerdown", 300); fire("pointermove", 220); fire("pointermove", 120); fire("pointerup", 120);
      fire("pointerdown", 60); fire("pointermove", 140); fire("pointermove", 260); fire("pointerup", 260);
    });
    for (let i = 0; i < 6; i++) await page.clock.runFor(400);
    expect(await page.evaluate(() => document.body.dataset.view)).toBe("home");
    expect(await page.evaluate(() => !!document.querySelector("#profilePanel.open, #notifPanel.open"))).toBe(false);
  });
});
