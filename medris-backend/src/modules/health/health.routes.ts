import { defineRoute } from "../../shared/http/route.js";
import { jsonResponse } from "../../shared/openapi/schemas.js";
import { LiveSchema, ReadySchema } from "./health.schemas.js";

/** Probes. Served before authentication, so they never need a token. */

const tags = ["Health"];

export const live = defineRoute({
  method: "get",
  path: "/health/live",
  tags,
  summary: "The process is up",
  description: "No dependencies are checked.",
  security: [],
  responses: { 200: jsonResponse(LiveSchema, "Up.") },
});

export const ready = defineRoute({
  method: "get",
  path: "/health/ready",
  tags,
  summary: "The database answers and the API roles are usable",
  description: "`ok` needs the login role to be able to switch to anon, authenticated and service_role.",
  security: [],
  responses: {
    200: jsonResponse(ReadySchema, "Ready."),
    503: jsonResponse(ReadySchema, "Not ready (database not configured, unreachable or missing a role)."),
  },
});
