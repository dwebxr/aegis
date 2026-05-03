// IMPORTANT: thresholds/regex/weights here are load-bearing for the Tier 4 fallback and the
// quickFilter test suite. Treat as frozen — refactor only with full test churn.

import type { LanguageSignals } from "./types";
import { emptySignals } from "./types";

const EMOJI_REGEX = new RegExp(
  "[\\u{1F600}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]",
  "gu",
);

const ANALYTICAL_REGEX
  = /\b(analysis|evidence|hypothesis|correlation|framework|methodology|dataset|benchmark|implementation|algorithm)\b/i;

const ATTRIBUTION_REGEX = /\b(according to|cited|source:)\b/i;

export function scoreEnglish(text: string): LanguageSignals {
  const signals = emptySignals();

  const words = text.split(/\s+/).length;
  const exclamationDensity = (text.match(/!/g) || []).length / Math.max(words, 1);
  const emojiDensity = (text.match(EMOJI_REGEX) || []).length / Math.max(words, 1);
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);
  const hasLinks = /https?:\/\//.test(text);
  const hasData = /\d+%|\$\d|[0-9]+\.[0-9]/.test(text);

  if (exclamationDensity > 0.1) {
    signals.originality -= 3;
    signals.credibility -= 3;
    signals.reasons.push("excessive exclamation marks");
  }
  if (emojiDensity > 0.05) {
    signals.originality -= 2;
    signals.reasons.push("high emoji density");
  }
  if (capsRatio > 0.3) {
    signals.credibility -= 3;
    signals.originality -= 2;
    signals.reasons.push("excessive caps");
  }
  if (words < 8) {
    signals.insight -= 1;
    signals.originality -= 1;
    signals.reasons.push("very short content");
  }
  if (words > 50) {
    signals.insight += 1;
  }
  if (words > 100) {
    signals.insight += 1;
    signals.originality += 1;
    signals.reasons.push("long-form content");
  }
  if (words > 200) {
    signals.insight += 1;
    signals.reasons.push("detailed content");
  }
  if (hasLinks) {
    signals.credibility += 2;
    signals.reasons.push("contains links");
  }
  if (hasData) {
    signals.insight += 2;
    signals.credibility += 1;
    signals.reasons.push("contains data/numbers");
  }

  const paragraphs = text.split(/\n\s*\n/).length;
  if (paragraphs >= 3) {
    signals.originality += 1;
    signals.insight += 1;
    signals.reasons.push("structured paragraphs");
  }

  if (ANALYTICAL_REGEX.test(text)) {
    signals.insight += 1;
    signals.credibility += 1;
    signals.reasons.push("analytical language");
  }

  if (ATTRIBUTION_REGEX.test(text)) {
    signals.credibility += 2;
    signals.reasons.push("attribution present");
  }

  return signals;
}
