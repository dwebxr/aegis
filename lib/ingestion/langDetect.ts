// Single pass: any kana → ja (kana blocks are ja-unique). Latin >=60% non-ws → en. Else unknown.
// Pure-kanji headlines classify as unknown to avoid Chinese false positives.

export type SupportedLang = "en" | "ja" | "unknown";

interface BlockTally {
  kana: number;
  latin: number;
  total: number;
}

const HIRAGANA_START = 0x3040;
const HIRAGANA_END = 0x309f;
const KATAKANA_START = 0x30a0;
const KATAKANA_END = 0x30ff;
const KATAKANA_PHONETIC_EXT_START = 0x31f0;
const KATAKANA_PHONETIC_EXT_END = 0x31ff;
const KATAKANA_HALFWIDTH_START = 0xff66;
const KATAKANA_HALFWIDTH_END = 0xff9f;

function isKana(code: number): boolean {
  return (code >= HIRAGANA_START && code <= HIRAGANA_END)
    || (code >= KATAKANA_START && code <= KATAKANA_END)
    || (code >= KATAKANA_PHONETIC_EXT_START && code <= KATAKANA_PHONETIC_EXT_END)
    || (code >= KATAKANA_HALFWIDTH_START && code <= KATAKANA_HALFWIDTH_END);
}

function isLatinLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function tallyBlocks(text: string): BlockTally {
  const tally: BlockTally = { kana: 0, latin: 0, total: 0 };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20) continue; // skip ASCII whitespace / control
    tally.total += 1;
    if (isKana(code)) tally.kana += 1;
    else if (isLatinLetter(code)) tally.latin += 1;
  }
  return tally;
}

// Inputs with <4 non-whitespace chars return "unknown" to avoid spurious classifications.
export function detectLanguage(text: string): SupportedLang {
  if (!text) return "unknown";
  const tally = tallyBlocks(text);
  if (tally.total < 4) return "unknown";
  if (tally.kana > 0) return "ja";
  if (tally.latin / tally.total >= 0.6) return "en";
  return "unknown";
}
