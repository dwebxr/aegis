import { NextRequest, NextResponse } from "next/server";
import type { UserContext } from "@/lib/preferences/types";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { distributedRateLimit, checkBodySize } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";

export const maxDuration = 30;

const sanitizeTopics = (arr: unknown): string[] =>
  Array.isArray(arr)
    ? arr.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t): t is string => t.length > 0 && t.length < 80).slice(0, 20)
    : [];

function sanitizeUserContext(rawCtx?: UserContext): UserContext | undefined {
  if (!rawCtx) return undefined;
  return {
    recentTopics: sanitizeTopics(rawCtx.recentTopics),
    highAffinityTopics: sanitizeTopics(rawCtx.highAffinityTopics),
    lowAffinityTopics: sanitizeTopics(rawCtx.lowAffinityTopics),
    trustedAuthors: sanitizeTopics(rawCtx.trustedAuthors),
  };
}

async function scoreOneText(
  text: string,
  userContext: UserContext | undefined,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const allTopics = userContext
    ? [...userContext.recentTopics, ...userContext.highAffinityTopics].filter(Boolean)
    : [];
  const prompt = buildScoringPrompt(text, allTopics.length > 0 ? allTopics : undefined, 5000);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}`);
  }

  const data = await res.json();
  const rawText = data.content?.[0]?.text || "";
  const parsed = parseScoreResponse(rawText);

  if (!parsed) {
    throw new Error("Failed to parse AI response");
  }

  return { ...parsed, tier: "claude" };
}

export async function POST(request: NextRequest) {
  const limited = await distributedRateLimit(request, 20, 60);
  if (limited) return limited;
  const tooLarge = checkBodySize(request, 64_000);
  if (tooLarge) return tooLarge;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, texts, userContext: rawCtx } = body as {
    text?: string;
    texts?: string[];
    userContext?: UserContext;
  };

  const userContext = sanitizeUserContext(rawCtx);
  const userKey = request.headers.get("x-user-api-key");
  const isUserKey = !!(userKey && userKey.startsWith("sk-ant-"));
  const apiKey = isUserKey ? userKey : process.env.ANTHROPIC_API_KEY?.trim();

  // --- Batch mode ---
  if (texts && Array.isArray(texts)) {
    const validTexts = texts
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map(t => t.slice(0, 10000))
      .slice(0, 10);

    if (validTexts.length === 0) {
      return NextResponse.json({ error: "At least one text is required" }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({
        results: validTexts.map(t => ({ ...heuristicScores(t), tier: "heuristic" })),
      });
    }
    if (!isUserKey && !(await withinDailyBudget())) {
      return NextResponse.json({
        results: validTexts.map(t => ({ ...heuristicScores(t), tier: "heuristic" })),
      });
    }

    const results = await Promise.allSettled(
      validTexts.map(async (t) => {
        if (!isUserKey) await recordApiCall();
        return scoreOneText(t, userContext, apiKey!);
      }),
    );

    return NextResponse.json({
      results: results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { ...heuristicScores(validTexts[i]), tier: "heuristic" },
      ),
    });
  }

  // --- Single mode (backward compatible) ---
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }
  if (text.length > 10000) {
    return NextResponse.json({ error: "Text exceeds 10000 character limit" }, { status: 400 });
  }

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

  try {
    const result = await scoreOneText(text, userContext, apiKey);
    return NextResponse.json(result);
  } catch (err) {
    const msg = errMsg(err);
    console.error("[analyze] Scoring failed:", msg);
    let errorMsg: string;
    if (msg.includes("Failed to parse AI response")) {
      errorMsg = "Failed to parse AI response";
    } else if (msg.includes("Unexpected") || msg.includes("JSON") || msg.includes("parse")) {
      errorMsg = "Failed to parse Anthropic response";
    } else {
      errorMsg = "Request failed";
    }
    return NextResponse.json({ error: errorMsg, fallback: heuristic }, { status: 502 });
  }
}
