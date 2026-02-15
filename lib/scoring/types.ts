import type { Verdict } from "@/lib/types/content";

export type ScoringEngine = "ollama" | "webllm" | "claude-byok" | "claude-ic" | "claude-server" | "heuristic";

export interface ScoreParseResult {
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
