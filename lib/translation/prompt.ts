import { LANGUAGES, type TranslationLanguage } from "./types";

function languageName(code: TranslationLanguage): string {
  return LANGUAGES.find(l => l.code === code)?.label ?? code;
}

// DFINITY LLM caps total prompt at 10 KiB; ~1 KiB headroom for template + future system message.
const PROMPT_BUDGET_BYTES = 9000;
const REASON_MAX_CHARS = 500;

const encoder = new TextEncoder();

// Slice on code-point boundary — never inside a UTF-8 sequence.
function truncateToBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
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

// Generic template for non-ja targets. Detection is delegated to the LLM via "ALREADY_IN_TARGET".
function buildGenericPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  reason: string | undefined,
  budgetBytes: number,
): string {
  const lang = languageName(targetLanguage);
  // Size the template first; remainder of the byte budget feeds the body.
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

// 8B models need a few-shot, explicit 敬体 register, and katakana proper-noun rules to produce
// news-article Japanese reliably. Generic template gives garbled / mixed-register output.
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

// Routes to a ja-specialized template or a generic one. Byte-budget-bound (9000 B) to fit DFINITY LLM canister's 10 KiB request cap.
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

// Specific boilerplate-only patterns. Stripping these recovers translations the validator
// would otherwise reject as meta-commentary; never use to strip arbitrary prose.
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

// True iff CJK (kana/kanji) >= Latin chars. Inlined instead of langDetect so it works on
// arbitrarily short paragraph fragments (langDetect requires 4-char minimum).
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

// Llama 3.1 8B routinely follows a translation with an English explanation block.
// Matched at paragraph start so a stray kana char inside the block doesn't fool us.
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

// Drops trailing "(Note:...)" / "Here is the breakdown:" blocks Llama 3.1 8B appends after
// the real ja translation. Walks paragraphs top-down and stops at the first commentary marker
// because everything after is meta — a filter-all approach would preserve bullet fragments
// like "* Quantum -> 量子コンピュータ" and produce garbled output. Only ja target.
function stripTrailingNoise(text: string, targetLanguage: string): string {
  if (targetLanguage !== "ja") return text;
  if (text.length === 0) return text;

  const paragraphs = text.split(/\n\s*\n+/);
  if (paragraphs.length === 1) return text;

  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    if (looksLikeCommentary(trimmed)) break;
    if (isJapaneseLooking(trimmed)) {
      kept.push(trimmed);
      continue;
    }
    // Latin paragraph after we've already kept Japanese = trailing commentary; otherwise
    // the leading paragraph is broken — keep scanning for the real translation.
    if (kept.length > 0) break;
  }

  // Nothing survived: return original so validator rejects cleanly instead of producing "".
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

  // JSON path: this is the requested format when `reason` is set.
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

  // Plain-text path: cleanup turns "Translation: <body>\n\n(Note: ...)" into just <body>.
  return { text: cleanup(trimmed) };
}
