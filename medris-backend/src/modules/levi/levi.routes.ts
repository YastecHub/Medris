import { Hono } from "hono";
import { json, methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { chat, transcribe, type LeviRequest } from "./levi.service.js";

/** POST /api/chat { messages, accessToken, mode?, ... } -> { reply } | { suggestions } | { text } */
export const leviRoutes = new Hono().all("/chat", async (c) => {
  if (c.req.method !== "POST") return methodNotAllowed(c);
  try {
    const body = await readJsonBody<LeviRequest>(c);
    const result = body?.mode === "transcribe" ? await transcribe(body) : await chat(body);
    return json(c, result.status, result.body);
  } catch (err) {
    console.error("[Levromart] Levi handler error:", err);
    return json(c, 500, { error: "Levi could not complete that request." });
  }
});
