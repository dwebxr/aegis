import { NextRequest, NextResponse } from "next/server";
import type { UserContext } from "@/lib/preferences/types";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { rateLimit } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;

function buildPrompt(text: string, userContext?: UserContext): string {
  const contentSlice = text.slice(0, 5000);

  if (userContext && (userContext.recentTopics.length > 0 || userContext.highAffinityTopics.length > 0)) {
    return `You are the Aegis Slop Incinerator AI. Evaluate this content using the V/C/L framework.

User's current interests: ${userContext.recentTopics.join(", ") || "general"}
User's high-affinity topics: ${userContext.highAffinityTopics.join(", ") || "none yet"}
User's low-affinity topics: ${userContext.lowAffinityTopics.join(", ") || "none yet"}

Score each dimension 0-10:
- V_signal: Information density & novelty. Does this contain genuinely new information, data, or analysis?
- C_context: Relevance to this specific user's interests listed above. How well does this match what they care about?
- L_slop: Clickbait, engagement farming, rehashed content, empty opinions. Higher = more slop.

Also score the legacy axes (for backward compatibility):
- Originality (0-10): Novel or rehashed?
- Insight (0-10): Deep analysis or surface-level?
- Credibility (0-10): Reliable sourcing?

Extract 1-3 topic tags from the content (lowercase, single words or short phrases).

Composite score: S = (V_signal * C_context) / (L_slop + 0.5), then normalize to 0-10 scale.
Verdict: "quality" if composite >= 4, else "slop".

Content: "${contentSlice}"

Respond ONLY in this exact JSON format:
{"vSignal":N,"cContext":N,"lSlop":N,"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief explanation","topics":["tag1","tag2"]}`;
  }

  // Legacy prompt (no personalization)
  return `You are the Aegis Slop Incinerator AI. Evaluate this content for quality. Score each axis 0-10:
- Originality (40%): Novel or rehashed?
- Insight (35%): Deep analysis?
- Credibility (25%): Reliable sources?

Content: "${contentSlice}"

Respond ONLY in this exact JSON format:
{"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief"}`;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 20, 60_000);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { text, userContext } = body as { text?: string; userContext?: UserContext };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  if (text.length > 10000) {
    return NextResponse.json({ error: "Text exceeds 10000 character limit" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !withinDailyBudget()) {
    const fallback = heuristicScores(text);
    return NextResponse.json({ ...fallback, tier: "heuristic" });
  }
  recordApiCall();

  const prompt = buildPrompt(text, userContext);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    console.error("[analyze] Anthropic fetch failed:", errMsg(err));
    const fallback = heuristicScores(text);
    return NextResponse.json({ error: "Request failed", fallback: { ...fallback, tier: "heuristic" } }, { status: 502 });
  }

  clearTimeout(timeout);

  if (!res.ok) {
    const fallback = heuristicScores(text);
    return NextResponse.json({ error: `Anthropic API error: ${res.status}`, fallback: { ...fallback, tier: "heuristic" } }, { status: 502 });
  }

  let data;
  try { data = await res.json(); } catch (err) {
    console.error("[analyze] Failed to parse Anthropic JSON:", errMsg(err));
    const fallback = heuristicScores(text);
    return NextResponse.json({ error: "Failed to parse Anthropic response", fallback: { ...fallback, tier: "heuristic" } }, { status: 502 });
  }
  const rawText = data.content?.[0]?.text || "";
  const clean = rawText.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // AI returned non-JSON — use heuristic instead of unreliable regex extraction
    console.warn("[analyze] AI returned non-JSON (length:", clean.length, "), falling back to heuristic");
    const fallback = heuristicScores(text);
    return NextResponse.json({ error: "Failed to parse AI response", fallback: { ...fallback, tier: "heuristic" } }, { status: 502 });
  }

  const response: Record<string, unknown> = {
    originality: parsed.originality,
    insight: parsed.insight,
    credibility: parsed.credibility,
    composite: parsed.composite,
    verdict: parsed.verdict,
    reason: parsed.reason || "",
  };

  // Include V/C/L and topics if present (personalized response)
  if (parsed.vSignal !== undefined) response.vSignal = parsed.vSignal;
  if (parsed.cContext !== undefined) response.cContext = parsed.cContext;
  if (parsed.lSlop !== undefined) response.lSlop = parsed.lSlop;
  if (Array.isArray(parsed.topics)) response.topics = parsed.topics;
  response.tier = "claude";

  return NextResponse.json(response);
}
