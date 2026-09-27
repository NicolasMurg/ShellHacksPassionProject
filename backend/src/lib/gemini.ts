import { HttpError } from "./validation";

// Gemini is only called from the server so the API key never reaches the browser.
const MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Asks Gemini for JSON that matches `schema` (OpenAPI subset) and returns it parsed. */
export async function geminiJson(parts: GeminiPart[], schema: object, system?: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError(503, "AI features are not configured (missing GEMINI_API_KEY)");
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(system && { system_instruction: { parts: [{ text: system }] } }),
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema },
      }),
    });
  } catch {
    throw new HttpError(502, "Gemini could not be reached");
  }
  if (!response.ok) throw new HttpError(502, `Gemini request failed (${response.status})`);
  const body = await response.json().catch(() => undefined) as
    { candidates?: { content?: { parts?: { text?: string }[] } }[] } | undefined;
  const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("");
  if (!text) throw new HttpError(502, "Gemini returned no answer");
  try { return JSON.parse(text); }
  catch { throw new HttpError(502, "Gemini returned invalid JSON"); }
}
