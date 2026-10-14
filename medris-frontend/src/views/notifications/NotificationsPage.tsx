import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLegacySession } from "@/hooks/useLegacySession";
import { loadNotifications, readCachedNotifications, reusableRaw, type NotificationRow } from "@/services/notifications";
import { classifyNotification, type NotificationCategory } from "@/views/notifications/classify";
import { CachedRow, LiveRow, MessageSummary, SelectBar, Tabs, type TabDef } from "@/views/notifications/parts";
import { legacy, legacyState, notifState } from "@/views/legacy-globals";

/**
 * The Notifications page, drawn by React.
 *
 * Converted from renderNotificationsPage() (…/js/01-app/29-dedicated-notifications-page.js) and the list it fills in,
 * renderNotifPanel() (…/js/01-app/20-notifications-real-persisted-realtime.js:143, with its two wrappers in 09-part.js:36
 * and 06-part.js:645): same page frame, same ids the legacy code looks for (#notificationsPage, #notificationsPageHeaderActions),
 * same instant first paint from the saved copy, same live list, tabs with unread badges, grouping of messages from one chat,
 * select mode, empty and error messages.
 *
 * What stays legacy, on purpose: everything that CHANGES something. Opening a row, switching tabs, entering/leaving select mode,
 * "mark read/unread", the read-queue that is committed when you leave the page, realtime, the bell counter and the cached
 * unread numbers are the app's own functions, called from here exactly as the old markup called them. React only draws.
 *
 * The bridge: the legacy code redraws the panel by calling window.renderNotifPanel(). While this page is on screen that
 * function is replaced by one that asks React to redraw (and is put back when the page is left), so the legacy code can never
 * write HTML into the DOM React owns. React redraws from the same data and from the legacy UI state (tab, selection).
 *
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-notifications.spec.ts) fails if they drift apart.
 */

interface Request {
  n: number;
  opts?: { reuse?: boolean };
}

type Paint =
  | { kind: "blank" }
  | { kind: "signedOut" }
  | { kind: "cached"; rows: NotificationRow[] }
  | { kind: "error" }
  | { kind: "crash" }
  | { kind: "live"; items: NotificationRow[]; raw: NotificationRow[]; owners: Map<string, string> };

const tabsFor = (): TabDef[] => {
  const vendorId = legacyState.vendorId();
  return [
    ["all", "All"],
    ["personal", "Personal"],
    ...(legacyState.role() !== "admin" ? ([["orders", vendorId ? "Orders & Requests" : "Orders"]] as TabDef[]) : []),
    ...(vendorId ? ([["myListings", "My Listings"]] as TabDef[]) : []),
    ["vendors", "Vendors"],
  ];
};

const EMPTY_TEXT = (mode: string): string =>
  (
    {
      all: "You're all caught up.",
      personal: "No personal notifications yet.",
      orders: legacyState.vendorId() ? "No order or request activity yet." : "No order activity yet.",
      myListings: "No activity on your listings yet.",
      vendors: "No vendor activity yet.",
    } as Record<string, string>
  )[mode] || "You're all caught up.";

/** Messages from one chat (two or more, not while selecting) become one summary row at the place of the first. */
function groupMessages(items: NotificationRow[]): Array<{ row: NotificationRow } | { group: NotificationRow[]; conversationId: string }> {
  const conv = (n: NotificationRow): string | null => {
    const id = (n.target_params as Record<string, unknown> | null | undefined)?.conversationId;
    return (n.target_view || "home") === "messages" && id ? String(id) : null;
  };
  const groups = new Map<string, NotificationRow[]>();
  items.forEach((n) => {
    const c = conv(n);
    if (c) groups.set(c, [...(groups.get(c) || []), n]);
  });
  const seen = new Set<string>();
  const out: Array<{ row: NotificationRow } | { group: NotificationRow[]; conversationId: string }> = [];
  for (const n of items) {
    const c = conv(n);
    const g = c ? groups.get(c)! : null;
    if (c && g && g.length >= 2) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push({ group: g, conversationId: c });
      }
    } else out.push({ row: n });
  }
  return out;
}

export default function NotificationsPage() {
  const { session } = useLegacySession();
  const userId = session?.user?.id ?? null;
  const [paint, setPaint] = useState<Paint>({ kind: "blank" });
  const [version, setVersion] = useState(0); // a new value rebuilds the list from scratch, like the legacy innerHTML swap
  const [request, setRequest] = useState<Request>({ n: 1 });
  const selecting = useRef(false);
  const lastRun = useRef("");

  // The bridge (see the header comment).
  useEffect(() => {
    const original = window.renderNotifPanel;
    const bridge = (opts?: unknown): Promise<void> => {
      setRequest((r) => ({ n: r.n + 1, opts: opts as Request["opts"] }));
      return Promise.resolve();
    };
    window.renderNotifPanel = bridge;
    return () => {
      if (window.renderNotifPanel === bridge) window.renderNotifPanel = original;
    };
  }, []);

  // One pass of renderNotifPanel(): the instant paint, then the live list.
  useEffect(() => {
    const runKey = `${request.n}:${userId ?? ""}`; // a new request, or the session arriving later, starts a pass
    if (runKey === lastRun.current) return;
    lastRun.current = runKey;
    const token = notifState.nextEpoch();
    const stale = () => token !== notifState.epoch();
    if (!userId) {
      setPaint({ kind: "signedOut" });
      setVersion((v) => v + 1);
      return;
    }
    (async () => {
      try {
        const tabs = tabsFor();
        if (!tabs.some(([key]) => key === notifState.viewMode())) notifState.setViewMode("all");
        const reuse = request.opts?.reuse ? reusableRaw(userId) : null;
        if (!reuse) {
          const cached = readCachedNotifications(userId);
          setPaint(cached.length ? { kind: "cached", rows: cached } : { kind: "blank" });
          setVersion((v) => v + 1);
        }
        const { items: raw, owners, error } = await loadNotifications(userId, reuse);
        if (!tabsFor().some(([key]) => key === notifState.viewMode())) notifState.setViewMode("all");
        if (stale()) return;
        if (error) {
          window.__notifPanelIds = [];
          selecting.current = false;
          setPaint({ kind: "error" });
          setVersion((v) => v + 1);
          return;
        }
        const mode = notifState.viewMode();
        const vendorId = legacyState.vendorId();
        const items = raw.filter((n) => mode === "all" || classifyNotification(n, owners, vendorId) === mode);
        window.__notifPanelIds = items.map((n) => n.id);
        selecting.current = notifState.selectMode();
        setPaint({ kind: "live", items, raw, owners });
        setVersion((v) => v + 1);
      } catch (err) {
        console.error("Notification rendering failed", err);
        if (stale()) return;
        window.__notifPanelIds = [];
        setPaint({ kind: "crash" });
        setVersion((v) => v + 1);
      }
    })();
  }, [request, userId]);

  // After each paint the legacy code remembers the unread rows that are on screen (committed when the page is left),
  // and clears the header actions area on the live list.
  useLayoutEffect(() => {
    if (paint.kind === "cached" || paint.kind === "blank") legacy("queueVisibleNotificationReads")();
    if (paint.kind === "live") {
      // The legacy code does this BEFORE it folds chats into one row, so every unread notification of the current tab is
      // remembered, grouped ones included. Do the same by queueing from the data instead of from the (folded) page.
      if (legacyState.userId()) paint.items.filter((n) => !n.read).forEach((n) => void legacy("queueNotificationRead")(n.id));
      const actions = legacy("byId")("notificationsPageHeaderActions");
      if (actions) actions.innerHTML = "";
    }
  }, [paint, version]);

  const back = notifState.backTarget();
  const mode = notifState.viewMode();
  const tabs = tabsFor();

  let content: React.ReactNode = null;
  if (paint.kind === "signedOut") content = <p className="muted">Sign in to view your notifications.</p>;
  else if (paint.kind === "cached") {
    content = (
      <>
        <Tabs tabs={tabs} mode={mode} />
        {paint.rows.map((n) => (
          <CachedRow key={n.id} n={n} />
        ))}
      </>
    );
  } else if (paint.kind === "error") {
    content = (
      <>
        <div className="notifications-page-tools">
          <strong>Notifications</strong>
        </div>
        <div className="notif-tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={`notif-tab ${mode === key ? "active" : ""}`} onClick={() => void legacy("switchNotifView")(key)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ padding: "1rem", textAlign: "center" }}>
          Couldn’t load notifications right now. Please try again.
        </p>
      </>
    );
  } else if (paint.kind === "crash") {
    content = (
      <p className="muted">
        Couldn’t load notifications right now.{" "}
        <button type="button" className="btn btn-outline" onClick={() => void window.renderNotifPanel?.()}>
          Try again
        </button>
      </p>
    );
  } else if (paint.kind === "live") {
    const vendorId = legacyState.vendorId();
    const counts: Record<string, number> = { personal: 0, orders: 0, myListings: 0, vendors: 0 };
    paint.raw.forEach((n) => {
      if (!n.read) {
        const c: NotificationCategory = classifyNotification(n, paint.owners, vendorId);
        if (c in counts) counts[c] = (counts[c] || 0) + 1;
      }
    });
    counts.all = paint.raw.filter((n) => !n.read).length;
    const selectMode = notifState.selectMode();
    const entries = selectMode ? paint.items.map((row) => ({ row })) : groupMessages(paint.items);
    content = (
      <>
        {selectMode ? <SelectBar panelIds={window.__notifPanelIds || []} /> : <Tabs tabs={tabs} mode={mode} counts={counts} />}
        <div className="notif-list-scroll">
          {paint.items.length ? (
            entries.map((e) => ("row" in e ? <LiveRow key={e.row.id} n={e.row} /> : <MessageSummary key={`g-${e.conversationId}`} rows={e.group} conversationId={e.conversationId} />))
          ) : (
            <p className="muted" style={{ padding: "0.4rem" }}>
              {EMPTY_TEXT(mode)}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="notifications-page-shell">
      <div className="notifications-page-heading">
        <button type="button" className="icon-btn notifications-page-back" onClick={() => window.navigate?.(back.view, back.params)} aria-label="Back">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <div className="notifications-page-heading-copy">
          <h2>
            <i className="fa-solid fa-bell"></i> Notifications
          </h2>
          <p className="muted">Stay up to date with activity on Levromart.</p>
        </div>
        <div id="notificationsPageHeaderActions" className="notifications-page-heading-actions"></div>
      </div>
      <div id="notificationsPage" className={"notifications-page-host" + (selecting.current ? " selecting" : "")} aria-live="polite">
        <Fragment key={version}>{content}</Fragment>
      </div>
    </div>
  );
}
