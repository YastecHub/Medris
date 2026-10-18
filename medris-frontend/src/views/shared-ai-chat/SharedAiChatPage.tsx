import { Fragment, useEffect, useState } from "react";
import { loadSharedChat, type SharedMessage } from "@/services/shared-ai-chat";
import { legacyState } from "@/views/legacy-globals";
import type { ViewProps } from "@/views";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * A chat shared from Levi (read-only, opened from a `?share=` link), drawn by React.
 *
 * Converted one-to-one from renderSharedAiChat() (…/js/01-app/86-floating-ai-chat-draggable.js:180): same markup and classes, same states
 * (the "This chat link is no longer available." card), same request (see src/services/shared-ai-chat.ts), same date separators
 * (chatMessagesWithDatesHtml), same clean-up of Levi's hidden tags in an answer. The tag parsers, the date labels and the logo are the
 * app's own (legacy-globals.ts), not copied. All text is rendered by React, so it is escaped.
 *
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-shared-ai-chat.spec.ts) fails if they drift apart.
 */
type Fn = (...args: unknown[]) => unknown;
const call = (name: string, ...args: unknown[]) => (window as unknown as Record<string, Fn>)[name]?.(...args);
/**
 * The old buttons carry their action as an inline `onclick` attribute, and a few old style rules are keyed on it (e.g. a small button whose onclick
 * is navigate('home') is styled as a grey "back" button: assets/css/03-pages.css:2369). So the attribute is put on the element, as the
 * old markup had it, and it is the button's only handler.
 */
const inlineClick = (code: string) => (el: HTMLElement | null) => {
  if (el && !el.hasAttribute("onclick")) el.setAttribute("onclick", code);
};
const textOf = (r: unknown) => String((r as { text?: unknown } | null)?.text ?? "");

/** What the old code shows of an answer: Levi's hidden navigation / draft / cart tags are removed. */
function visibleText(m: SharedMessage): string {
  if (m.role !== "assistant") return m.content;
  const noNav = textOf(call("parseAiNavTag", m.content));
  const noDraft = textOf(call("parseAiDraftMsgTag", noNav));
  const noAdd = textOf(call("parseAiAddCartTags", noDraft));
  return textOf(call("parseAiRemoveCartTags", noAdd));
}

export default function SharedAiChatPage({ params }: ViewProps) {
  const token = String(params.token ?? "");
  const [rows, setRows] = useState<SharedMessage[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadSharedChat(token).then(
      (result) => !cancelled && setRows(result),
      () => !cancelled && setRows(null),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (rows === undefined) return null; // the old page shows nothing while it loads
  if (rows === null) {
    return (
      <>
        <div className="empty-state">
          <i className="fa-solid fa-link-slash"></i> This chat link is no longer available.
        </div>
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button className="btn btn-sm" ref={inlineClick("navigate('home')")}>
            Go to Levromart
          </button>
        </div>
      </>
    );
  }

  let lastKey: string | null = null;
  return (
    <>
      <div className="flex" style={{ alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <img src={legacyState.medrisLogo()} alt="" style={{ width: "2.2rem", height: "2.2rem", borderRadius: "50%" }} />
        <div>
          <strong>{rows[0]!.title || "Shared chat"}</strong>
          <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
            Shared conversation with Levi · read-only
          </p>
        </div>
      </div>
      <div className="card shared-ai-chat">
        {rows.map((m, i) => {
          const key = String(call("chatDateKey", m.created_at));
          const separator = key !== lastKey;
          lastKey = key;
          return (
            <Fragment key={i}>
              {separator ? <div className="conv-date-sep">{String(call("chatDateLabel", m.created_at))}</div> : null}
              <div className={`ai-chat-msg ${m.role === "user" ? "user" : "assistant"}`} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start" }}>
                {visibleText(m)}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <button className="btn btn-sm" ref={inlineClick("navigate('home')")}>
          <i className="fa-solid fa-arrow-right"></i> Try Levromart
        </button>
      </div>
    </>
  );
}
