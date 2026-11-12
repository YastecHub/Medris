import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frontendRoot } from "../scripts/legacy-baseline.ts";

/**
 * The legacy runtime is big files edited by hand. The regression baseline only proves "nothing changed since the last
 * rebaseline", so a big accidental deletion followed by a rebaseline passes it. This guard names functions the app cannot
 * live without, and a minimum size for the files that were once damaged that way, so such a deletion fails the tests.
 */
const jsDir = path.join(frontendRoot, "src", "legacy", "assets", "js");
function allJs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allJs(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}
const source = allJs(jsDir).map((f) => fs.readFileSync(f, "utf8")).join("\n");

describe("legacy runtime guard", () => {
  it("14-motion.js keeps its size (an edit once removed 1,667 lines of it, including the order list)", () => {
    const lines = fs.readFileSync(path.join(jsDir, "14-motion.js"), "utf8").split("\n").length;
    expect(lines).toBeGreaterThan(8000);
  });

  it.each([
    "orderListHtml",
    "renderVendorOrders",
    "renderCustomerOrders",
    "lvRefundWithdraw",
    "lvWalletCardHtml",
    "lvPushTips",
    "lvLoadMyTeams",
    "navigate",
  ])("still defines %s", (name) => {
    const re = new RegExp(`(function\\s+${name}\\b|(window\\.)?${name}\\s*=)`);
    expect(source).toMatch(re);
  });
});
