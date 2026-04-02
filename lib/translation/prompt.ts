import { LANGUAGES, type TranslationLanguage } from "./types";

function languageName(code: TranslationLanguage): string {
  return LANGUAGES.find(l => l.code === code)?.label ?? code;
}

/**
 * Build a translation prompt for any LLM backend.
 * Language detection is delegated to the LLM: if the text is already
 * in the target language, the model responds with "ALREADY_IN_TARGET".
 * When reason is provided, returns JSON with both fields translated.
 */
export function buildTranslationPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  reason?: string,
  maxLength = 3000,
): string {
  const content = text.slice(0, maxLength);
  const lang = languageName(targetLanguage);

  if (reason) {
    return `Translate the following into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Respond ONLY with a JSON object, no markdown fences or extra text
- Keep proper nouns, URLs, and technical terms unchanged

Text: "${content}"

Reason: "${reason.slice(0, 500)}"

Respond in this exact JSON format:
{"text":"translated text here","reason":"translated reason here"}`;
  }

  return `Translate the following text into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Provide ONLY the translated text — no explanations, notes, or labels
- Preserve paragraph structure and formatting
- Keep proper nouns, URLs, and technical terms unchanged

Text:
${content}`;
}

export function parseTranslationResponse(raw: string): { text: string; reason?: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "ALREADY_IN_TARGET") return null;

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.text === "string") {
        return {
          text: parsed.text,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch { /* fall through to plain text */ }
  }

  return { text: trimmed };
}
