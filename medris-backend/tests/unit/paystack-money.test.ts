import { describe, expect, it } from "vitest";
import { koboToNaira, maskAccount, nairaToKobo } from "../../src/integrations/paystack/index.js";

describe("paystack money", () => {
  it("converts naira to whole kobo without floating-point noise", () => {
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
    expect(nairaToKobo(999)).toBe(99900);
    expect(nairaToKobo(1234.56)).toBe(123456);
    expect(nairaToKobo(10.005)).toBe(1001); // half up
    expect(nairaToKobo(0)).toBe(0);
  });
  it("handles large amounts", () => {
    expect(nairaToKobo(25_000_000)).toBe(2_500_000_000);
  });
  it("rejects negative, non-finite and unsafe values", () => {
    for (const bad of [-1, -0.01, Number.NaN, Infinity, 1e20]) expect(() => nairaToKobo(bad)).toThrow(RangeError);
  });
  it("converts kobo back and rejects fractions", () => {
    expect(koboToNaira(99900)).toBe(999);
    expect(() => koboToNaira(10.5)).toThrow(RangeError);
    expect(() => koboToNaira(-1)).toThrow(RangeError);
  });
  it("masks bank accounts to the last 4 digits", () => {
    expect(maskAccount("0123456789")).toBe("******6789");
    expect(maskAccount("12")).toBe("****");
  });
});
