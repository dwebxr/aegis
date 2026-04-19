export type ScoringEngine = "ollama" | "webllm" | "mediapipe" | "claude-byok" | "claude-ic" | "claude-server" | "heuristic";

export const ENGINE_LABELS: Record<ScoringEngine, string> = {
  "ollama": "Ollama",
  "webllm": "WebLLM",
  "mediapipe": "MediaPipe",
  "claude-byok": "Claude (BYOK)",
  "claude-ic": "IC LLM",
  "claude-server": "Claude (Server)",
  "heuristic": "Heuristic",
};

export function encodeEngineInReason(engine: ScoringEngine, reason: string): string {
  return `[${engine}] ${reason}`;
}

export function encodeTopicsInReason(reason: string, topics?: string[]): string {
  if (!topics || topics.length === 0) return reason;
  return `${reason} [topics:${topics.join(",")}]`;
}

export function decodeEngineFromReason(reason: string): { engine?: ScoringEngine; cleanReason: string } {
  const match = reason.match(/^\[([a-z-]+)\] /);
  if (match && match[1] in ENGINE_LABELS) {
    return { engine: match[1] as ScoringEngine, cleanReason: reason.slice(match[0].length) };
  }
  if (reason.startsWith("Heuristic")) return { engine: "heuristic", cleanReason: reason };
  return { engine: undefined, cleanReason: reason };
}

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
  // Structurally identical to `Verdict` in `@/lib/types/content`. Inlined
  // here to break the type-only circular dependency between these two
  // sibling type modules (madge cycle). Keep in sync with `Verdict`.
  verdict: "quality" | "slop";
  reason: string;
  topics: string[];
  vSignal: number;
  cContext: number;
  lSlop: number;
}
