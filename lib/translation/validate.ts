// Catches IC LLM (Llama 3.1 8B) failure modes — echoed input, self-talk preambles, empty output,
// English-as-Japanese — before they reach the cache so the cascade can fall through.
// Conservative on purpose: borderline outputs pass to avoid paying for a Claude server fallback.

import type { TranslationLanguage } from "./types";

// langDetect requires >=4 chars; this validator must work on titles and single sentences.
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

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Permissive ratio (claude has hit ~0.04 on boilerplate). Real safety nets are kana / meta-commentary /
// identity checks — this only catches runaway noise.
const MIN_RATIO = 0.02;
const MAX_RATIO = 5.0;

// Length-ratio check skipped below this; short inputs have unstable ratios.
const RATIO_MIN_INPUT_LENGTH = 30;

// Match only at start: later occurrences may be the model legitimately quoting input.
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

  // Pure-kanji output without kana almost always means the model returned the input unchanged.
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
