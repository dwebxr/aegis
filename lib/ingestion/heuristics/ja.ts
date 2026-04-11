/**
 * Japanese heuristic scoring.
 *
 * Detects clickbait-style and high-quality writing patterns specific to
 * Japanese-language content. Designed to behave reasonably even on very
 * short headlines (a single phrase), since RSS titles are commonly the only
 * thing fed through Tier 4 fallback.
 *
 * Signals (relative to the 5/5/5 baseline):
 *
 *   negative
 *     - 2+ slop terms          → originality -2, credibility -2
 *     - "！？" / "！！" runs    → originality -2, credibility -2
 *     - >10% fullwidth alnum    → credibility -1
 *     - >5% decoration brackets → originality -1
 *
 *   positive
 *     - 2+ quality terms        → insight +1, credibility +1
 *     - 4+ quality terms        → insight +2, credibility +1 (subsumes above)
 *     - >120 chars              → insight +1
 *     - >300 chars              → insight +1, originality +1 (long-form)
 *     - >600 chars              → insight +1                  (detailed)
 *     - <20 chars               → insight -1, originality -1  (very short)
 *
 * Plus the language-independent common signals (links, numeric data,
 * structured paragraphs, emoji density).
 *
 * Character-count thresholds were chosen to be roughly equivalent to the
 * English word-count thresholds, using the rule of thumb that a typical
 * Japanese word averages ~2.5 characters: 50/100/200 English words ≈
 * 125/250/500 Japanese characters. Rounded to memorable values.
 */

import type { LanguageSignals } from "./types";
import { emptySignals, mergeSignals } from "./types";
import { commonSignals } from "./common";
import { SLOP_TERMS_JA, QUALITY_TERMS_JA } from "./dictionaries/ja";

const FULLWIDTH_ALNUM_REGEX = /[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]/g;
const DECORATION_REGEX = /[【】〈〉「」『』〔〕《》〖〗]/g;
const EMPHATIC_PUNCT_REGEX = /[！？]{2,}|！[！？]|[!?]{2,}/;

function countOccurrences(text: string, terms: ReadonlyArray<string>): number {
  let n = 0;
  for (const term of terms) {
    if (text.includes(term)) n += 1;
  }
  return n;
}

function nonWhitespaceLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x20) n += 1;
  }
  return n;
}

export function scoreJapanese(text: string): LanguageSignals {
  const signals = emptySignals();
  const charCount = nonWhitespaceLength(text);

  // — Negative signals —

  const slopHits = countOccurrences(text, SLOP_TERMS_JA);
  if (slopHits >= 2) {
    signals.originality -= 2;
    signals.credibility -= 2;
    signals.reasons.push("clickbait vocabulary");
  }

  if (EMPHATIC_PUNCT_REGEX.test(text)) {
    signals.originality -= 2;
    signals.credibility -= 2;
    signals.reasons.push("emphatic punctuation runs");
  }

  const fullwidthAlnumCount = (text.match(FULLWIDTH_ALNUM_REGEX) || []).length;
  if (charCount > 0 && fullwidthAlnumCount / charCount > 0.1) {
    signals.credibility -= 1;
    signals.reasons.push("fullwidth alphanumerics");
  }

  const decorationCount = (text.match(DECORATION_REGEX) || []).length;
  if (charCount > 0 && decorationCount / charCount > 0.05) {
    signals.originality -= 1;
    signals.reasons.push("decorative brackets");
  }

  // — Length —

  if (charCount < 20) {
    signals.insight -= 1;
    signals.originality -= 1;
    signals.reasons.push("very short content");
  }
  if (charCount > 120) {
    signals.insight += 1;
  }
  if (charCount > 300) {
    signals.insight += 1;
    signals.originality += 1;
    signals.reasons.push("long-form content");
  }
  if (charCount > 600) {
    signals.insight += 1;
    signals.reasons.push("detailed content");
  }

  // — Positive vocabulary —

  const qualityHits = countOccurrences(text, QUALITY_TERMS_JA);
  if (qualityHits >= 4) {
    signals.insight += 2;
    signals.credibility += 1;
    signals.reasons.push("analytical vocabulary");
  } else if (qualityHits >= 2) {
    signals.insight += 1;
    signals.credibility += 1;
    signals.reasons.push("analytical vocabulary");
  }

  // — Common (language-independent) signals —
  // Use character count as the emoji-density denominator since Japanese has
  // no notion of whitespace-separated words.
  const common = commonSignals(text, Math.max(charCount, 1));

  return mergeSignals(signals, common);
}
