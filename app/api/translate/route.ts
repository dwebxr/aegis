import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { distributedRateLimit, checkBodySize, parseJsonBody } from "@/lib/api/rateLimit";
import { callAnthropic, ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { requireUserByokKey } from "@/lib/api/byok";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("translationCascade")) {
    return NextResponse.json({ error: "Translation disabled" }, { status: 503 });
  }

  // 60 req/60s per IP. Translation is per-item and a power user with a
  // briefing of 50+ articles can easily exceed 10/60s during a single
  // page load.
  const rateLimited = await distributedRateLimit(request, 60, 60);
  if (rateLimited) return rateLimited;

  const bodyErr = checkBodySize(request, 32_000);
  if (bodyErr) return bodyErr;

  const parsed = await parseJsonBody<{ prompt?: unknown }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 10_000) : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // BYOK-only: enforce at the boundary so a regressed/malicious client cannot
  // bill translation to the operator's Anthropic key.
  const apiKey = requireUserByokKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Translation requires an Anthropic API key in the x-user-api-key header (BYOK)." },
      { status: 401 },
    );
  }

  let res;
  try {
    res = await callAnthropic({
      apiKey,
      model: ANTHROPIC_DEFAULT_MODEL,
      maxTokens: 4000,
      messages: [{ role: "user", content: prompt }],
      timeoutMs: 25_000,
    });
  } catch (err) {
    // callAnthropic throws (not {ok:false}) on a network error or the 25s timeout
    // abort — without this the exception propagates uncaught, with no route-tagged
    // Sentry context (unlike the sibling briefing/digest route).
    console.error("[translate] Claude API call failed:", errMsg(err));
    Sentry.captureException(err, { tags: { route: "translate", failure: "anthropic" } });
    return NextResponse.json({ error: "Translation service unavailable" }, { status: 502 });
  }

  if (!res.ok) {
    // Log only the status — never the raw upstream body, which can echo request
    // fragments. Detailed triage goes through Sentry/Anthropic's own logs.
    console.error("[translate] Claude API error:", res.status);
    return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 502 });
  }

  const translation = res.text.trim();
  if (!translation) {
    return NextResponse.json({ error: "Empty response from Claude" }, { status: 502 });
  }

  return NextResponse.json({ translation });
}
