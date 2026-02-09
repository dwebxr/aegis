import { NextRequest, NextResponse } from "next/server";
import { extract } from "@extractus/article-extractor";
import { rateLimit } from "@/lib/api/rateLimit";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "Invalid URL: must be HTTP or HTTPS" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  let article;
  try {
    article = await extract(url);
  } catch (err) {
    console.error("[fetch/url] Extract failed:", url, err);
    return NextResponse.json({ error: "Could not reach this URL. Please verify it is accessible." }, { status: 502 });
  }

  if (!article || !article.content) {
    return NextResponse.json({ error: "Could not extract article content. This may be a paywall or dynamic page." }, { status: 422 });
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
