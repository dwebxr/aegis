import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit, checkBodySize } from "@/lib/api/rateLimit";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
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
  const userKey = request.headers.get("x-user-api-key");
  if (!userKey || !userKey.startsWith("sk-ant-")) {
    return NextResponse.json(
      { error: "Translation requires an Anthropic API key in the x-user-api-key header (BYOK)." },
      { status: 401 },
    );
  }
  const apiKey = userKey;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[translate] Claude API error:", res.status, errText.slice(0, 200));
    return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  const translation = data.content?.[0]?.text?.trim() ?? "";

  if (!translation) {
    return NextResponse.json({ error: "Empty response from Claude" }, { status: 502 });
  }

  return NextResponse.json({ translation });
}
