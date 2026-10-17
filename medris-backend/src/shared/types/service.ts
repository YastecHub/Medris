/** What a service of an original endpoint hands back to its controller: an HTTP status and a JSON body. */
export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

/** A service result that may instead send the browser elsewhere (302). */
export type LegacyResult = ServiceResult | { redirect: string };
