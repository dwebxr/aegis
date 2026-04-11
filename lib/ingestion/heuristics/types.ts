/**
 * Per-language heuristic scoring contracts.
 *
 * Each language module exports a `score<Lang>(text)` function returning a
 * `LanguageSignals` object — additive adjustments to the 5/5/5 baseline plus
 * the human-readable reasons that triggered them. The dispatcher in
 * `quickFilter.ts` sums signals (per-language + optional shared common) and
 * clamps to the [0, 10] range before computing the composite score.
 */

export interface LanguageSignals {
  originality: number;
  insight: number;
  credibility: number;
  reasons: string[];
}

export function emptySignals(): LanguageSignals {
  return { originality: 0, insight: 0, credibility: 0, reasons: [] };
}
