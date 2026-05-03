import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { distributedRateLimit, checkBodySize, parseJsonBody } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";
import { callAnthropic, ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { resolveAnthropicKey } from "@/lib/api/byok";

export const maxDuration = 30;

interface DigestArticle {
  title: string;
  text: string;
  score: number;
  topics: string[];
}

export async function POST(request: NextRequest) {
  const limited = await distributedRateLimit(request, 5, 60);
  if (limited) return limited;
  const tooLarge = checkBodySize(request, 32_000);
  if (tooLarge) return tooLarge;

  const parsed = await parseJsonBody<{ articles?: DigestArticle[] }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  if (!Array.isArray(body.articles) || body.articles.length === 0) {
    return NextResponse.json({ error: "articles array is required" }, { status: 400 });
  }

  const articles = body.articles.slice(0, 5);

  const { key: apiKey, isUser: isUserKey } = resolveAnthropicKey(request);

  if (!apiKey) {
    return NextResponse.json({ error: "No API key available" }, { status: 503 });
  }
  if (!isUserKey && !(await withinDailyBudget())) {
    return NextResponse.json({ error: "Daily budget exhausted" }, { status: 429 });
  }
  if (!isUserKey) await recordApiCall();

  const articleSummaries = articles
    .map(
      (a, i) =>
        `${i + 1}. [Score: ${a.score.toFixed(1)}] ${a.title.slice(0, 80)}\n   ${a.text.slice(0, 200)}\n   Topics: ${a.topics.join(", ")}`,
    )
    .join("\n\n");

  const prompt = `You are a concise news digest writer. Summarize these top-rated articles into a single cohesive paragraph of 200-300 characters. The digest should capture the key themes and most important insights. Write in a clear, professional tone. If the content is in Japanese, write the digest in Japanese; otherwise write in English.

Articles:
${articleSummaries}

Respond with ONLY the digest paragraph, no labels or formatting.`;

  try {
    const res = await callAnthropic({
      apiKey,
      model: ANTHROPIC_DEFAULT_MODEL,
      maxTokens: 300,
      messages: [{ role: "user", content: prompt }],
      timeoutMs: 15_000,
    });

    if (!res.ok) {
      console.error(`[briefing/digest] Anthropic API returned ${res.status}`);
      return NextResponse.json({ error: "Request failed" }, { status: 502 });
    }

    return NextResponse.json({ digest: res.text.trim() });
  } catch (err) {
    console.error("[briefing/digest] Anthropic request failed:", errMsg(err));
    Sentry.captureException(err, { tags: { route: "briefing-digest", failure: "anthropic" } });
    return NextResponse.json(
      { error: "Request failed" },
      { status: 502 },
    );
  }
}
