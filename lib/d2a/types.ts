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

export interface GlobalBriefingContributor {
  principal: string;
  generatedAt: string;
  summary: {
    totalEvaluated: number;
    totalBurned: number;
    qualityRate: number;
  };
  topItems: Array<{
    title: string;
    topics: string[];
    briefingScore: number;
    verdict: "quality" | "slop";
  }>;
}

export interface GlobalBriefingResponse {
  version: "1.0";
  type: "global";
  generatedAt: string;
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
  contributors: GlobalBriefingContributor[];
  aggregatedTopics: string[];
  totalEvaluated: number;
  totalQualityRate: number;
}
