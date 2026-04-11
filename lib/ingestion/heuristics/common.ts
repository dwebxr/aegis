/**
 * Language-independent heuristic signals.
 *
 * Used by non-English language modules. The English module (`en.ts`)
 * implements these signals inline to preserve byte-for-byte compatibility
 * with the legacy `quickFilter.ts` and so does NOT call into this file.
 *
 * Signals that depend on script-specific assumptions (CAPS ratio, English
 * word boundaries, English vocabulary) live in the per-language modules.
 */

import type { LanguageSignals } from "./types";
import { emptySignals } from "./types";

const EMOJI_REGEX = new RegExp(
  "[\\u{1F600}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]",
  "gu",
);

/**
 * Common signals that apply across all languages: links, numeric data,
 * structured paragraphs, emoji density. Length thresholds are NOT included
 * here because the appropriate "size unit" varies by language (English uses
 * word count; Japanese/Chinese use character count) — each language module
 * handles length on its own.
 *
 * @param text  raw text (not normalized)
 * @param sizeForEmojiDenominator denominator used to compute emoji density;
 *   for English this is word count, for Japanese this is character count.
 */
export function commonSignals(
  text: string,
  sizeForEmojiDenominator: number,
): LanguageSignals {
  const signals = emptySignals();

  const emojiCount = (text.match(EMOJI_REGEX) || []).length;
  const emojiDensity = emojiCount / Math.max(sizeForEmojiDenominator, 1);
  if (emojiDensity > 0.05) {
    signals.originality -= 2;
    signals.reasons.push("high emoji density");
  }

  const hasLinks = /https?:\/\//.test(text);
  if (hasLinks) {
    signals.credibility += 2;
    signals.reasons.push("contains links");
  }

  const hasData = /\d+%|\$\d|[0-9]+\.[0-9]/.test(text);
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

  return signals;
}
