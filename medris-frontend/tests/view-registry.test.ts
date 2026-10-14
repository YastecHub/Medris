import { describe, expect, it, vi } from "vitest";
import {
  REACT_VIEWS_OVERRIDE_KEY,
  createViewRegistry,
  parseViewList,
  resolveOn,
  type RegistryDeps,
  type ReactViewHost,
} from "../src/bridge/view-registry.ts";

/**
 * The view registry (src/bridge/view-registry.ts): which migrated screens are switched on,
 * from the build default, the per-browser override and the ?react= link helper.
 */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function make(over: Partial<RegistryDeps> = {}) {
  const storage = memoryStorage();
  const stripParam = vi.fn();
  const registry = createViewRegistry({ migrated: ["terms", "privacy"], buildDefault: undefined, storage, search: "", stripParam, ...over });
  return { registry, storage, stripParam };
}

describe("parseViewList / resolveOn", () => {
  it("treats empty as 'no list given'", () => {
    expect(parseViewList("")).toBeNull();
    expect(parseViewList(undefined)).toBeNull();
    expect(parseViewList(" , ")).toBeNull();
  });
  it("understands all, off/none and names", () => {
    expect(parseViewList("ALL")).toEqual({ kind: "all" });
    expect(parseViewList("terms, off")).toEqual({ kind: "off" });
    expect(parseViewList("none")).toEqual({ kind: "off" });
    expect(parseViewList("terms, privacy")).toEqual({ kind: "some", names: new Set(["terms", "privacy"]) });
  });
  it("only switches on screens that have a React version", () => {
    expect([...resolveOn(parseViewList("terms,home"), ["terms", "privacy"])]).toEqual(["terms"]);
    expect([...resolveOn(parseViewList("all"), ["terms", "privacy"])]).toEqual(["terms", "privacy"]);
    expect(resolveOn(null, ["terms"]).size).toBe(0);
    expect(resolveOn(parseViewList("off"), ["terms"]).size).toBe(0);
  });
});

describe("isOn: everything is OFF by default", () => {
  it("nothing is on with no build default, no override and no link", () => {
    const { registry } = make();
    expect(registry.isOn("terms")).toBe(false);
    expect(registry.isOn("home")).toBe(false);
    expect(registry.state).toMatchObject({ migrated: ["terms", "privacy"], on: [], source: "none" });
  });
  it("a screen without a React version is never on, even when asked for by name or 'all'", () => {
    const { registry } = make({ buildDefault: "home,all" });
    expect(registry.isOn("home")).toBe(false);
    expect(registry.isOn("terms")).toBe(true);
  });
  it("with an empty migrated list (today) nothing can be switched on at all", () => {
    const { registry } = make({ migrated: [], buildDefault: "all", search: "?react=all" });
    expect(registry.isOn("terms")).toBe(false);
    expect(registry.state.on).toEqual([]);
  });
});

describe("switches", () => {
  it("build default turns screens on", () => {
    const { registry } = make({ buildDefault: "terms" });
    expect(registry.isOn("terms")).toBe(true);
    expect(registry.isOn("privacy")).toBe(false);
    expect(registry.state.source).toBe("build");
  });
  it("the stored override beats the build default, and 'off' beats 'all'", () => {
    const stored = memoryStorage({ [REACT_VIEWS_OVERRIDE_KEY]: "off" });
    const { registry } = make({ buildDefault: "all", storage: stored });
    expect(registry.isOn("terms")).toBe(false);
    expect(registry.state.source).toBe("link/browser");
  });
  it("?react= is stored and removed from the address bar", () => {
    const { registry, storage, stripParam } = make({ search: "?react=privacy&x=1" });
    expect(registry.isOn("privacy")).toBe(true);
    expect(registry.isOn("terms")).toBe(false);
    expect(storage.data.get(REACT_VIEWS_OVERRIDE_KEY)).toBe("privacy");
    expect(stripParam).toHaveBeenCalledTimes(1);
  });
  it("?react=off stores 'off' (so it also beats a build default of 'all')", () => {
    const { registry, storage } = make({ buildDefault: "all", search: "?react=off" });
    expect(registry.isOn("terms")).toBe(false);
    expect(storage.data.get(REACT_VIEWS_OVERRIDE_KEY)).toBe("off");
  });
  it("an empty ?react= clears the override", () => {
    const stored = memoryStorage({ [REACT_VIEWS_OVERRIDE_KEY]: "terms" });
    const { registry } = make({ buildDefault: "privacy", storage: stored, search: "?react=" });
    expect(registry.isOn("terms")).toBe(false);
    expect(registry.isOn("privacy")).toBe(true);
  });
  it("use() switches at once and use(null) returns to the build default", () => {
    const { registry, storage } = make({ buildDefault: "terms" });
    registry.use("privacy");
    expect(registry.isOn("privacy")).toBe(true);
    expect(registry.isOn("terms")).toBe(false);
    registry.use(null);
    expect(storage.data.has(REACT_VIEWS_OVERRIDE_KEY)).toBe(false);
    expect(registry.isOn("terms")).toBe(true);
  });
  it("works when storage throws (private mode): the choice lasts for the page", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { registry } = make({ storage: broken, search: "?react=terms" });
    expect(registry.isOn("terms")).toBe(true);
    registry.use(null);
    expect(registry.isOn("terms")).toBe(false);
  });
  it("works with no storage at all", () => {
    const { registry } = make({ storage: null, buildDefault: "terms" });
    expect(registry.isOn("terms")).toBe(true);
  });
});

describe("placeholder, mount and fallback", () => {
  it("the placeholder carries only a safe screen name", () => {
    const { registry } = make();
    expect(registry.placeholderHtml("terms")).toBe('<div id="levro-react-root" data-react-view="terms"></div>');
    expect(registry.placeholderHtml('x"><script>')).not.toContain("<script");
  });

  function fakeDom(hasRoot: boolean) {
    const container = {} as HTMLElement;
    vi.stubGlobal("document", { getElementById: (id: string) => (hasRoot && id === "levro-react-root" ? container : null) });
    return container;
  }

  it("mounts through the attached host and unmounts it once", async () => {
    const container = fakeDom(true);
    const { registry } = make({ buildDefault: "terms" });
    const host: ReactViewHost = { render: vi.fn(async () => {}), unmount: vi.fn() };
    registry.attach(host);
    expect(await registry.mount("terms", { a: 1 })).toBe(true);
    expect(host.render).toHaveBeenCalledWith("terms", { a: 1 }, container);
    registry.unmount();
    registry.unmount();
    expect(host.unmount).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("a screen that throws is switched off for the session and reports false (legacy takes over)", async () => {
    fakeDom(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = make({ buildDefault: "terms" });
    const host: ReactViewHost = { render: vi.fn(async () => { throw new Error("boom"); }), unmount: vi.fn() };
    registry.attach(host);
    expect(await registry.mount("terms", {})).toBe(false);
    expect(registry.isOn("terms")).toBe(false);
    expect(registry.state.failed).toEqual(["terms"]);
    expect(host.unmount).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to legacy when React never becomes ready", async () => {
    fakeDom(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = make({ buildDefault: "terms", timeoutMs: 20 });
    expect(await registry.mount("terms", {})).toBe(false);
    expect(registry.isOn("terms")).toBe(false);
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("draws nothing when the placeholder is already gone (the user moved on)", async () => {
    fakeDom(false);
    const { registry } = make({ buildDefault: "terms" });
    const host: ReactViewHost = { render: vi.fn(async () => {}), unmount: vi.fn() };
    registry.attach(host);
    expect(await registry.mount("terms", {})).toBe(false);
    expect(host.render).not.toHaveBeenCalled();
    expect(registry.isOn("terms")).toBe(true); // not a failure, so it stays on
    vi.unstubAllGlobals();
  });
});
