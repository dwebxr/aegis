import type { Verdict } from "@/lib/types/content";

export interface WebLLMStatus {
  available: boolean;
  loaded: boolean;
  loading: boolean;
  progress: number; // 0-100
  error?: string;
}

export interface WebLLMScoreResult {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: Verdict;
  reason: string;
  topics: string[];
  vSignal: number;
  cContext: number;
  lSlop: number;
}
