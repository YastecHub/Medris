/**
 * "(formerly <old name>)" next to a renamed shop: never shown to the shop's own owner, and a person sees it only the
 * first two times they open that shop's page (counted on this device), so it fades away once people know the new name.
 */
const KEY = (vendorId: string) => `lv-formerly:${vendorId}`;
const LIMIT = 2;

export function isOwnShop(vendorId: string): boolean {
  try {
    return !!(window as unknown as { isOwnVendorId?: (id: string) => boolean }).isOwnVendorId?.(vendorId);
  } catch {
    return false;
  }
}

export function formerlyViews(vendorId: string): number {
  try {
    return Number(localStorage.getItem(KEY(vendorId)) || 0) || 0;
  } catch {
    return 0;
  }
}

/** True while this person should still see the old name. */
export function mayShowFormerly(vendorId: string): boolean {
  return !isOwnShop(vendorId) && formerlyViews(vendorId) < LIMIT;
}

/** Counts one opening of the shop's own page. */
export function countFormerlyView(vendorId: string): void {
  if (isOwnShop(vendorId)) return;
  try {
    localStorage.setItem(KEY(vendorId), String(formerlyViews(vendorId) + 1));
  } catch {
    /* private mode: the old name simply stays hidden next time only if storage works */
  }
}
