import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";

/** Contract of /api/delete-account and its aliases (documentation; see accounts.controller.ts). */

const AccountActionBody = z
  .looseObject({
    action: z
      .enum(["account-exists", "check-email", "register", "ensure-profile", "delete", "delete-account", ""])
      .optional()
      .openapi({ description: "No action (or `delete`) deletes the caller's account; an unknown action is refused." }),
    email: z.string().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    password: z.string().optional(),
    role: z.enum(["buyer", "vendor"]).optional(),
    city: z.string().optional(),
    referral_code: z.string().optional(),
    accessToken: accessToken.optional(),
  })
  .openapi("AccountActionRequest");

const getModes = z.object({
  turn: z.literal("1").optional().openapi({ description: "ICE servers for calls (JSON)." }),
  nicon: z.literal("1").optional().openapi({ description: "Notification picture (PNG) from `u`, `n`, `k`." }),
  ogstore: z.string().optional().openapi({ description: "Share card (PNG) of a storefront." }),
  ogprod: z.string().optional().openapi({ description: "Share card (PNG) of a product." }),
  ogpkg: z.string().optional().openapi({ description: "Share card (PNG) of a package." }),
  storefront: z.string().optional().openapi({ description: "Link-preview HTML of a storefront." }),
  product: z.string().optional().openapi({ description: "Link-preview HTML of a product." }),
  package: z.string().optional().openapi({ description: "Link-preview HTML of a package." }),
});

export const accountsDocs = [
  legacyRoute({
    method: "post",
    path: "/delete-account",
    summary: "Account actions: check, register, ensure profile, delete",
    description:
      "Also served as /api/register and /api/account-exists. `register` creates the Supabase Auth user and the profile (201); " +
      "`ensure-profile` and delete need `accessToken`. Deleting a vendor with unsettled commission is refused.",
    body: AccountActionBody,
    responses: { 200: "Done.", 201: "Account created.", 400: "Missing or invalid input, or unknown action.", 401: "Invalid session.", 409: "Already registered.", 500: "Server error." },
  }),
  legacyRoute({
    method: "get",
    path: "/delete-account",
    summary: "Call ICE servers, notification pictures, share cards and link previews",
    description: "Which one depends on the query parameter present (checked in this order: turn, nicon, og*, else link preview).",
    query: getModes,
    produces: "text/html",
    responses: { 200: "JSON, PNG or HTML depending on the mode.", 302: "Image fallback redirect." },
  }),
  legacyRoute({ method: "get", path: "/turn", summary: "ICE servers for calls", responses: { 200: "ICE server list.", 405: "Only GET." } }),
  legacyRoute({
    method: "get",
    path: "/notif-icon",
    summary: "Notification picture (PNG)",
    query: z.object({ u: z.string().optional(), n: z.string().optional(), k: z.string().optional() }),
    produces: "image/png",
    responses: { 200: "The picture.", 302: "Fallback image." },
  }),
];
