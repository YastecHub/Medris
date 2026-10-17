import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";

/** Contract of /api/chat (documentation; see levi.controller.ts). */
export const leviDocs = [
  legacyRoute({
    method: "post",
    path: "/chat",
    summary: "Levi, the in-app assistant",
    description: "A chat turn (`{ reply }`), message suggestions (`mode: message_suggestions` -> `{ suggestions }`) or speech-to-text (`mode: transcribe` -> `{ text }`). Daily message limit per user.",
    body: z
      .object({
        accessToken,
        messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
        mode: z.enum(["chat", "message_suggestions", "transcribe"]).optional(),
        audio: z.string().optional().openapi({ description: "Base64 WAV (transcribe)." }),
        lat: z.number().optional(),
        lng: z.number().optional(),
        currentView: z.string().optional(),
        currentViewParams: z.unknown().optional(),
        lastRenderError: z.string().optional(),
      })
      .openapi("LeviRequest"),
    responses: { 200: "`{ reply }`, `{ suggestions }` or `{ text }`.", 400: "Invalid input.", 401: "Not signed in or session expired.", 405: "Only POST.", 429: "Daily limit reached.", 500: "Levi could not complete the request." },
  }),
];
