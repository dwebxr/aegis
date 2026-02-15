import type { ScoreParseResult } from "./types";
import { clamp } from "@/lib/utils/math";

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreField(parsed: any, key: string): number {
  return clamp(num(parsed[key], 5), 0, 10);
}

/**
 * Parse a raw LLM response string into a ScoreParseResult.
 * Handles JSON fences (```json ... ```), extracts the first JSON object,
 * clamps values to 0-10, and derives composite/verdict.
 * Returns null if parsing fails entirely.
 */
export function parseScoreResponse(raw: string): ScoreParseResult | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    const vSignal = scoreField(parsed, "vSignal");
    const cContext = scoreField(parsed, "cContext");
    const lSlop = scoreField(parsed, "lSlop");
    const originality = scoreField(parsed, "originality");
    const insight = scoreField(parsed, "insight");
    const credibility = scoreField(parsed, "credibility");

    const rawComposite = num(parsed.composite, (vSignal * cContext) / (lSlop + 0.5));
    const composite = clamp(rawComposite, 0, 10);

    const verdict: "quality" | "slop" = parsed.verdict === "quality" ? "quality" : "slop";
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "";
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t: unknown) => typeof t === "string").slice(0, 10)
      : [];

    return { originality, insight, credibility, composite, verdict, reason, topics, vSignal, cContext, lSlop };
  } catch {
    return null;
  }
}
