export interface D2ABriefingItem {
  title: string;
  content: string;
  source: string;
  sourceUrl: string;
  scores: {
    originality: number;
    insight: number;
    credibility: number;
    composite: number;
    vSignal?: number;
    cContext?: number;
    lSlop?: number;
  };
  verdict: "quality" | "slop";
  reason: string;
  topics: string[];
  briefingScore: number;
}

export interface D2ABriefingResponse {
  version: "1.0";
  generatedAt: string;
  source: "aegis";
  sourceUrl: string;
  summary: {
    totalEvaluated: number;
    totalBurned: number;
    qualityRate: number;
  };
  items: D2ABriefingItem[];
  serendipityPick: D2ABriefingItem | null;
  meta: {
    scoringModel: string;
    nostrPubkey: string | null;
    topics: string[];
  };
}

/** Only "added" — true diff (updated/removed) requires server-side snapshot storage. */
export interface BriefingChange {
  action: "added";
  itemHash: string;
  title: string;
  sourceUrl: string;
  composite: number;
  generatedAt: string;
}

export interface ChangesResponse {
  since: string;
  checkedAt: string;
  changes: BriefingChange[];
}

export type { GlobalBriefingResponse, GlobalBriefingContributor } from "./briefingProvider";
