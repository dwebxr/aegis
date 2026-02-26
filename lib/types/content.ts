export type Verdict = "quality" | "slop";

export type ContentSource = "manual" | "rss" | "url" | "twitter" | "nostr" | "farcaster";

export interface ScoreBreakdown {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
}

export interface ContentEvaluation {
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
}
