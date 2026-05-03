export type Verdict = "quality" | "slop";

type ContentSource = "manual" | "rss" | "url" | "twitter" | "nostr" | "farcaster";

export interface ScoreBreakdown {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
}

interface ContentEvaluation {
  id: string;
  owner: string;
  author: string;
  avatar: string;
  text: string;
  source: ContentSource;
  sourceUrl?: string;
  imageUrl?: string;
  scores: ScoreBreakdown;
  verdict: Verdict;
  reason: string;
  createdAt: number;
  validated: boolean;
  flagged: boolean;
  validatedAt?: number;
}

/** Extract scoring-result fields from an AnalyzeResponse-shaped object into ContentItem fields. */
export function scoredItemFields(result: {
  originality: number; insight: number; credibility: number; composite: number;
  verdict: Verdict; reason: string;
  topics?: string[]; vSignal?: number; cContext?: number; lSlop?: number;
  scoringEngine?: import("@/lib/scoring/types").ScoringEngine;
}) {
  return {
    scores: {
      originality: result.originality,
      insight: result.insight,
      credibility: result.credibility,
      composite: result.composite,
    },
    verdict: result.verdict,
    reason: result.reason,
    createdAt: Date.now(),
    validated: false as const,
    flagged: false as const,
    timestamp: "just now" as const,
    topics: result.topics,
    vSignal: result.vSignal,
    cContext: result.cContext,
    lSlop: result.lSlop,
    scoredByAI: result.scoringEngine !== "heuristic",
    scoringEngine: result.scoringEngine,
  };
}

export interface ContentItem extends ContentEvaluation {
  nostrPubkey?: string;
  timestamp: string;
  topics?: string[];
  vSignal?: number;
  cContext?: number;
  lSlop?: number;
  /** true = scored by AI (Claude API / IC LLM), false = heuristic. Omitted on legacy items. */
  scoredByAI?: boolean;
  /** Which scoring engine produced the scores */
  scoringEngine?: import("@/lib/scoring/types").ScoringEngine;
  /** Original platform (e.g. "youtube", "bluesky") for RSS-type items. Omitted for direct nostr. */
  platform?: import("@/lib/types/sources").SourcePlatform;
  /** Translation result, populated by translation engine */
  translation?: import("@/lib/translation/types").TranslationResult;
}
