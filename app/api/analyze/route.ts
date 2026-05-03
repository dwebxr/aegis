import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { UserContext } from "@/lib/preferences/types";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { distributedRateLimit, checkBodySize, parseJsonBody } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { callAnthropic, ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { resolveAnthropicKey } from "@/lib/api/byok";
import { isFeatureEnabled } from "@/lib/featureFlags";

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
): Promise<ScoreParseResult & { tier: "claude" }> {
  const allTopics = userContext
    ? [...userContext.recentTopics, ...userContext.highAffinityTopics].filter(Boolean)
    : [];
  const prompt = buildScoringPrompt(text, allTopics.length > 0 ? allTopics : undefined, 5000);

  const res = await callAnthropic({
    apiKey,
    model: ANTHROPIC_DEFAULT_MODEL,
    maxTokens: 1000,
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 15_000,
  });

  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}`);
  }

  const parsed = parseScoreResponse(res.text);

  if (!parsed) {
    throw new Error("Failed to parse AI response");
  }

  return { ...parsed, tier: "claude" as const };
}

export async function POST(request: NextRequest) {
  const limited = await distributedRateLimit(request, 20, 60);
  if (limited) return limited;
  const tooLarge = checkBodySize(request, 64_000);
  if (tooLarge) return tooLarge;

  const parsed = await parseJsonBody<{
    text?: string;
    texts?: string[];
    userContext?: UserContext;
  }>(request);
  if (parsed.error) return parsed.error;
  const { text, texts, userContext: rawCtx } = parsed.body;

  const userContext = sanitizeUserContext(rawCtx);
  const { key: apiKey, isUser: isUserKey } = resolveAnthropicKey(request);

  // Scoring-cascade kill switch: when OFF, short-circuit to heuristic
  // regardless of keys or budget. Client cascade treats this tier's
  // response as authoritative for "claude-server" — heuristic result
  // is a valid AnalyzeResponse so client fallback logic is unchanged.
  const cascadeEnabled = isFeatureEnabled("scoringCascade");

  if (texts && Array.isArray(texts)) {
    const validTexts = texts
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map(t => t.slice(0, 10000))
      .slice(0, 10);

    if (validTexts.length === 0) {
      return NextResponse.json({ error: "At least one text is required" }, { status: 400 });
    }

    if (!cascadeEnabled || !apiKey) {
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

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }
  if (text.length > 10000) {
    return NextResponse.json({ error: "Text exceeds 10000 character limit" }, { status: 400 });
  }

  const heuristic = { ...heuristicScores(text), tier: "heuristic" as const };

  if (!cascadeEnabled) {
    return NextResponse.json(heuristic);
  }
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
    Sentry.captureException(err, {
      tags: { route: "analyze", failure: "anthropic-scoring" },
      extra: { isUserKey, msgPreview: msg.slice(0, 200) },
    });
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
