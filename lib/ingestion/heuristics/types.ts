/**
 * Per-language heuristic scoring contracts.
 *
 * Each language module exports a `scoreLanguage(text)` function that returns
 * a `LanguageSignals` object — adjustments to apply on top of the 5/5/5
 * baseline scores along with the human-readable reasons that triggered them.
 *
 * The dispatcher in `quickFilter.ts` then sums signals from the language
 * module + any optional common signals (currently the English module
 * implements its own length/link/data signals to preserve byte-for-byte
 * backwards compatibility, while non-English modules use the shared
 * `commonSignals` helper).
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

export function mergeSignals(...sets: LanguageSignals[]): LanguageSignals {
  const out = emptySignals();
  for (const s of sets) {
    out.originality += s.originality;
    out.insight += s.insight;
    out.credibility += s.credibility;
    out.reasons.push(...s.reasons);
  }
  return out;
}
