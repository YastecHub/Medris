import { defineRoute } from "../../shared/http/route.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";
import { MeSchema } from "./users.schemas.js";

export const getMe = defineRoute({
  method: "get",
  path: "/me",
  tags: ["Account"],
  summary: "The signed-in user's profile",
  description: "public.users, read through RLS as the user.",
  security: signedIn,
  middleware: [requireUser] as const,
  responses: { 200: dataResponse(MeSchema, "The profile."), ...errorResponses(401, 404), ...commonErrors },
});
