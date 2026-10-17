/**
 * Google Gemini (generateContent) client used by Levi. If the primary model
 * fails, the request is retried once on the fallback model.
 */

export const GEMINI_MODEL: string = "gemini-3.8-flash";
export const GEMINI_FALLBACK_MODEL: string = "gemini-3.7-flash";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: unknown; id?: string };
  functionResponse?: unknown;
  inline_data?: { mime_type: string; data: string };
  [key: string]: unknown;
}

export interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

export interface GeminiCandidate {
  content?: GeminiContent;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
}

function endpoint(model: string): string {
  return `${API_BASE}/${model}:generateContent`;
}

export async function callGemini(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
  systemInstruction: string,
  tools?: unknown[],
): Promise<GeminiResponse> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: "medium" } },
  };
  if (tools) body.tools = tools;

  let response = await fetch(endpoint(model), {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = (await response.json()) as GeminiResponse;
  if (!response.ok && model === GEMINI_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    response = await fetch(endpoint(GEMINI_FALLBACK_MODEL), {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, tools: tools ? body.tools : undefined }),
    });
    data = (await response.json()) as GeminiResponse;
  }
  if (!response.ok) throw new Error(data?.error?.message || "Gemini request failed.");
  return data;
}

/** Speech-to-text for a short base64 WAV clip. Returns null when both models fail. */
export async function transcribeWav(apiKey: string, audioBase64: string): Promise<string | null> {
  const prompt =
    "Transcribe this short voice clip exactly as spoken (English, possibly with a Nigerian accent). Output ONLY the spoken words with normal punctuation. No quotes, no commentary. If there is no clear speech, output nothing.";
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK_MODEL]) {
    try {
      const r = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "audio/wav", data: audioBase64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as GeminiResponse;
      return String(j?.candidates?.[0]?.content?.parts?.map((x) => x.text || "").join(" ") || "")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      /* try the fallback model */
    }
  }
  return null;
}
