/**
 * Naira (numeric in the database) <-> kobo (what Paystack uses). Convert only at the Paystack call.
 * Rounds half up to whole kobo; never compare money with floating-point equality, compare kobo with kobo.
 */
export function nairaToKobo(naira: number): number {
  if (typeof naira !== "number" || !Number.isFinite(naira)) throw new RangeError("Amount must be a finite number.");
  if (naira < 0) throw new RangeError("Amount cannot be negative.");
  // toPrecision(15) removes binary noise such as 0.1 + 0.2 = 0.30000000000000004 before rounding
  const kobo = Math.round(Number((naira * 100).toPrecision(15)));
  if (!Number.isSafeInteger(kobo)) throw new RangeError("Amount is too large.");
  return kobo;
}

export function koboToNaira(kobo: number): number {
  if (typeof kobo !== "number" || !Number.isInteger(kobo)) throw new RangeError("Kobo must be a whole number.");
  if (kobo < 0) throw new RangeError("Amount cannot be negative.");
  return kobo / 100;
}
