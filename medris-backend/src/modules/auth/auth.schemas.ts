import { z } from "../../shared/openapi/zod.js";

/** Request and response shapes of /api/v1/auth. */

export const SessionInfoSchema = z
  .object({
    authenticated: z.boolean(),
    userId: z.string().nullable(),
    method: z.enum(["bearer", "cookie"]).nullable(),
    source: z.enum(["supabase-jwt", "backend-session"]).nullable(),
    backendSessionsEnabled: z.boolean(),
  })
  .openapi("SessionInfo");

export const LoginBody = z
  .object({
    identifier: z.string().trim().min(3).max(254).openapi({ description: "E-mail address or phone number.", example: "ada@example.com" }),
    password: z.string().min(1).max(256).openapi({ format: "password" }),
  })
  .openapi("LoginRequest");

export const LoginResult = z.object({ userId: z.string(), expiresAt: z.string() }).openapi("LoginResult");

export const LogoutAllResult = z.object({ revoked: z.number().int().min(0) });

export const GoogleStartQuery = z.object({
  returnTo: z.string().max(512).optional().openapi({ description: "Same-site path to return to after sign-in.", example: "/orders" }),
});

export const GoogleCallbackQuery = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
});
