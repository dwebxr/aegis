import { LANGUAGES, type TranslationLanguage } from "./types";

function languageName(code: TranslationLanguage): string {
  return LANGUAGES.find(l => l.code === code)?.label ?? code;
}

/**
 * Build a translation prompt for any LLM backend.
 * Language detection is delegated to the LLM: if the text is already
 * in the target language, the model responds with "ALREADY_IN_TARGET".
 */
export function buildTranslationPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  maxLength = 3000,
): string {
  const content = text.slice(0, maxLength);
  const lang = languageName(targetLanguage);

  return `Translate the following text into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Provide ONLY the translated text — no explanations, notes, or labels
- Preserve paragraph structure and formatting
- Keep proper nouns, URLs, and technical terms unchanged

Text:
${content}`;
}

export function isAlreadyInTarget(response: string): boolean {
  return response.trim() === "ALREADY_IN_TARGET";
}
