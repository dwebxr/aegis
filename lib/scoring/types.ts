import type { Verdict } from "@/lib/types/content";

export type ScoringEngine = "ollama" | "webllm" | "claude-byok" | "claude-ic" | "claude-server" | "heuristic";

export const ENGINE_LABELS: Record<ScoringEngine, string> = {
  "ollama": "Ollama",
  "webllm": "WebLLM",
  "claude-byok": "Claude (BYOK)",
  "claude-ic": "IC LLM",
  "claude-server": "Claude (Server)",
  "heuristic": "Heuristic",
};

/** Prepend `[engine-id] ` to reason text for IC canister persistence. */
export function encodeEngineInReason(engine: ScoringEngine, reason: string): string {
  return `[${engine}] ${reason}`;
}

/** Append `[topics:tag1,tag2]` to reason for IC canister persistence. */
export function encodeTopicsInReason(reason: string, topics?: string[]): string {
  if (!topics || topics.length === 0) return reason;
  return `${reason} [topics:${topics.join(",")}]`;
}

/** Extract engine id from reason prefix. Returns cleanReason with prefix stripped. */
export function decodeEngineFromReason(reason: string): { engine?: ScoringEngine; cleanReason: string } {
  const match = reason.match(/^\[([a-z-]+)\] /);
  if (match && match[1] in ENGINE_LABELS) {
    return { engine: match[1] as ScoringEngine, cleanReason: reason.slice(match[0].length) };
  }
  if (reason.startsWith("Heuristic")) return { engine: "heuristic", cleanReason: reason };
  return { engine: undefined, cleanReason: reason };
}

/** Extract topics from `[topics:tag1,tag2]` suffix in reason. */
export function decodeTopicsFromReason(reason: string): { topics: string[]; cleanReason: string } {
  const match = reason.match(/ \[topics:([^\]]+)\]$/);
  if (!match) return { topics: [], cleanReason: reason };
  const topics = match[1].split(",").map(t => t.trim()).filter(Boolean);
  return { topics, cleanReason: reason.slice(0, match.index!) };
}

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
