import type { MouseEvent } from "react";

/**
 * Link behaviour shared by migrated screens: the legacy links were `<a href="#" onclick="navigate(view);
 * return false;">`. These do the same through the app's own router, so history, Back and the route
 * switch (React or legacy) keep working exactly as before.
 */
declare global {
  interface Window {
    navigate?: (view: string, params?: Record<string, unknown>, pushHistory?: boolean) => unknown;
  }
}

export const go = (view: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  window.navigate?.(view);
};
