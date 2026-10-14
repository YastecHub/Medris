import type { MouseEvent, ReactNode } from "react";
import { legacy, notifState } from "@/views/legacy-globals";
import type { NotificationRow } from "@/services/notifications";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * Small pieces of the notifications page: avatars, icons, rows, tabs and the select bar. Markup and classes are the ones
 * the legacy renderNotifPanel() builds (src/legacy/assets/js/01-app/20-notifications-real-persisted-realtime.js:143), including
 * the differences between its instant "cached" paint and its live paint. Text and the icon/avatar rules are NOT copied: they
 * call the legacy helpers (timeAgo, maskSensitiveNumbers, initials, stableAvatarHue, notificationSystemIconHtml).
 * Text from the database is rendered by React (escaped).
 */

/** The coloured circle with initials shown for someone without a picture (avatarFallbackHtml). */
function FallbackAvatar({ name, size, extraClass, label, stableKey }: { name: string; size: string; extraClass: string; label: string; stableKey: string }) {
  const safeName = String(name || "User").trim() || "User";
  const title = label || safeName;
  const hue = legacy("stableAvatarHue")(stableKey || safeName);
  return (
    <span className={`avatar-circle avatar-fallback ${extraClass}`} title={title} aria-label={title} style={{ width: size, height: size, ["--av-h" as string]: hue }}>
      <span aria-hidden="true">{legacy("initials")(safeName)}</span>
    </span>
  );
}

/**
 * The type icon (notificationSystemIconHtml). Its output has no text from the database (only a Font Awesome name and a
 * colour looked up from the notification type), so it is read apart with an inert template and drawn as JSX.
 */
function SystemIcon({ n }: { n: NotificationRow }) {
  const tpl = document.createElement("template");
  tpl.innerHTML = legacy("notificationSystemIconHtml")(n).trim();
  const span = tpl.content.firstElementChild as HTMLElement | null;
  const icon = span?.querySelector("i");
  return (
    <span className={span?.className ?? "notification-system-icon notif-type-icon"} style={{ ["--nti" as string]: span?.style.getPropertyValue("--nti") ?? "" }}>
      <i className={icon?.className ?? "fa-solid fa-bell"}></i>
    </span>
  );
}

function Avatar({ n, size, cached }: { n: NotificationRow; size: string; cached: boolean }) {
  if (n.actor_avatar_url) {
    return cached ? (
      <img src={n.actor_avatar_url} className="avatar-circle" style={{ width: size, height: size, objectFit: "cover", flex: "none" }} alt="" draggable={false} />
    ) : (
      <img src={n.actor_avatar_url} className="avatar-circle" style={{ width: size, height: size, objectFit: "cover", flex: "none" }} />
    );
  }
  if (n.actor_name) return <FallbackAvatar name={n.actor_name} size={size} extraClass="notification-avatar-fallback" label={n.actor_name} stableKey={n.actor_id || n.actor_name} />;
  return <SystemIcon n={n} />;
}

function bodyText(n: NotificationRow): string {
  return n.notification_category === "new_follower" ? n.actor_name || n.body || "" : legacy("maskSensitiveNumbers")(n.body || "");
}

const onRowClick = (id: string) => (event: MouseEvent<HTMLButtonElement>) => void legacy("handleNotifItemClick")(event, id);

/** A row of the instant first paint from the saved copy of the last visit (no select mode, no checks). */
export function CachedRow({ n }: { n: NotificationRow }) {
  return (
    <div className="notif-item-wrap" data-id={n.id}>
      <button
        type="button"
        className={`notif-item ${n.read ? "" : "unread"}`}
        data-id={n.id}
        data-view={n.target_view || "home"}
        data-params={JSON.stringify(n.target_params || {})}
        data-actor-name={n.actor_name || ""}
        data-actor-avatar={n.actor_avatar_url || ""}
        onClick={onRowClick(n.id)}
      >
        <Avatar n={n} size="2.15rem" cached />
        <span className="notif-copy">
          <strong>{n.title || "Notification"}</strong>
          {n.body ? (
            <span className="muted" style={{ fontSize: ".8rem" }}>
              {bodyText(n)}
            </span>
          ) : null}
          <span className="muted" style={{ fontSize: ".72rem" }}>
            {legacy("timeAgo")(n.created_at)}
          </span>
        </span>
      </button>
    </div>
  );
}

/** A row of the live list (with the selection check while selecting). */
export function LiveRow({ n }: { n: NotificationRow }) {
  const selectMode = notifState.selectMode();
  const selected = selectMode && notifState.selectedIds().has(n.id);
  return (
    <div className="notif-item-wrap" data-id={n.id}>
      <button
        type="button"
        className={`notif-item ${n.read ? "" : "unread"} ${selected ? "selected" : ""}`}
        data-id={n.id}
        data-view={n.target_view || "home"}
        data-params={JSON.stringify(n.target_params || {})}
        data-actor-name={n.actor_name || ""}
        data-actor-avatar={n.actor_avatar_url || ""}
        aria-selected={selected ? "true" : "false"}
        onClick={onRowClick(n.id)}
      >
        {selectMode ? (
          <span className="notif-select-check">
            <i className="fa-solid fa-check"></i>
          </span>
        ) : null}
        <Avatar n={n} size="2.1rem" cached={false} />
        <span className="notif-copy">
          <strong style={{ display: "block" }}>{n.title}</strong>
          {n.body ? (
            <>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {bodyText(n)}
              </span>
              <br />
            </>
          ) : null}
          <span className="muted" style={{ fontSize: "0.72rem" }}>
            {legacy("timeAgo")(n.created_at)}
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * Several message notifications from one conversation shown as one compact row (the legacy "v4" post-processing of the
 * list, src/legacy/assets/js/06-part.js:645). Tapping it marks them all read, updates the bell counter and opens the chat.
 */
export function MessageSummary({ rows, conversationId }: { rows: NotificationRow[]; conversationId: string }) {
  const first = rows[0]!;
  const sender = first.actor_name || first.title || "Someone";
  const avatar = first.actor_avatar_url || "";
  const unread = rows.filter((r) => !r.read).length;
  const latest = (first.body ? bodyText(first) : legacy("timeAgo")(first.created_at)) || "New message";
  const ids = rows.map((r) => r.id).filter(Boolean);
  const onClick = async () => {
    if (ids.length) {
      await window.levroData!.notifications.setRead(ids, true);
      const next = Math.max(0, notifState.count() - unread);
      notifState.setCount(next);
      const dot = legacy("byId")("notifDot");
      if (dot) {
        if (next > 0) {
          dot.textContent = next > 9 ? "9+" : String(next);
          dot.classList.remove("hidden");
        } else dot.classList.add("hidden");
      }
    }
    legacy("closeAllPanels")();
    window.navigate?.("messages", { conversationId });
  };
  return (
    <div className="notif-item-wrap">
      <button type="button" className={"notif-message-summary" + (unread ? " unread" : "")} onClick={onClick}>
        {avatar ? <img className="notif-summary-avatar" src={avatar} alt="" /> : <span className="notif-summary-avatar">{legacy("initials")(sender)}</span>}
        <span className="notif-message-summary-copy">
          <span className="notif-message-summary-title">New message from {sender}</span>
          {unread > 1 ? <span className="notif-message-summary-count">{unread} new messages</span> : null}
          <span className="notif-message-summary-sub">{latest}</span>
        </span>
        <i className="fa-solid fa-chevron-right" style={{ color: "var(--text-muted)", fontSize: ".72rem" }}></i>
      </button>
    </div>
  );
}

export type TabDef = readonly [key: string, label: string];

/** The category tabs. `counts` (unread per tab) is missing on the instant first paint, as in the legacy code. */
export function Tabs({ tabs, mode, counts }: { tabs: TabDef[]; mode: string; counts?: Record<string, number> }) {
  return (
    <div className="notif-tabs" role="tablist" aria-label="Notification categories">
      {tabs.map(([key, label]) => {
        const count = counts ? Number(counts[key] || 0) : 0;
        return (
          <button key={key} type="button" role="tab" aria-selected={mode === key ? "true" : "false"} className={`notif-tab ${mode === key ? "active" : ""}`} onClick={() => void legacy("switchNotifView")(key)}>
            {label as ReactNode}
            {count ? <span className="notif-tab-badge">{count > 9 ? "9+" : count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The bar shown while selecting notifications (cancel, count, select/deselect all, mark read, mark unread). */
export function SelectBar({ panelIds }: { panelIds: string[] }) {
  const size = notifState.selectedIds().size;
  const all = size === panelIds.length;
  return (
    <div className="notif-select-bar">
      <button type="button" className="icon-btn" onClick={() => void legacy("exitNotifSelectMode")()} aria-label="Cancel selection">
        <i className="fa-solid fa-xmark"></i>
      </button>
      <strong>{size} selected</strong>
      <div className="notif-selection-actions">
        <button type="button" className="notif-action-btn" aria-label={all ? "Deselect all" : "Select all"} title={all ? "Deselect all" : "Select all"} onClick={() => void legacy("toggleSelectAllNotifs")()}>
          <i className={`fa-solid ${all ? "fa-square-minus" : "fa-square-check"}`}></i>
        </button>
        <button type="button" className="notif-action-btn notif-selection-action" title="Mark read" onClick={() => void legacy("batchMarkNotifsRead")(true)} disabled={!size}>
          <i className="fa-solid fa-envelope-open"></i>
        </button>
        <button type="button" className="notif-action-btn notif-selection-action" title="Mark unread" onClick={() => void legacy("batchMarkNotifsRead")(false)} disabled={!size}>
          <i className="fa-solid fa-envelope"></i>
        </button>
      </div>
    </div>
  );
}
