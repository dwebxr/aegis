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
- Do NOT add (Note:) parentheses, "Here is the breakdown:" lists, word-by-word translations, or any explanation. Stop immediately after the JSON object.

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
- Do NOT add (Note:) parentheses, "Here is the breakdown:" lists, word-by-word translations, or any explanation. Stop immediately after the translated paragraph.

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
- Do NOT add (Note:) parentheses, "Here is the breakdown:" lists, word-by-word translations, or any explanation. Stop immediately after the JSON object.

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
- Do NOT add (Note:) parentheses, "Here is the breakdown:" lists, word-by-word translations, or any explanation. Stop immediately after the translated paragraph.

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
 * else. The output is byte-budget-bound (9000 bytes) so the prompt fits
 * inside the DFINITY LLM canister's 10 KiB request cap with margin left for
 * the chat envelope.
 */
export function buildTranslationPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  reason?: string,
): string {
  if (targetLanguage === "ja") {
    return buildJapanesePrompt(text, reason, PROMPT_BUDGET_BYTES);
  }
  return buildGenericPrompt(text, targetLanguage, reason, PROMPT_BUDGET_BYTES);
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

/**
 * Classify a paragraph as "Japanese-looking" or "Latin-commentary-looking".
 * Japanese-looking means majority of non-whitespace characters are kana,
 * kanji (CJK ideographs), or katakana. Latin-commentary-looking means
 * majority Latin letters / digits / punctuation. The threshold is 50%.
 *
 * We can't import from lib/ingestion/langDetect because that helper
 * requires a 4-character minimum and validation must work on
 * arbitrarily short paragraph fragments.
 */
function isJapaneseLooking(text: string): boolean {
  let cjkCount = 0;
  let latinCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20) continue; // skip whitespace
    if (
      (code >= 0x3040 && code <= 0x309f) || // hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // katakana
      (code >= 0x31f0 && code <= 0x31ff) || // katakana phonetic ext
      (code >= 0xff66 && code <= 0xff9f) || // half-width katakana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK ext A
      (code >= 0x4e00 && code <= 0x9fff)    // CJK unified ideographs (kanji)
    ) {
      cjkCount += 1;
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      latinCount += 1;
    }
  }
  // No CJK at all → not Japanese
  if (cjkCount === 0) return false;
  // CJK present and outnumbers Latin (or there's no Latin) → Japanese
  return cjkCount >= latinCount;
}

/**
 * Patterns that mark the START of a Llama 3.1 8B "commentary block" — the
 * model's tendency on short inputs is to translate, then add an English
 * explanation, often after a blank line. Recognising these as
 * commentary lets us cut them even if the paragraph also happens to
 * contain a stray kana character.
 */
const COMMENTARY_START_PATTERNS: ReadonlyArray<RegExp> = [
  /^\(?\s*note\s*[:：]/i,
  /^here\s+(?:is|are)\b/i,
  /^let\s+me\s+(?:know|explain)\b/i,
  /^i\s+(?:used|chose|translated|hope|think|believe)\b/i,
  /^(?:please\s+)?note\s+that\b/i,
  /^the\s+(?:translation|original|text|word|phrase)\b/i,
  /^[*-]\s+\w/, // markdown bullet list (e.g. "* Quantum -> カオス量子")
  /^breakdown\s*[:：]/i,
  /^explanation\s*[:：]/i,
  /^translation\s*notes?\s*[:：]/i,
];

function looksLikeCommentary(paragraph: string): boolean {
  const head = paragraph.trimStart();
  return COMMENTARY_START_PATTERNS.some(re => re.test(head));
}

/**
 * Strip trailing English commentary that Llama 3.1 8B (and other weak
 * models) append after a valid Japanese translation. The model will
 * frequently produce:
 *
 *   IBMは、量子コンピュータを発表しました。
 *
 *   (Note: I used the polite form "です" to match the news article tone)
 *
 *   Here is the breakdown:
 *
 *   * Quantum -> 量子
 *   * computing -> コンピューティング
 *   ...
 *
 * The first paragraph is a perfectly good translation. The rest is meta
 * the user doesn't want to see and inflates the length-ratio so the
 * validator rejects the whole thing.
 *
 * The cleanup splits the output on `\n\n` and walks paragraphs from the
 * top. A paragraph is kept iff it contains at least one kana character
 * AND does not start with a known commentary marker. The first
 * paragraph that fails either check ends the translated section — every
 * paragraph after that point is dropped.
 *
 * Why "from the top, stop on first failure" instead of "filter all":
 * once Llama starts adding commentary, EVERYTHING after it is commentary
 * (including the bullet list which might contain Japanese fragments
 * like "* Quantum -> 量子コンピュータ"). A scattershot filter would
 * preserve those fragments and produce garbled output.
 *
 * Only applies to ja target — for other languages, the kana signal
 * doesn't help and we leave the output as-is (Claude server is
 * reliable enough for ASCII targets).
 */
function stripTrailingNoise(text: string, targetLanguage: string): string {
  if (targetLanguage !== "ja") return text;
  if (text.length === 0) return text;

  const paragraphs = text.split(/\n\s*\n+/);
  if (paragraphs.length === 1) return text;

  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    // Commentary marker (Note:, Here is the breakdown:, * bullet, etc.)
    // — this paragraph and everything after it is meta. Stop.
    if (looksLikeCommentary(trimmed)) break;
    // Japanese-looking paragraph (kana, kanji, or both, more CJK than
    // Latin) — keep it.
    if (isJapaneseLooking(trimmed)) {
      kept.push(trimmed);
      continue;
    }
    // Not Japanese-looking. If we already kept Japanese paragraphs, this
    // is trailing English commentary — stop. If we haven't kept anything
    // yet, the leading paragraph is itself broken; keep scanning forward
    // in case a later paragraph has the real translation.
    if (kept.length > 0) break;
  }

  // If nothing survived the filter (all paragraphs were commentary or
  // empty), return the original — the validator will reject it cleanly
  // with the right reason instead of us silently producing an empty
  // string.
  if (kept.length === 0) return text;
  return kept.join("\n\n");
}

export function parseTranslationResponse(
  raw: string,
  targetLanguage: string = "ja",
): { text: string; reason?: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "ALREADY_IN_TARGET") return null;

  const cleanup = (s: string): string =>
    stripTrailingNoise(stripLeadingMeta(s), targetLanguage);

  // Try the JSON path first (it's the requested format when reason is set).
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.text === "string") {
        return {
          text: cleanup(parsed.text),
          reason: typeof parsed.reason === "string" ? cleanup(parsed.reason) : undefined,
        };
      }
    } catch { /* fall through to plain text */ }
  }

  // Plain-text path: strip leading meta then trailing commentary so a
  // "Translation: <body>\n\n(Note: ...)" response surfaces as just <body>.
  // The validator runs on the cleaned result.
  return { text: cleanup(trimmed) };
}
