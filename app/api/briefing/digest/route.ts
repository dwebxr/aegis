import { NextRequest, NextResponse } from "next/server";
import { rateLimit, checkBodySize } from "@/lib/api/rateLimit";
import { withinDailyBudget, recordApiCall } from "@/lib/api/dailyBudget";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;

interface DigestArticle {
  title: string;
  text: string;
  score: number;
  topics: string[];
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 5, 60_000);
  if (limited) return limited;
  const tooLarge = checkBodySize(request, 32_000);
  if (tooLarge) return tooLarge;

  let body: { articles?: DigestArticle[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.articles) || body.articles.length === 0) {
    return NextResponse.json({ error: "articles array is required" }, { status: 400 });
  }

  const articles = body.articles.slice(0, 5);

  const userKey = request.headers.get("x-user-api-key");
  const isUserKey = !!(userKey && userKey.startsWith("sk-ant-"));
  const apiKey = isUserKey ? userKey : process.env.ANTHROPIC_API_KEY?.trim();

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
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `API error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const digest = data.content?.[0]?.text?.trim() || "";

    return NextResponse.json({ digest });
  } catch (err) {
    return NextResponse.json(
      { error: `Request failed: ${errMsg(err)}` },
      { status: 502 },
    );
  }
}
