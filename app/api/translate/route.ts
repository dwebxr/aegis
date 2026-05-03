import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit, checkBodySize } from "@/lib/api/rateLimit";
import { callAnthropic, ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { requireUserByokKey } from "@/lib/api/byok";
import { isFeatureEnabled } from "@/lib/featureFlags";

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

  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 10_000) : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // BYOK-only: the operator's Anthropic key is NEVER used for
  // translation. The client-side `translateContent` in
  // `lib/translation/engine.ts` removed claude-server from the auto
  // cascade in hotfix 17 and made `backend: "cloud"` require a user
  // API key — this route enforces the same invariant at the boundary
  // so a malicious or regressed client cannot burn the operator's
  // budget by hitting the endpoint directly.
  const apiKey = requireUserByokKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Translation requires an Anthropic API key in the x-user-api-key header (BYOK)." },
      { status: 401 },
    );
  }

  const res = await callAnthropic({
    apiKey,
    model: ANTHROPIC_DEFAULT_MODEL,
    maxTokens: 4000,
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 25_000,
  });

  if (!res.ok) {
    console.error("[translate] Claude API error:", res.status, String(res.raw).slice(0, 200));
    return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 502 });
  }

  const translation = res.text.trim();
  if (!translation) {
    return NextResponse.json({ error: "Empty response from Claude" }, { status: 502 });
  }

  return NextResponse.json({ translation });
}
