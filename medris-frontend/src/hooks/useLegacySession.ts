import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Session, profile and vendor for React screens, read from the legacy runtime.
 *
 * The legacy app owns authentication: it keeps `session`, `profile` and `vendor` in global
 * variables and refreshes them through one Supabase client, `sb`. React screens must use
 * that same client and state (a second client would mean a second session and duplicate
 * realtime channels), so these hooks only READ the globals and re-render when they change.
 * Free identifiers in a module resolve to the legacy scripts' global bindings, exactly like
 * `sb` in src/bridge/data-gateway.ts.
 */
declare const sb: SupabaseClient;
declare const session: LegacySession | null;
declare const profile: LegacyProfile | null;
declare const vendor: LegacyVendor | null;

export interface LegacySession {
  user?: { id: string; email?: string };
  [key: string]: unknown;
}
/** Row of public.users for the signed-in user (only the columns screens rely on are typed). */
export interface LegacyProfile {
  id: string;
  role?: "buyer" | "vendor" | "admin" | string;
  full_name?: string | null;
  suspended_at?: string | null;
  [key: string]: unknown;
}
/** Row of public.vendors for the signed-in user, when they have one. */
export interface LegacyVendor {
  id: string;
  business_name?: string | null;
  [key: string]: unknown;
}

export interface LegacyAuthSnapshot {
  session: LegacySession | null;
  profile: LegacyProfile | null;
  vendor: LegacyVendor | null;
}

/** `typeof` never throws, even before the legacy script that declares the variable has run. */
export function readLegacyAuth(): LegacyAuthSnapshot {
  return {
    session: typeof session === "undefined" ? null : session,
    profile: typeof profile === "undefined" ? null : profile,
    vendor: typeof vendor === "undefined" ? null : vendor,
  };
}

const listeners = new Set<() => void>();
let installed = false;

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * The legacy code has no "profile is ready" event, but it calls updateAuthUI() whenever the
 * session, profile or vendor changed. Wrap it once (the legacy app does the same to its own
 * functions) and also listen to the existing client's auth events. No legacy file is edited.
 */
function installListeners() {
  if (installed) return;
  installed = true;
  const original = window.updateAuthUI;
  if (typeof original === "function") {
    window.updateAuthUI = function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  }
  try {
    sb.auth.onAuthStateChange(() => setTimeout(notify, 0));
  } catch {
    /* the legacy client is not ready; updateAuthUI still covers changes */
  }
}

function sameSnapshot(a: LegacyAuthSnapshot, b: LegacyAuthSnapshot): boolean {
  return a.session === b.session && a.profile === b.profile && a.vendor === b.vendor;
}

/** { session, profile, vendor } of the signed-in user (all null for a guest). */
export function useLegacySession(): LegacyAuthSnapshot {
  const [snapshot, setSnapshot] = useState<LegacyAuthSnapshot>(readLegacyAuth);
  useEffect(() => {
    installListeners();
    const update = () => setSnapshot((prev) => {
      const next = readLegacyAuth();
      return sameSnapshot(prev, next) ? prev : next;
    });
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return snapshot;
}

/** Just the profile row (null for a guest or while it is still loading). */
export function useProfile(): LegacyProfile | null {
  return useLegacySession().profile;
}

declare global {
  interface Window {
    updateAuthUI?: (...args: unknown[]) => unknown;
  }
}
