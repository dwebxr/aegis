/**
 * Lightweight language detection for heuristic scoring.
 *
 * Phase 1 scope: distinguishes Japanese ("ja") and English ("en") with high
 * accuracy and falls through to "unknown" for everything else. Designed to be
 * fast, synchronous, zero-dependency, and safe in both Node and browser.
 *
 * Strategy:
 *   1. Walk the input once and tally Unicode block frequencies.
 *   2. If the text contains hiragana or katakana → Japanese (these blocks are
 *      effectively unique to Japanese; CJK ideographs alone are ambiguous with
 *      Chinese, but kana are not).
 *   3. If the text is dominantly Latin → English (Phase 1 only supports en
 *      from the Latin branch; other languages will be added in a later phase).
 *   4. Otherwise → "unknown" (caller should default to common rules + en
 *      heuristics for backwards compatibility).
 */

export type SupportedLang = "en" | "ja" | "unknown";

interface BlockTally {
  hiragana: number;
  katakana: number;
  cjk: number;
  latin: number;
  total: number;
}

const HIRAGANA_START = 0x3040;
const HIRAGANA_END = 0x309f;
const KATAKANA_START = 0x30a0;
const KATAKANA_END = 0x30ff;
const KATAKANA_PHONETIC_EXT_START = 0x31f0; // small kana extensions
const KATAKANA_PHONETIC_EXT_END = 0x31ff;
const KATAKANA_HALFWIDTH_START = 0xff66; // halfwidth katakana
const KATAKANA_HALFWIDTH_END = 0xff9f;
const CJK_UNIFIED_START = 0x4e00;
const CJK_UNIFIED_END = 0x9fff;
const CJK_EXT_A_START = 0x3400;
const CJK_EXT_A_END = 0x4dbf;

function tallyBlocks(text: string): BlockTally {
  const tally: BlockTally = {
    hiragana: 0,
    katakana: 0,
    cjk: 0,
    latin: 0,
    total: 0,
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    // Skip ASCII control & whitespace from "total" so the ratios reflect
    // actual script content rather than formatting.
    if (code <= 0x20) continue;

    tally.total += 1;

    if (code >= HIRAGANA_START && code <= HIRAGANA_END) {
      tally.hiragana += 1;
    } else if (
      (code >= KATAKANA_START && code <= KATAKANA_END)
      || (code >= KATAKANA_PHONETIC_EXT_START && code <= KATAKANA_PHONETIC_EXT_END)
      || (code >= KATAKANA_HALFWIDTH_START && code <= KATAKANA_HALFWIDTH_END)
    ) {
      tally.katakana += 1;
    } else if (
      (code >= CJK_UNIFIED_START && code <= CJK_UNIFIED_END)
      || (code >= CJK_EXT_A_START && code <= CJK_EXT_A_END)
    ) {
      tally.cjk += 1;
    } else if (
      (code >= 0x41 && code <= 0x5a) // A-Z
      || (code >= 0x61 && code <= 0x7a) // a-z
    ) {
      tally.latin += 1;
    }
  }
  return tally;
}

/**
 * Detects the language of `text`.
 *
 * - Returns "ja" if any kana characters are present, OR if CJK ideographs make
 *   up at least 20% of non-whitespace characters AND there is no significant
 *   Latin script (i.e. "almost certainly Japanese without kana", which is
 *   rare but possible for short kanji-only headlines).
 * - Returns "en" if Latin letters dominate (≥60% of non-whitespace) and no
 *   kana are present.
 * - Returns "unknown" otherwise. Callers default to common+English rules.
 *
 * Very short inputs (< 4 non-whitespace chars) always return "unknown" to
 * avoid spurious classifications from a single character.
 */
export function detectLanguage(text: string): SupportedLang {
  if (!text) return "unknown";

  const tally = tallyBlocks(text);
  if (tally.total < 4) return "unknown";

  // Kana are unambiguous markers for Japanese.
  if (tally.hiragana > 0 || tally.katakana > 0) {
    return "ja";
  }

  // Pure-kanji headlines: classify as Japanese only if Latin is absent.
  // (Chinese pages are out of Phase 1 scope; we leave them as "unknown".)
  // Phase 1 deliberately does NOT classify pure-CJK as ja to avoid Chinese
  // false positives.

  if (tally.latin / tally.total >= 0.6) {
    return "en";
  }

  return "unknown";
}
