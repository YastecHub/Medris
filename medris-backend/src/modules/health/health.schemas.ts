import { z } from "../../shared/openapi/zod.js";

/** Health check bodies (not wrapped in `{ data }`, so probes can read them directly). */

export const LiveSchema = z.object({ status: z.literal("ok") }).openapi("Liveness");

export const ReadySchema = z
  .object({
    status: z.enum(["ok", "degraded", "unavailable"]),
    checks: z.object({
      databaseConfigured: z.boolean(),
      supabaseAuthConfigured: z.boolean(),
      backendSessions: z.enum(["enabled", "disabled"]),
      database: z
        .union([
          z.object({
            reachable: z.literal(true),
            latencyMs: z.number(),
            roles: z.object({ anon: z.boolean(), authenticated: z.boolean(), service_role: z.boolean() }),
          }),
          z.object({ reachable: z.literal(false) }),
        ])
        .optional(),
    }),
  })
  .openapi("Readiness", { description: "Contains no configuration values or error details." });
