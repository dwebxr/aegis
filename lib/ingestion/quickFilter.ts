/**
 * Heuristic text-quality scoring (no API call needed).
 * Used as fallback in /api/analyze and as pre-filter in ingestion.
 *
 * Multi-language dispatcher: detects the input language and applies the
 * appropriate per-language signal set. English is preserved byte-for-byte
 * with the legacy implementation; Japanese gets a dedicated rule set
 * tailored to clickbait/quality vocabulary and punctuation patterns common
 * in Japanese-language news and social posts.
 *
 * Adding a new language: create a `lib/ingestion/heuristics/<lang>.ts`
 * exporting `score<Lang>(text): LanguageSignals`, register it in the
 * dispatch below, and teach `langDetect.ts` to recognize it.
 */
import { clamp } from "@/lib/utils/math";
import { detectLanguage, type SupportedLang } from "./langDetect";
import { scoreEnglish } from "./heuristics/en";
import { scoreJapanese } from "./heuristics/ja";

export interface HeuristicScores {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: "quality" | "slop";
  reason: string;
  /** Language used to compute the signals (added in the multi-lang refactor). */
  detectedLang?: SupportedLang;
}

export interface HeuristicOptions {
  /** Override automatic language detection. */
  lang?: SupportedLang;
}

export function heuristicScores(text: string, options?: HeuristicOptions): HeuristicScores {
  const lang = options?.lang ?? detectLanguage(text);
  // "en" and "unknown" both fall back to the English module so pre-existing
  // behaviour is preserved for ASCII-dominant inputs and any text where
  // detection isn't confident.
  const signals = lang === "ja" ? scoreJapanese(text) : scoreEnglish(text);

  const originality = clamp(5 + signals.originality, 0, 10);
  const insight = clamp(5 + signals.insight, 0, 10);
  const credibility = clamp(5 + signals.credibility, 0, 10);
  const composite = parseFloat((originality * 0.4 + insight * 0.35 + credibility * 0.25).toFixed(1));

  const reason = signals.reasons.length > 0
    ? `Heuristic (AI unavailable): ${signals.reasons.join(", ")}.`
    : "Heuristic (AI unavailable): no strong signals detected.";

  return {
    originality,
    insight,
    credibility,
    composite,
    verdict: composite >= 4 ? "quality" : "slop",
    reason,
    detectedLang: lang,
  };
}

export function quickSlopFilter(text: string, threshold: number = 3.5): boolean {
  return heuristicScores(text).composite >= threshold;
}
