/**
 * Translation output validator.
 *
 * The IC LLM Llama 3.1 8B model frequently produces problematic outputs:
 *
 *   - Echoes the original text unchanged (treats translation as a no-op)
 *   - Returns model self-talk ("Here is the Japanese translation: ...")
 *   - Returns an empty string or whitespace
 *   - For Japanese targets: returns English text claiming it cannot translate
 *
 * The validator catches these failure modes BEFORE they reach the cache or
 * the user, so the cascade can fall through to the next backend.
 *
 * Validation is intentionally conservative: a borderline output is accepted
 * rather than rejected, because the next-best fallback (server Claude) costs
 * money and we prefer "imperfect Japanese" over "no translation at all".
 */

import type { TranslationLanguage } from "./types";

/**
 * Direct kana presence check. Returns true if `text` contains at least one
 * hiragana (U+3040..U+309F) or katakana (U+30A0..U+30FF, plus extensions)
 * codepoint. Used by the Japanese validation path — we cannot use
 * lib/ingestion/langDetect.detectLanguage here because that helper requires
 * a minimum input length of 4 characters and validation must work on
 * arbitrarily short outputs (titles, single-sentence responses).
 */
function containsKana(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x3040 && code <= 0x309f) || // hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // katakana
      (code >= 0x31f0 && code <= 0x31ff) || // katakana phonetic extensions
      (code >= 0xff66 && code <= 0xff9f)    // half-width katakana
    ) {
      return true;
    }
  }
  return false;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Lower / upper bounds for the output-to-input length ratio. Typical
// en → ja is 0.3–0.8 (Japanese is character-dense AND models often
// compress boilerplate-heavy English); en → fr/de/es is 0.9–1.4; ja →
// en is 1.5–3.0. Production claude output has been observed as low as
// 0.04 on boilerplate-heavy articles, so MIN_RATIO is permissive.
// The kana check, meta-commentary check, and identical-to-input check
// are the real safety nets — this ratio catches only runaway noise.
const MIN_RATIO = 0.02;
const MAX_RATIO = 5.0;

/**
 * Below this character count the length-ratio check is skipped — short
 * inputs (titles, captions, single sentences) have unstable ratios.
 */
const RATIO_MIN_INPUT_LENGTH = 30;

/**
 * Patterns that strongly indicate the model returned meta-commentary
 * instead of (or in addition to) the actual translation. We reject any
 * output that BEGINS with one of these — patterns appearing later in the
 * output are tolerated (the model may quote the input as part of a longer
 * structured response).
 */
const META_PREFIXES: ReadonlyArray<RegExp> = [
  /^here\s+(is|are)\b/i,
  /^the\s+(translation|translated\s+text)\b/i,
  /^translation:?\s/i,
  /^translated\s+text:?\s/i,
  /^(?:sure|certainly|of\s+course)[!,.\s]/i,
  /^i\s+(can|will|cannot|can't|won't)\s+translate\b/i,
  /^i\s+(am\s+sorry|apologize)\b/i,
  /^(?:as\s+an\s+ai|i\s+am\s+an\s+ai)\b/i,
  /^note:?\s/i,
];

function looksLikeMetaCommentary(text: string): boolean {
  const head = text.trimStart();
  return META_PREFIXES.some(re => re.test(head));
}

/**
 * Validate a parsed translation result against the original input. The
 * caller passes both the translated text and the original so the ratio
 * check can be applied without re-fetching state.
 */
export function validateTranslation(
  translatedText: string,
  targetLanguage: TranslationLanguage,
  originalText: string,
): ValidationResult {
  const trimmed = translatedText.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "empty translation" };
  }

  if (looksLikeMetaCommentary(trimmed)) {
    return { valid: false, reason: "model returned meta-commentary instead of translation" };
  }

  // For Japanese targets the translated text MUST contain at least one
  // hiragana or katakana character. Pure-kanji output is technically
  // possible (a one-word kanji compound) but vanishingly rare in real
  // article translations and almost always indicates the model gave up
  // and returned the input unchanged.
  if (targetLanguage === "ja") {
    if (!containsKana(trimmed)) {
      return { valid: false, reason: "Japanese target but output contains no kana characters" };
    }
  }

  // Length-ratio check applies to inputs long enough to give a stable signal.
  if (originalText.length >= RATIO_MIN_INPUT_LENGTH) {
    const ratio = trimmed.length / originalText.length;
    if (ratio < MIN_RATIO) {
      return { valid: false, reason: `output too short (ratio ${ratio.toFixed(2)} < ${MIN_RATIO})` };
    }
    if (ratio > MAX_RATIO) {
      return { valid: false, reason: `output too long (ratio ${ratio.toFixed(2)} > ${MAX_RATIO})` };
    }
  }

  // Reject outputs that are byte-for-byte identical to the input (the
  // model echoed the input rather than translating). For Japanese targets
  // this is already caught by the kana check above (English input echoed
  // verbatim has no kana). For other targets we need an explicit guard.
  if (trimmed === originalText.trim()) {
    return { valid: false, reason: "output is identical to input" };
  }

  return { valid: true };
}
