import { describe, expect, it } from "vitest";
import { addOneCalendarMonth, escapeAttr, normalizePhone, phoneAlias } from "../src/lib/format.js";
import { applyPreviewMeta } from "../src/modules/accounts/share-preview.service.js";
import { iconForType, isPushOnlyType, notificationUrl } from "../src/modules/notify/notify.service.js";
import { remindersForOrder } from "../src/modules/orders/reminders.service.js";
import { appendClientDirectives, relatedTerms, stripOldUiDirectives } from "../src/modules/levi/levi.text.js";

describe("format helpers", () => {
  it("normalises Nigerian phone numbers and builds the private login alias", () => {
    expect(normalizePhone("0801 234 5678")).toBe("2348012345678");
    expect(normalizePhone("+234 801 234 5678")).toBe("2348012345678");
    expect(normalizePhone("002348012345678")).toBe("2348012345678");
    expect(phoneAlias("08012345678")).toBe("p2348012345678@accounts.levromart.app");
    expect(phoneAlias("")).toBe("");
  });

  it("adds one calendar month without overflowing short months", () => {
    expect(addOneCalendarMonth(new Date(2026, 0, 31)).getDate()).toBe(28);
    expect(addOneCalendarMonth(new Date(2026, 0, 31)).getMonth()).toBe(1);
    expect(addOneCalendarMonth(new Date(2026, 9, 10)).getMonth()).toBe(10);
  });

  it("escapes attribute values including quotes", () => {
    expect(escapeAttr(`a"b<c>&`)).toBe("a&quot;b&lt;c&gt;&amp;");
  });
});

describe("link previews", () => {
  it("swaps the default meta tags and escapes vendor text", () => {
    const html = `<title>Levromart</title><meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:image" content="old">`;
    const out = applyPreviewMeta(html, { title: `Ada's "Shop" | Levromart`, description: "Fresh <food>", image: "https://img/x.png", pageUrl: "https://app/?storefront=1" });
    expect(out).toContain("<title>Ada's &quot;Shop&quot; | Levromart</title>");
    expect(out).toContain(`<meta name="description" content="Fresh &lt;food&gt;">`);
    expect(out).toContain(`<meta property="og:image" content="https://img/x.png">`);
  });
});

describe("notifications", () => {
  it("picks the event icon by notification type, composed by /api/notif-icon", () => {
    expect(iconForType("payment_received")).toBe("https://levromart.com/api/notif-icon?k=payment");
    expect(iconForType("new_order")).toBe("https://levromart.com/api/notif-icon?k=order");
    expect(iconForType("new_message")).toBe("https://levromart.com/api/notif-icon?k=message");
    expect(iconForType("something")).toBe("/levromart-notification-icon.png");
  });

  it("never e-mails calls or points alerts", () => {
    expect(isPushOnlyType("incoming_call")).toBe(true);
    expect(isPushOnlyType("rank_change")).toBe(true);
    expect(isPushOnlyType("new_order")).toBe(false);
  });

  it("builds deep links into the app", () => {
    expect(notificationUrl({ target_view: "orderDetail", target_params: { orderId: "o1" } })).toBe(
      "https://levromart.vercel.app/?nview=orderDetail&nparams=%7B%22orderId%22%3A%22o1%22%7D",
    );
  });
});

describe("order reminders", () => {
  const base = { id: "o1", order_type: "sale", delivery_method: "delivery", buyer_id: "b1", vendor: { id: "v1", user_id: "vu1" } };
  it("reminds both sides of a confirmed order", () => {
    const out = remindersForOrder({ ...base, status: "confirmed" });
    expect(out.map((r) => r.userId)).toEqual(["vu1", "b1"]);
  });
  it("does not chase the vendor once a delivery order is fully paid", () => {
    const payments = [
      { payment_type: "delivery_deposit_20", status: "paid" },
      { payment_type: "sale_price", status: "paid" },
    ];
    expect(remindersForOrder({ ...base, status: "confirmed", payments }).map((r) => r.userId)).toEqual(["b1"]);
  });
  it("asks the buyer to confirm receipt of a handed-over sale", () => {
    expect(remindersForOrder({ ...base, status: "handed_over" })[0]?.title).toBe("Confirm you received your order");
  });
  it("does nothing for completed orders", () => {
    expect(remindersForOrder({ ...base, status: "completed" })).toEqual([]);
  });
});

describe("Levi text helpers", () => {
  it("expands related search terms", () => {
    expect(relatedTerms("shoes")).toEqual(expect.arrayContaining(["sneakers", "footwear"]));
  });
  it("removes old UI directives from history", () => {
    expect(stripOldUiDirectives("Here you go [[NAV:cart]] thanks")).toBe("Here you go thanks");
  });
  it("appends tool directives the model left out", () => {
    expect(appendClientDirectives("Added.", [{ clientDirective: "[[CARTSYNC]]" }])).toBe("Added. [[CARTSYNC]]");
    expect(appendClientDirectives("Added. [[CARTSYNC]]", [{ clientDirective: "[[CARTSYNC]]" }])).toBe("Added. [[CARTSYNC]]");
  });
});
