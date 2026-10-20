import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { optionalSignIn } from "../../shared/openapi/security.js";
import { RPC_NAMES } from "./rpc.dispatch.js";

/** The app's sb.rpc() calls, answered by the backend (see rpc.dispatch.ts). */

const tags = ["Database functions"];

export const RpcParams = z.object({
  name: z.enum(RPC_NAMES as [string, ...string[]]).openapi({ description: "The database function the app called with sb.rpc().", example: "get_vendor_stats" }),
});

export const callRpc = defineRoute({
  method: "post",
  path: "/rpc/{name}",
  tags,
  summary: "Run one of the app's database functions",
  description: [
    "Compatibility endpoint for the app's `sb.rpc(name, args)` calls during the switch to the backend.",
    "",
    "The body is the function's own arguments, by name (`{\"p_vendor_id\": \"...\"}`). The answer is `{ \"data\": <what the original returned> }`:",
    "a uuid as a string, a boolean, a JSON object, a list of rows, or `null` for a function that returns nothing.",
    "Each name runs the backend's port of that function (the same code as its own /api/v1 route), proven equal to the original by the parity suite.",
    "Errors keep the original's message, with an HTTP status instead of a database error code.",
  ].join("\n"),
  security: optionalSignIn,
  request: {
    params: RpcParams,
    body: jsonBody(z.record(z.string(), z.unknown()).openapi({ example: { p_vendor_id: "6f1c2a0e-8a4b-4c1e-9d2f-3b5a7c9e1f20" } }), "The function's arguments by name ({} for none)."),
  },
  responses: {
    200: dataResponse(z.unknown(), "What the original function returned."),
    ...errorResponses(400, 401, 403, 404, 409, 429),
    ...commonErrors,
  },
});
