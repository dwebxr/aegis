import { NextRequest, NextResponse } from "next/server";
import type { UserContext } from "@/lib/preferences/types";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { rateLimit } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 20, 60_000);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { text, userContext: rawCtx } = body as { text?: string; userContext?: UserContext };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  if (text.length > 10000) {
    return NextResponse.json({ error: "Text exceeds 10000 character limit" }, { status: 400 });
  }

  // Sanitize userContext: only allow short string arrays for topic fields
  const sanitizeTopics = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t): t is string => t.length > 0 && t.length < 80).slice(0, 20)
      : [];
  const userContext: UserContext | undefined = rawCtx ? {
    recentTopics: sanitizeTopics(rawCtx.recentTopics),
    highAffinityTopics: sanitizeTopics(rawCtx.highAffinityTopics),
    lowAffinityTopics: sanitizeTopics(rawCtx.lowAffinityTopics),
    trustedAuthors: sanitizeTopics(rawCtx.trustedAuthors),
  } : undefined;

  const userKey = request.headers.get("x-user-api-key");
  const isUserKey = !!(userKey && userKey.startsWith("sk-ant-"));
  const apiKey = isUserKey ? userKey : process.env.ANTHROPIC_API_KEY?.trim();

  const heuristic = { ...heuristicScores(text), tier: "heuristic" as const };

  if (!apiKey) {
    console.warn("[analyze] No API key available, using heuristic fallback");
    return NextResponse.json(heuristic);
  }
  if (!isUserKey && !(await withinDailyBudget())) {
    console.warn("[analyze] Daily budget exhausted, using heuristic fallback");
    return NextResponse.json(heuristic);
  }
  if (!isUserKey) await recordApiCall();

  const allTopics = userContext
    ? [...userContext.recentTopics, ...userContext.highAffinityTopics].filter(Boolean)
    : [];
  const prompt = buildScoringPrompt(text, allTopics.length > 0 ? allTopics : undefined, 5000);

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
    return NextResponse.json({ error: "Request failed", fallback: heuristic }, { status: 502 });
  }

  clearTimeout(timeout);

  if (!res.ok) {
    console.error(`[analyze] Anthropic API returned ${res.status}`);
    return NextResponse.json({ error: `Anthropic API error: ${res.status}`, fallback: heuristic }, { status: 502 });
  }

  let data;
  try { data = await res.json(); } catch (err) {
    console.error("[analyze] Failed to parse Anthropic JSON:", errMsg(err));
    return NextResponse.json({ error: "Failed to parse Anthropic response", fallback: heuristic }, { status: 502 });
  }
  const rawText = data.content?.[0]?.text || "";
  const parsed = parseScoreResponse(rawText);

  if (!parsed) {
    console.warn("[analyze] AI returned non-JSON, falling back to heuristic");
    return NextResponse.json({ error: "Failed to parse AI response", fallback: heuristic }, { status: 502 });
  }

  return NextResponse.json({ ...parsed, tier: "claude" });
}
