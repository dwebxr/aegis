// Signals (relative to 5/5/5 baseline):
//   negative: 2+ slop → orig -2/cred -2 | "！？"/"！！" runs → orig -2/cred -2
//             | >10% fullwidth alnum → cred -1 | >5% decoration brackets → orig -1
//   positive: 2+ quality → ins +1/cred +1 | 4+ quality → ins +2/cred +1 (subsumes)
//             | >120 chars → ins +1 | >300 → ins +1/orig +1 | >600 → ins +1
//             | <20 → ins -1/orig -1
// Char thresholds ~= English word counts × 2.5 (typical ja word length).

import type { LanguageSignals } from "./types";
import { emptySignals } from "./types";
import { commonSignals } from "./common";
import { SLOP_TERMS_JA, QUALITY_TERMS_JA } from "./dictionaries/ja";

const FULLWIDTH_ALNUM_REGEX = /[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]/g;
const DECORATION_REGEX = /[【】〈〉「」『』〔〕《》〖〗]/g;
const EMPHATIC_PUNCT_REGEX = /[！？]{2,}|[!?]{2,}/;

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

  return {
    originality: signals.originality + common.originality,
    insight: signals.insight + common.insight,
    credibility: signals.credibility + common.credibility,
    reasons: [...signals.reasons, ...common.reasons],
  };
}
