import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A chat shared from Levi (the in-app assistant), for React.
 *
 * Asks exactly what the legacy renderSharedAiChat() asks (src/legacy/assets/js/01-app/86-floating-ai-chat-draggable.js:180): the one RPC
 * `get_shared_ai_conversation` with the link's token, through the existing global client `sb`. An error or an empty answer means the link is
 * no longer available.
 */
declare const sb: SupabaseClient;

export interface SharedMessage {
  role: string;
  content: string;
  created_at: string;
  title?: string | null;
}

export async function loadSharedChat(token: string): Promise<SharedMessage[] | null> {
  const { data, error } = await sb.rpc("get_shared_ai_conversation", { p_token: token });
  const rows = data as SharedMessage[] | null;
  if (error || !rows || rows.length === 0) return null;
  return rows;
}
