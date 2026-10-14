import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// The legacy esc() escapes text for HTML. It is used inside attribute values all over the app, so it must escape quotes:
// otherwise a name with a quote in it ends the attribute and the rest of the name can add attributes (an injection hole).
// These tests run against the legacy app itself.

const EVIL = 'x" onmouseover="window.__pwned=1" data-x=\'<img src=x onerror=alert(1)>';

test.describe("legacy esc()", () => {
  test("escapes & < > and both kinds of quote", async ({ page }) => {
    await openApp(page, { signedIn: false, theme: "light" });
    const out = await page.evaluate(() => {
      const esc = (window as unknown as { esc: (s: unknown) => string }).esc;
      return [esc(`a"b'c<d>&e`), esc(null), esc(undefined), esc(12), esc("plain text")];
    });
    expect(out).toEqual(["a&quot;b&#39;c&lt;d&gt;&amp;e", "", "", "12", "plain text"]);
  });

  test("a product name with quotes and HTML cannot add attributes to a product card or run script", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light" });
    const result = await page.evaluate((name) => {
      const w = window as unknown as { productCardHtml: (p: unknown) => string; packageCardHtml: (p: unknown, fee?: number) => string; __pwned?: number };
      const tpl = document.createElement("template");
      tpl.innerHTML =
        w.productCardHtml({ id: "p1", name, photos: [], listing_type: "sale", sale_price: 1000, vendor: { id: "v1", business_name: name, logo_url: null } }) +
        w.packageCardHtml({ id: "k1", name, description: name, price: 5000, photos: ["https://images.example.test/x.png"], vendor: { id: "v1", business_name: name }, items: [{ quantity: 1, product: { name } }] });
      const attrs = Array.from(tpl.content.querySelectorAll("*")).flatMap((el) => Array.from(el.attributes).map((a) => a.name));
      return {
        badAttrs: attrs.filter((a) => a === "onmouseover" || a === "data-x" || a.startsWith('onmouseover')),
        cartLabel: tpl.content.querySelector(".card-cart-btn")?.getAttribute("aria-label"),
        commentLabel: tpl.content.querySelector(".package-card-comment-btn")?.getAttribute("aria-label"),
        title: tpl.content.querySelector(".pc-name")?.textContent,
        pwned: w.__pwned,
      };
    }, EVIL);
    expect(result.badAttrs).toEqual([]);
    expect(result.cartLabel).toBe(`Add ${EVIL} to cart`);
    expect(result.commentLabel).toBe(`Comments on ${EVIL}`);
    expect(result.title).toBe(EVIL);
    expect(result.pwned).toBeUndefined();
  });

  test("ordinary names with an apostrophe or ampersand still read normally", async ({ page }) => {
    await openApp(page, { signedIn: true, theme: "light" });
    const text = await page.evaluate(() => {
      const w = window as unknown as { productCardHtml: (p: unknown) => string };
      const tpl = document.createElement("template");
      tpl.innerHTML = w.productCardHtml({ id: "p2", name: "Ada's Cakes & Pies", photos: [], listing_type: "sale", sale_price: 500, vendor: { id: "v2", business_name: "Ada's" } });
      return { name: tpl.content.querySelector(".pc-name")?.textContent, label: tpl.content.querySelector(".card-cart-btn")?.getAttribute("aria-label") };
    });
    expect(text).toEqual({ name: "Ada's Cakes & Pies", label: "Add Ada's Cakes & Pies to cart" });
  });
});
