import { LANGUAGES, type TranslationLanguage } from "./types";

function languageName(code: TranslationLanguage): string {
  return LANGUAGES.find(l => l.code === code)?.label ?? code;
}

/**
 * Maximum prompt size in bytes after building. The DFINITY LLM canister
 * caps total prompt size at 10 KiB across all messages; we leave ~1 KiB of
 * headroom for the template overhead and any future system message expansion.
 */
const PROMPT_BUDGET_BYTES = 9000;

/**
 * Maximum reason length in characters before truncation. Reason is metadata
 * and rarely exceeds a few hundred characters in practice.
 */
const REASON_MAX_CHARS = 500;

const encoder = new TextEncoder();

/**
 * Truncate `text` so that its UTF-8 byte length does not exceed `maxBytes`.
 * Returns the truncated text. Multi-byte characters are kept whole — we
 * never split inside a UTF-8 sequence (TextEncoder operates on whole code
 * points, so the slice boundary is always safe).
 */
function truncateToBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  // Binary search the largest character prefix that fits.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo);
}

/**
 * Build a generic translation prompt for any LLM backend. Used for all
 * languages except Japanese (which has its own specialized template).
 *
 * Language detection is delegated to the LLM: if the text is already in
 * the target language, the model responds with "ALREADY_IN_TARGET".
 * When reason is provided, returns JSON with both fields translated.
 */
function buildGenericPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  reason: string | undefined,
  budgetBytes: number,
): string {
  const lang = languageName(targetLanguage);
  // Reserve part of the byte budget for the static template + reason field.
  // We size the template first, then give whatever's left to the body.
  const reasonClipped = reason ? reason.slice(0, REASON_MAX_CHARS) : "";

  const templateOverhead = reason
    ? `Translate the following into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Respond ONLY with a JSON object, no markdown fences or extra text
- Keep proper nouns, URLs, and technical terms unchanged

Text: ""

Reason: "${reasonClipped}"

Respond in this exact JSON format:
{"text":"translated text here","reason":"translated reason here"}`
    : `Translate the following text into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Provide ONLY the translated text — no explanations, notes, or labels
- Preserve paragraph structure and formatting
- Keep proper nouns, URLs, and technical terms unchanged

Text:
`;

  const overheadBytes = encoder.encode(templateOverhead).length;
  const bodyBudget = Math.max(0, budgetBytes - overheadBytes);
  const body = truncateToBytes(text, bodyBudget);

  if (reason) {
    return `Translate the following into ${lang}.

Rules:
- If the text is already written in ${lang}, respond with exactly: ALREADY_IN_TARGET
- Respond ONLY with a JSON object, no markdown fences or extra text
- Keep proper nouns, URLs, and technical terms unchanged

Text: "${body}"

Reason: "${reasonClipped}"

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
${body}`;
}

/**
 * Japanese-specialized translation prompt with few-shot example, register
 * guidance, and proper-noun handling rules. Tuned for news-article style
 * content (the dominant Aegis use-case for Japanese translation).
 *
 * Why specialize:
 *   - 8B-class models follow generic instructions weakly for CJK targets.
 *     A worked example anchors them to the desired style and format.
 *   - Japanese has formality registers (敬体 / 常体) and a generic prompt
 *     leaves the model to guess. News articles consistently use 敬体
 *     (です / ます調), so we make this explicit.
 *   - Foreign proper nouns should be transliterated to katakana, not
 *     translated semantically (Apple → アップル, not 林檎).
 */
function buildJapanesePrompt(
  text: string,
  reason: string | undefined,
  budgetBytes: number,
): string {
  const reasonClipped = reason ? reason.slice(0, REASON_MAX_CHARS) : "";

  const templateOverhead = reason
    ? `Translate the following English/foreign text into Japanese.

Rules:
- If the text is already written entirely in Japanese, respond with exactly: ALREADY_IN_TARGET
- Use 敬体 (です / ます調) — the polite form used in news articles
- Foreign proper nouns: transliterate to カタカナ (Apple → アップル, OpenAI → オープンエーアイ)
- Japanese proper nouns and technical terms (URLs, code, model names like "GPT-4", "Llama 3.1"): keep unchanged
- Code blocks (lines starting with \`\`\` or indented 4 spaces): keep unchanged
- Numbers and dates: convert to natural Japanese (October 15 → 10月15日)
- Respond ONLY with a JSON object, no markdown fences or extra text

Example input text: "Apple announced a new MacBook with the M5 chip on October 15."
Example input reason: "High insight, novel hardware launch"
Example output JSON:
{"text":"Appleは10月15日、M5チップ搭載の新型MacBookを発表しました。","reason":"高い洞察、新しいハードウェア発表"}

Now translate:

Text: ""

Reason: "${reasonClipped}"

Respond in this exact JSON format:
{"text":"translated text here","reason":"translated reason here"}`
    : `Translate the following English/foreign text into Japanese.

Rules:
- If the text is already written entirely in Japanese, respond with exactly: ALREADY_IN_TARGET
- Use 敬体 (です / ます調) — the polite form used in news articles
- Foreign proper nouns: transliterate to カタカナ (Apple → アップル, OpenAI → オープンエーアイ)
- Japanese proper nouns and technical terms (URLs, code, model names like "GPT-4", "Llama 3.1"): keep unchanged
- Code blocks (lines starting with \`\`\` or indented 4 spaces): keep unchanged
- Numbers and dates: convert to natural Japanese (October 15 → 10月15日)
- Provide ONLY the translated text — no explanations, notes, or labels

Example:
Input: "Apple announced a new MacBook with the M5 chip on October 15."
Output: Appleは10月15日、M5チップ搭載の新型MacBookを発表しました。

Now translate:

Text:
`;

  const overheadBytes = encoder.encode(templateOverhead).length;
  const bodyBudget = Math.max(0, budgetBytes - overheadBytes);
  const body = truncateToBytes(text, bodyBudget);

  if (reason) {
    return `Translate the following English/foreign text into Japanese.

Rules:
- If the text is already written entirely in Japanese, respond with exactly: ALREADY_IN_TARGET
- Use 敬体 (です / ます調) — the polite form used in news articles
- Foreign proper nouns: transliterate to カタカナ (Apple → アップル, OpenAI → オープンエーアイ)
- Japanese proper nouns and technical terms (URLs, code, model names like "GPT-4", "Llama 3.1"): keep unchanged
- Code blocks (lines starting with \`\`\` or indented 4 spaces): keep unchanged
- Numbers and dates: convert to natural Japanese (October 15 → 10月15日)
- Respond ONLY with a JSON object, no markdown fences or extra text

Example input text: "Apple announced a new MacBook with the M5 chip on October 15."
Example input reason: "High insight, novel hardware launch"
Example output JSON:
{"text":"Appleは10月15日、M5チップ搭載の新型MacBookを発表しました。","reason":"高い洞察、新しいハードウェア発表"}

Now translate:

Text: "${body}"

Reason: "${reasonClipped}"

Respond in this exact JSON format:
{"text":"translated text here","reason":"translated reason here"}`;
  }

  return `Translate the following English/foreign text into Japanese.

Rules:
- If the text is already written entirely in Japanese, respond with exactly: ALREADY_IN_TARGET
- Use 敬体 (です / ます調) — the polite form used in news articles
- Foreign proper nouns: transliterate to カタカナ (Apple → アップル, OpenAI → オープンエーアイ)
- Japanese proper nouns and technical terms (URLs, code, model names like "GPT-4", "Llama 3.1"): keep unchanged
- Code blocks (lines starting with \`\`\` or indented 4 spaces): keep unchanged
- Numbers and dates: convert to natural Japanese (October 15 → 10月15日)
- Provide ONLY the translated text — no explanations, notes, or labels

Example:
Input: "Apple announced a new MacBook with the M5 chip on October 15."
Output: Appleは10月15日、M5チップ搭載の新型MacBookを発表しました。

Now translate:

Text:
${body}`;
}

/**
 * Build a translation prompt for any LLM backend. Routes to a Japanese
 * specialized template for ja targets and a generic template for everything
 * else. The output is byte-budget-bound (default 9000 bytes) so the prompt
 * fits inside the DFINITY LLM canister's 10 KiB request cap with margin
 * left for the chat envelope.
 *
 * The legacy `maxLength` parameter is honoured: when set, it caps the body
 * to that many characters BEFORE the byte budget is applied. Existing
 * callers and tests that pass an explicit char limit continue to work.
 */
export function buildTranslationPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  reason?: string,
  maxLength?: number,
): string {
  const charClipped = maxLength !== undefined ? text.slice(0, maxLength) : text;

  if (targetLanguage === "ja") {
    return buildJapanesePrompt(charClipped, reason, PROMPT_BUDGET_BYTES);
  }
  return buildGenericPrompt(charClipped, targetLanguage, reason, PROMPT_BUDGET_BYTES);
}

/**
 * Patterns Llama 3.1 8B (and other small models) frequently prepend before
 * the actual translation. Stripping these recovers a valid translation that
 * the validator would otherwise reject as meta-commentary. The patterns are
 * deliberately specific — we don't strip arbitrary prose, only known
 * boilerplate followed by the real output.
 */
const META_PREFIX_STRIP: ReadonlyArray<RegExp> = [
  /^here\s+(?:is|are)\s+(?:the\s+)?(?:translation|translated\s+text)(?:\s+(?:in|into)\s+\w+)?[:.\s]+/i,
  /^the\s+(?:translation|translated\s+text)(?:\s+is)?[:.\s]+/i,
  /^translation\s*[:：]\s*/i,
  /^translated\s*(?:text|version)?\s*[:：]\s*/i,
  /^(?:sure|certainly|of\s+course|okay)[!,.\s]+(?:here\s+(?:is|are)\s+(?:the\s+)?(?:translation|translated\s+text)(?:\s+(?:in|into)\s+\w+)?[:.\s]+)?/i,
];

function stripLeadingMeta(text: string): string {
  let stripped = text.trimStart();
  // Apply each pattern at most once. Keep stripping until no further pattern
  // matches (handles "Sure! Here is the translation: ...").
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of META_PREFIX_STRIP) {
      const next = stripped.replace(pattern, "");
      if (next.length < stripped.length) {
        stripped = next.trimStart();
        changed = true;
      }
    }
  }
  return stripped;
}

export function parseTranslationResponse(raw: string): { text: string; reason?: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "ALREADY_IN_TARGET") return null;

  // Try the JSON path first (it's the requested format when reason is set).
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.text === "string") {
        return {
          text: stripLeadingMeta(parsed.text),
          reason: typeof parsed.reason === "string" ? stripLeadingMeta(parsed.reason) : undefined,
        };
      }
    } catch { /* fall through to plain text */ }
  }

  // Plain-text path: strip a leading meta-prefix so a "Translation: <body>"
  // response surfaces as just <body>. The validator runs on the result.
  return { text: stripLeadingMeta(trimmed) };
}
