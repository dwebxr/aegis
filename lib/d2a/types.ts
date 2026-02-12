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
  sourceUrl: "https://aegis.dwebxr.xyz";
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
