import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";

/** Contract of /api/auth-otp (documentation; see auth-otp.controller.ts). */
export const authOtpDocs = [
  legacyRoute({
    method: "post",
    path: "/auth-otp",
    summary: "Admin one-time login codes and password setting",
    description:
      "No action: e-mails an admin a 6-digit code when their last verification is older than 7 days (`otpRequired`). " +
      "`verify`: checks `code`. `set-password`: sets `password` (8+ characters) through the Auth admin API.",
    body: z
      .object({
        action: z.enum(["send", "verify", "set-password"]).optional(),
        accessToken,
        code: z.string().optional(),
        password: z.string().optional(),
      })
      .openapi("AuthOtpRequest"),
    responses: { 200: "`{ ok, otpRequired? }` or `{ ok: false, error }` for a wrong code.", 400: "Missing input.", 401: "Invalid session.", 403: "Not an admin.", 405: "Only POST.", 500: "Server error." },
  }),
];
