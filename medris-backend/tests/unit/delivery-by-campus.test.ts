import { describe, expect, it } from "vitest";
import { pickDeliveryRule, type DeliveryRule } from "../../src/database/repositories/checkout.repository.js";

// Delivery by campus (migration 0041): the option for the buyer's campus decides the delivery fee.
const rules: DeliveryRule[] = [
  { mode: "free", scope: "mine" },
  { mode: "flat", fee: 500, scope: "selected", campuses: ["lasu", "yabatech"] },
  { mode: "distance", perKm: 200, scope: "all" },
];

describe("delivery by campus", () => {
  it("the shop's own campus gets its option", () => expect(pickDeliveryRule(rules, "unilag", "unilag").mode).toBe("free"));
  it("a campus picked by name gets its option", () => expect(pickDeliveryRule(rules, "unilag", "yabatech")).toMatchObject({ mode: "flat", fee: 500 }));
  it("any other campus falls back to the 'all campuses' option", () => expect(pickDeliveryRule(rules, "unilag", "oau").mode).toBe("distance"));
  it("no campus chosen is refused", () => expect(() => pickDeliveryRule(rules, "unilag", null)).toThrow(/Choose the campus/));
  it("'not on a campus' is not a campus", () => expect(() => pickDeliveryRule(rules, "unilag", "none")).toThrow(/Choose the campus/));
  it("a campus the shop does not cover is refused", () =>
    expect(() => pickDeliveryRule([{ mode: "free", scope: "mine" }], "unilag", "oau")).toThrow(/does not deliver/));
  it("'my campus' means nothing when the shop has no campus", () =>
    expect(() => pickDeliveryRule([{ mode: "free", scope: "mine" }], "none", "none-campus")).toThrow(/does not deliver/));
});
