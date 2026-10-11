import type { RouteConfig } from "@asteasolutions/zod-to-openapi";
import { defineRoute } from "../http/route.js";
import { z } from "./zod.js";

/**
 * Documentation helpers for the original endpoints (/api/notify, /api/chat,
 * ...). Their controllers keep the historic, hand-written request handling,
 * so these definitions are registered for the OpenAPI document only
 * (routes/docs.ts) and never validate a request.
 */

export const LegacyErrorSchema = z.object({ error: z.string().openapi({ example: "accessToken is required" }) }).openapi("LegacyError");

const AnyObject = z.looseObject({});

export const accessToken = z.string().openapi({ description: "The user's Supabase access token." });

export interface LegacyRouteInput {
  method: "get" | "post" | "put" | "delete";
  path: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  query?: z.ZodObject;
  security?: RouteConfig["security"];
  /** Status -> description, or [description, schema] for a documented body. Errors default to LegacyError. */
  responses: Record<number, string | [string, z.ZodType]>;
  /** Non-JSON success content type (images, HTML). */
  produces?: string;
}

export function legacyRoute(input: LegacyRouteInput) {
  const responses: RouteConfig["responses"] = {};
  for (const [code, value] of Object.entries(input.responses)) {
    const status = Number(code);
    const [description, schema] = typeof value === "string" ? [value, status >= 400 ? LegacyErrorSchema : AnyObject] : value;
    if (status === 302 || status === 204) responses[status] = { description };
    else if (input.produces && status < 300) responses[status] = { description, content: { [input.produces]: { schema: z.string() } } };
    else responses[status] = { description, content: { "application/json": { schema } } };
  }
  return defineRoute({
    method: input.method,
    path: input.path,
    tags: ["Original endpoints"],
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    security: input.security ?? [],
    request: {
      ...(input.body ? { body: { required: true, content: { "application/json": { schema: input.body } } } } : {}),
      ...(input.query ? { query: input.query } : {}),
    },
    responses,
  });
}
