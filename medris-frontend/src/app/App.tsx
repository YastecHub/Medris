import { useEffect } from "react";
import { exposeMedrisRuntime } from "@/app/runtime";

/**
 * Root React component.
 *
 * Every screen is still rendered by the legacy runtime (src/legacy), which
 * owns #app, routing and the current look. Screens move to React one at a
 * time (see docs/FRONTEND.md, "Migrating a screen"); until the first one
 * does, the React tree renders nothing visible and only publishes the typed
 * config and API client for migrated code and debugging.
 */
export function App() {
  useEffect(() => exposeMedrisRuntime(), []);
  return null;
}
