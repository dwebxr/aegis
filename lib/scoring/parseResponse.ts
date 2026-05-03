import type { ScoreParseResult } from "./types";
import type { Verdict } from "@/lib/types/content";
import { clamp } from "@/lib/utils/math";

function toNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreField(parsed: Record<string, unknown>, key: string): number {
  return clamp(toNum(parsed[key], 5), 0, 10);
}

// Strips ```json fences, picks first {...}, clamps fields 0-10, derives composite if missing.
export function parseScoreResponse(raw: string): ScoreParseResult | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
    const rawParsed: unknown = JSON.parse(jsonStr);
    if (typeof rawParsed !== "object" || rawParsed === null) return null;
    const parsed = rawParsed as Record<string, unknown>;

    const vSignal = scoreField(parsed, "vSignal");
    const cContext = scoreField(parsed, "cContext");
    const lSlop = scoreField(parsed, "lSlop");
    const originality = scoreField(parsed, "originality");
    const insight = scoreField(parsed, "insight");
    const credibility = scoreField(parsed, "credibility");

    const hasComposite = parsed.composite != null && Number.isFinite(Number(parsed.composite));
    const rawComposite = hasComposite ? Number(parsed.composite) : (vSignal * cContext) / (lSlop + 0.5);
    if (!hasComposite) {
      console.warn("[parseResponse] LLM omitted composite score, using fallback formula:", rawComposite.toFixed(2));
    }
    const composite = clamp(rawComposite, 0, 10);

    const rawVerdict = parsed.verdict;
    if (rawVerdict !== "quality" && rawVerdict !== "slop") {
      console.warn("[parseResponse] Unexpected verdict from LLM:", JSON.stringify(rawVerdict), "— defaulting to slop");
    }
    const verdict: Verdict = rawVerdict === "quality" ? "quality" : "slop";
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "";
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t: unknown) => typeof t === "string").slice(0, 10)
      : [];

    return { originality, insight, credibility, composite, verdict, reason, topics, vSignal, cContext, lSlop };
  } catch (err) {
    console.warn("[parseResponse] Failed to parse LLM response:", err);
    return null;
  }
}
