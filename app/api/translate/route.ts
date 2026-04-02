import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit, checkBodySize } from "@/lib/api/rateLimit";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const rateLimited = await distributedRateLimit(request, 10, 60);
  if (rateLimited) return rateLimited;

  const bodyErr = await checkBodySize(request, 32_000);
  if (bodyErr) return bodyErr;

  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 10_000) : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const userKey = request.headers.get("x-user-api-key");
  const apiKey = userKey?.startsWith("sk-ant-") ? userKey : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "No API key available" }, { status: 503 });
  }

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
