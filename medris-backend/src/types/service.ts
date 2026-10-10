/** What a module service hands back to its route: an HTTP status and a JSON body. */
export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}
