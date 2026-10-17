import type { Identity } from "../../database/context.js";
import type { Logger } from "../../lib/logger.js";
import type { AppServices } from "../../container.js";

/** How the current request proved who it is. */
export type AuthMethod = "bearer" | "cookie" | null;

/** What every request carries in `res.locals` (set by middleware/request-context.ts). */
export interface RequestLocals {
  requestId: string;
  logger: Logger;
  services: AppServices;
  identity: Identity | null;
  authMethod: AuthMethod;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express declares res.locals through this global namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging
    interface Locals extends RequestLocals {}
  }
}
