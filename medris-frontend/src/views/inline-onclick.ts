/**
 * Puts the old inline `onclick` attribute on a React-drawn button, as its only handler.
 *
 * A few old style rules are keyed on a button's inline `onclick` attribute rather than on a class
 * (assets/css/03-pages.css:2369 the grey "back" buttons, :2918 the green "Place order" / "Book Now" button, assets/css/02-components.css:3078
 * the share icon colour in the storefront sheet, and a handful for the shop, finance and settings screens). React attaches handlers instead of
 * an attribute, so without the attribute such a button loses its look (found by tests/e2e/style-audit.spec.ts). Use it as `ref={inlineClick(code)}`
 * INSTEAD of `onClick` (using both would run the action twice); `code` is exactly what the old markup had in its onclick="…".
 */
export const inlineClick = (code: string) => (el: HTMLElement | null) => {
  if (el && !el.hasAttribute("onclick")) el.setAttribute("onclick", code);
};
