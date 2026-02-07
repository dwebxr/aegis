import { NextRequest, NextResponse } from "next/server";

function generateFallbackScores(text: string) {
  const words = text.split(/\s+/).length;
  const exclamationDensity = (text.match(/!/g) || []).length / Math.max(words, 1);
  const emojiRegex = new RegExp("[\\u{1F600}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]", "gu");
  const emojiCount = (text.match(emojiRegex) || []).length;
  const emojiDensity = emojiCount / Math.max(words, 1);
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);
  const hasLinks = /https?:\/\//.test(text);
  const hasData = /\d+%|\$\d|[0-9]+\.[0-9]/.test(text);

  let originality = 5;
  let insight = 5;
  let credibility = 5;

  if (exclamationDensity > 0.1) { originality -= 3; credibility -= 3; }
  if (emojiDensity > 0.05) { originality -= 2; }
  if (capsRatio > 0.3) { credibility -= 3; originality -= 2; }
  if (words > 50) { insight += 1; }
  if (words > 100) { insight += 1; originality += 1; }
  if (hasLinks) { credibility += 2; }
  if (hasData) { insight += 2; credibility += 1; }

  originality = Math.max(0, Math.min(10, originality));
  insight = Math.max(0, Math.min(10, insight));
  credibility = Math.max(0, Math.min(10, credibility));

  const composite = parseFloat((originality * 0.4 + insight * 0.35 + credibility * 0.25).toFixed(1));
  return {
    originality, insight, credibility, composite,
    verdict: composite >= 4 ? "quality" as const : "slop" as const,
    reason: "Estimated scores (AI unavailable). Based on text analysis heuristics.",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text } = body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  if (text.length > 10000) {
    return NextResponse.json({ error: "Text exceeds 10000 character limit" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallback = generateFallbackScores(text);
    return NextResponse.json({ error: "API key not configured", fallback });
  }

  const prompt = `You are the Aegis Slop Incinerator AI. Evaluate this content for quality. Score each axis 0-10:
- Originality (40%): Novel or rehashed?
- Insight (35%): Deep analysis?
- Credibility (25%): Reliable sources?

Content: "${text.slice(0, 5000)}"

Respond ONLY in this exact JSON format:
{"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief"}`;

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
  } catch {
    clearTimeout(timeout);
    const fallback = generateFallbackScores(text);
    return NextResponse.json({ error: "Request failed", fallback });
  }

  clearTimeout(timeout);

  if (!res.ok) {
    const fallback = generateFallbackScores(text);
    return NextResponse.json({ error: `Anthropic API error: ${res.status}`, fallback });
  }

  const data = await res.json();
  const rawText = data.content?.[0]?.text || "";
  const clean = rawText.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const numMatch = clean.match(/(\d+)/g);
    if (numMatch && numMatch.length >= 3) {
      const o = Math.min(10, parseInt(numMatch[0]));
      const ins = Math.min(10, parseInt(numMatch[1]));
      const c = Math.min(10, parseInt(numMatch[2]));
      const composite = parseFloat((o * 0.4 + ins * 0.35 + c * 0.25).toFixed(1));
      parsed = { originality: o, insight: ins, credibility: c, composite, verdict: composite >= 4 ? "quality" : "slop", reason: "Parsed from partial response" };
    } else {
      const fallback = generateFallbackScores(text);
      return NextResponse.json({ error: "Failed to parse AI response", fallback });
    }
  }

  return NextResponse.json({
    originality: parsed.originality,
    insight: parsed.insight,
    credibility: parsed.credibility,
    composite: parsed.composite,
    verdict: parsed.verdict,
    reason: parsed.reason || "",
  });
}
