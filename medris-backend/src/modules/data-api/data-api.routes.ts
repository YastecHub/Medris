import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { jsonResponse } from "../../shared/openapi/schemas.js";

const tags = ["Data API"];

export const DataApiInfo = z.object({
  ready: z.boolean().openapi({ description: "PostgREST is running and connected. The app sends its table queries here only when true." }),
  url: z.string(),
});

export const dataApiInfo = defineRoute({
  method: "get",
  path: "/data-api",
  tags,
  summary: "The data API (the app's table queries)",
  description: [
    "`/rest/v1/*` on this server is PostgREST - the same server Supabase runs behind its `/rest/v1` - on the same database,",
    "with the same roles and row-level security. The app's `sb.from()` queries go there instead of Supabase when `ready` is true.",
    "Query language: https://docs.postgrest.org/en/v12/references/api.html",
  ].join("\n"),
  security: [],
  responses: { 200: jsonResponse(DataApiInfo, "Whether the data API is ready.") },
});
