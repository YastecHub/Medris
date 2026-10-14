import { Component, StrictMode, Suspense, lazy, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VIEW_LOADERS, type ViewModule, type ViewProps } from "@/views";

/**
 * The React side of the view registry (src/bridge/view-registry.ts).
 *
 * The legacy router (navigate) puts an empty #levro-react-root into #app, then asks the
 * registry to draw a screen there. Roots are created on that placeholder, never on #app
 * itself, so legacy code that replaces #app's HTML cannot break React, and unmount() leaves
 * nothing behind. If a screen throws, the error boundary reports it and the registry runs
 * the legacy screen instead.
 */
class ViewErrorBoundary extends Component<{ onError(err: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const lazyViews = new Map<string, ComponentType<ViewProps>>();

function viewComponent(view: string): ComponentType<ViewProps> {
  const known = lazyViews.get(view);
  if (known) return known;
  const loader = VIEW_LOADERS[view];
  if (!loader) throw new Error(`No React screen is registered for "${view}"`);
  const component = lazy<ComponentType<ViewProps>>(loader as () => Promise<ViewModule>);
  lazyViews.set(view, component);
  return component;
}

let root: Root | null = null;

/** Draws `view` into `container`. Rejects if the screen cannot be loaded or crashes while drawing. */
export function renderView(view: string, params: Record<string, unknown>, container: HTMLElement): Promise<void> {
  releaseView();
  const View = viewComponent(view);
  return new Promise<void>((resolve, reject) => {
    // Resolve once the screen has committed to the DOM, so the legacy router can carry on
    // (scroll, focus, history) with the real page on screen.
    const Done = () => {
      queueMicrotask(resolve);
      return null;
    };
    root = createRoot(container);
    root.render(
      <StrictMode>
        <ViewErrorBoundary onError={reject}>
          <Suspense fallback={null}>
            <View params={params} />
            <Done />
          </Suspense>
        </ViewErrorBoundary>
      </StrictMode>,
    );
  });
}

export function releaseView(): void {
  root?.unmount();
  root = null;
}

/** Called once from main.tsx: tells the registry that React can draw screens. */
export function attachReactViews(): void {
  window.levroReact?.attach({ render: renderView, unmount: releaseView });
}
