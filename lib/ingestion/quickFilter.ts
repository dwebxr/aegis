// Per-language dispatcher. To add a language: add lib/ingestion/heuristics/<lang>.ts exporting
// score<Lang>(text): LanguageSignals, register in dispatch below, teach langDetect to detect it.
import { clamp } from "@/lib/utils/math";
import { detectLanguage, type SupportedLang } from "./langDetect";
import { scoreEnglish } from "./heuristics/en";
import { scoreJapanese } from "./heuristics/ja";
import type { Verdict } from "@/lib/types/content";

interface HeuristicScores {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: Verdict;
  reason: string;
  detectedLang?: SupportedLang;
}

interface HeuristicOptions {
  // Override automatic detection.
  lang?: SupportedLang;
}

export function heuristicScores(text: string, options?: HeuristicOptions): HeuristicScores {
  const lang = options?.lang ?? detectLanguage(text);
  // "en" and "unknown" both use the English module to preserve legacy ASCII behaviour.
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
