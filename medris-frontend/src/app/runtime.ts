import { appConfig } from "@/config/env";
import { api } from "@/services/api/endpoints";

/**
 * `window.medris` gives non-React code (and the browser console) access to
 * the typed configuration and API client. Returns a cleanup for effects.
 */
export function exposeMedrisRuntime(): () => void {
  const runtime = Object.freeze({ config: appConfig, api });
  window.medris = runtime;
  return () => {
    if (window.medris === runtime) delete window.medris;
  };
}
