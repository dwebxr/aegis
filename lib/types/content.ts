export type Verdict = "quality" | "slop";

export type ContentSource = "manual" | "rss" | "url" | "twitter" | "nostr";

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
  scores: ScoreBreakdown;
  verdict: Verdict;
  reason: string;
  createdAt: number;
  validated: boolean;
  flagged: boolean;
}

export interface ContentItem extends ContentEvaluation {
  timestamp: string;
}
