import { useEffect } from "react";
import { legacy, type LegacyHelpers } from "@/views/legacy-globals";

/**
 * The legacy router fills in live details on product and package cards (comment and like counters, variety markers,
 * ratings) by calling a set of "hydrate…InView" functions right after it puts a screen's HTML on the page. A React
 * screen appears a moment later, so it calls the same functions once its cards are on screen. They only read the
 * cards that are in the page, exactly as for a legacy screen.
 */
const HYDRATORS: Array<keyof LegacyHelpers> = [
  "hydrateProductCommentCountsInView",
  "hydrateProductVariantIndicatorsInView",
  "hydrateProductLikeCountsInView",
  "hydratePackageCommentCountsInView",
  "hydrateProductRatingsInView",
];

export function useCardHydration(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      for (const name of HYDRATORS) {
        try {
          void Promise.resolve(legacy(name)()).catch(() => undefined);
        } catch {
          /* one failing hydrator must not stop the others */
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready]);
}
