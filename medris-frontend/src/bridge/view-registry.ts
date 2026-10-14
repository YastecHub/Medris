/**
 * levroReact: the view registry for the screen-by-screen React migration
 * (docs/REACT_MIGRATION.md, section 5).
 *
 * Built as a classic script together with the data gateway (see build/legacy-document.ts):
 * the legacy router calls navigate() while the page is still loading, before the React
 * module script has run, so the registry must exist by then. It never imports React.
 *
 * What it does:
 *  - answers isOn(view): is there a React version of this screen AND is it switched on?
 *  - keeps the switches (build default, per-browser override, ?react= link helper);
 *  - hands a screen to the React side (attach) and takes it away again (unmount);
 *  - falls back to the legacy screen when React is late or fails, so a bad screen can
 *    never leave a blank page.
 *
 * Switches, strongest first: ?react= in the address (stored, then removed from the
 * address bar), the per-browser override in localStorage "medris:react-views", the build
 * default VITE_REACT_VIEWS. Every list is a comma list of screen names, "all", or "off".
 * Empty means nothing is on, which is today's behaviour.
 */
import { MIGRATED_VIEWS } from "../views/migrated";

export const REACT_VIEWS_OVERRIDE_KEY = "medris:react-views";
/** How long the first navigation waits for the React module before using the legacy screen. */
export const REACT_READY_TIMEOUT_MS = 2000;

/** What the React side provides: draw a screen into `container`, and release it again. */
export interface ReactViewHost {
  render(view: string, params: Record<string, unknown>, container: HTMLElement): Promise<void>;
  unmount(): void;
}

/** "off" is an explicit choice (it beats a build default of "all"); null means "no list given". */
export type ViewList = { kind: "off" } | { kind: "all" } | { kind: "some"; names: Set<string> } | null;

export function parseViewList(value: string | null | undefined): ViewList {
  const items = String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return null;
  const lower = items.map((s) => s.toLowerCase());
  if (lower.includes("off") || lower.includes("none")) return { kind: "off" };
  if (lower.includes("all")) return { kind: "all" };
  return { kind: "some", names: new Set(items) };
}

/** Which of `migrated` a list switches on. Names that have no React version are ignored. */
export function resolveOn(list: ViewList, migrated: readonly string[]): Set<string> {
  if (!list || list.kind === "off") return new Set();
  if (list.kind === "all") return new Set(migrated);
  return new Set(migrated.filter((v) => list.names.has(v)));
}

export interface RegistryDeps {
  migrated: readonly string[];
  /** VITE_REACT_VIEWS */
  buildDefault: string | undefined;
  /** Per-browser storage; may throw (private mode, blocked site data). */
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null;
  /** The current query string, e.g. "?react=terms". */
  search: string;
  /** Removes ?react= from the address bar without adding a history entry. */
  stripParam(): void;
  timeoutMs?: number;
}

export function createViewRegistry(deps: RegistryDeps) {
  const migrated = new Set(deps.migrated);
  const disabled = new Set<string>();
  const timeoutMs = deps.timeoutMs ?? REACT_READY_TIMEOUT_MS;
  let memoryOverride: string | null = null; // used only when storage is unavailable
  let host: ReactViewHost | null = null;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => (readyResolve = resolve));
  let mounted = false;

  const readOverride = (): string | null => {
    try {
      const v = deps.storage?.getItem(REACT_VIEWS_OVERRIDE_KEY) ?? null;
      return v !== null ? v : memoryOverride;
    } catch {
      return memoryOverride;
    }
  };
  const writeOverride = (value: string | null): void => {
    memoryOverride = value;
    try {
      if (value === null) deps.storage?.removeItem(REACT_VIEWS_OVERRIDE_KEY);
      else deps.storage?.setItem(REACT_VIEWS_OVERRIDE_KEY, value);
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  };

  // ?react= : store it, then take it out of the address so shared links stay clean.
  const param = new URLSearchParams(deps.search).get("react");
  if (param !== null) {
    writeOverride(param.trim() === "" ? null : param.trim());
    try {
      deps.stripParam();
    } catch {
      /* ignore */
    }
  }

  let current: { on: Set<string>; source: "link/browser" | "build" | "none" } = compute();

  function compute() {
    const override = readOverride();
    if (override !== null) return { on: resolveOn(parseViewList(override), [...migrated]), source: "link/browser" as const };
    const fromBuild = parseViewList(deps.buildDefault);
    return { on: resolveOn(fromBuild, [...migrated]), source: fromBuild ? ("build" as const) : ("none" as const) };
  }

  const api = {
    /** True when this screen has a React version, is switched on, and has not failed this session. */
    isOn(view: string): boolean {
      return migrated.has(view) && current.on.has(view) && !disabled.has(view);
    },
    /** Screens that have a React version, and which of them are on right now. */
    get state() {
      return { migrated: [...migrated], on: [...current.on].filter((v) => !disabled.has(v)), source: current.source, failed: [...disabled] };
    },
    /**
     * Per-browser switch for testing: levroReact.use("terms,privacy"), levroReact.use("all"),
     * levroReact.use("off"), levroReact.use(null) to return to the build default.
     */
    use(list: string | null) {
      writeOverride(list === null ? null : list.trim() || null);
      current = compute();
      return api.state;
    },
    /** Marks a screen as having a React version. Called by a screen's own module and by tests. */
    declare(view: string) {
      migrated.add(view);
      current = compute();
    },
    /** The React side calls this once it can draw screens. */
    attach(h: ReactViewHost) {
      host = h;
      readyResolve();
    },
    /** What the legacy router puts in #app for a screen that React will draw. */
    placeholderHtml(view: string): string {
      return `<div id="levro-react-root" data-react-view="${String(view).replace(/[^\w-]/g, "")}"></div>`;
    },
    /**
     * Draws the screen with React into the placeholder. Resolves true when it is on screen.
     * Resolves false, and turns the screen off for the rest of the session, when React is
     * late, throws, or the placeholder is gone; the caller then runs the legacy screen.
     */
    async mount(view: string, params: Record<string, unknown>): Promise<boolean> {
      try {
        const waited = await Promise.race([ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
        if (!waited || !host) throw new Error("React views are not ready");
        const container = document.getElementById("levro-react-root");
        if (!container) return false; // the user already moved on; nothing to draw
        mounted = true;
        await host.render(view, params || {}, container);
        return true;
      } catch (err) {
        console.warn(`[Levromart] React view "${view}" failed; using the legacy screen.`, err);
        disabled.add(view);
        api.unmount();
        return false;
      }
    },
    /** Releases the current React screen (effects, timers, realtime). Safe to call any time. */
    unmount() {
      if (!mounted) return;
      mounted = false;
      try {
        host?.unmount();
      } catch (err) {
        console.warn("[Levromart] React view unmount failed", err);
      }
    },
  };
  return api;
}

export type LevroReact = ReturnType<typeof createViewRegistry>;

declare global {
  interface Window {
    levroReact?: LevroReact;
  }
}

if (typeof window !== "undefined") {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const registry = createViewRegistry({
    migrated: MIGRATED_VIEWS,
    buildDefault: import.meta.env.VITE_REACT_VIEWS,
    storage,
    search: window.location.search,
    stripParam() {
      const url = new URL(window.location.href);
      url.searchParams.delete("react");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    },
  });
  window.levroReact = registry;
  window.addEventListener("pagehide", () => registry.unmount());
}
