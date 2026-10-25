import { z } from "../../shared/openapi/zod.js";
import { idParam } from "../../shared/openapi/schemas.js";

export const SuggestionSchema = z
  .object({
    id: z.string(),
    sender_name: z.string().nullable(),
    is_anonymous: z.boolean(),
    message: z.string(),
    status: z.string(),
    created_at: z.string(),
    reply_message: z.string().nullable().optional(),
    replied_at: z.string().nullable().optional(),
  })
  .openapi("Suggestion");

export const SubmitSuggestionBody = z
  .object({
    targetType: z.string().openapi({ description: "vendor or platform." }),
    targetVendorId: idParam.nullish(),
    message: z.string().max(5000).nullish(),
    isAnonymous: z.boolean().nullish(),
  })
  .openapi("SubmitSuggestionRequest");

export const ReplySuggestionBody = z.object({ message: z.string().max(2000) }).openapi("ReplySuggestionRequest");

export const SuggestionParams = z.object({ suggestionId: idParam });

export const SubmittedSuggestion = z.object({ id: z.string() });

export type Suggestion = z.infer<typeof SuggestionSchema>;
