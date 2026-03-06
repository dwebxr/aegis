import { NextRequest, NextResponse } from "next/server";
import { extract } from "@extractus/article-extractor";
import { guardAndParse } from "@/lib/api/rateLimit";
import { blockPrivateUrl } from "@/lib/utils/url";
import { withTimeout } from "@/lib/utils/timeout";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const { body, error } = await guardAndParse<{ url?: string }>(request);
  if (error) return error;
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const blocked = blockPrivateUrl(url);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 });
  }
  const parsed = new URL(url);

  let article;
  try {
    article = await withTimeout(extract(url), 15_000, "Article extraction timed out");
  } catch (err) {
    console.error("[fetch/url] Extract failed:", url, err);
    return NextResponse.json({ error: "Could not reach this URL. Please verify it is accessible." }, { status: 502 });
  }

  if (!article) {
    return NextResponse.json({ error: "Page returned no parseable content — it may require authentication or JavaScript" }, { status: 422 });
  }

  if (!article.content) {
    return NextResponse.json({ error: "Page loaded but contained no article text" }, { status: 422 });
  }

  const textContent = article.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  if (textContent.length < 50) {
    return NextResponse.json({ error: "Extracted content is too short to evaluate meaningfully." }, { status: 422 });
  }

  return NextResponse.json({
    title: article.title || "",
    author: article.author || "Unknown",
    content: textContent.slice(0, 10000),
    description: article.description || "",
    publishedDate: article.published || "",
    source: parsed.hostname,
    imageUrl: article.image || undefined,
  });
}
