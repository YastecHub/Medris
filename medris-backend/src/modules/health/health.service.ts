import type { AppConfig } from "../../config/app-config.js";
import type { DataContext } from "../../database/context.js";
import type { Logger } from "../../lib/logger.js";

export interface Readiness {
  status: "ok" | "degraded" | "unavailable";
  checks: {
    databaseConfigured: boolean;
    supabaseAuthConfigured: boolean;
    backendSessions: "enabled" | "disabled";
    database?: { reachable: true; latencyMs: number; roles: { anon: boolean; authenticated: boolean; service_role: boolean } } | { reachable: false };
  };
}

/** Liveness and readiness. Results never contain configuration values or error details. */
export class HealthService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: () => DataContext,
  ) {}

  live(): { status: "ok" } {
    return { status: "ok" };
  }

  async ready(logger: Logger): Promise<Readiness> {
    const { config } = this;
    const checks: Readiness["checks"] = {
      databaseConfigured: Boolean(config.database.url),
      supabaseAuthConfigured: Boolean(config.supabase.url && config.supabase.anonKey),
      backendSessions: config.auth.backendSessions ? "enabled" : "disabled",
    };
    if (!config.database.url) return { status: "unavailable", checks };
    try {
      const probe = await this.db().probe();
      checks.database = { reachable: true, latencyMs: probe.latencyMs, roles: probe.roles };
      return { status: probe.ok ? "ok" : "degraded", checks };
    } catch (err) {
      logger.error("readiness check failed", { err });
      checks.database = { reachable: false };
      return { status: "unavailable", checks };
    }
  }
}
