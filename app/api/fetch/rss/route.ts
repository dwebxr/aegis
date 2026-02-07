import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Aegis/2.0 Content Quality Filter",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { feedUrl, limit = 20 } = body;

  if (!feedUrl || typeof feedUrl !== "string") {
    return NextResponse.json({ error: "Feed URL is required" }, { status: 400 });
  }

  try {
    new URL(feedUrl);
  } catch {
    return NextResponse.json({ error: "Invalid feed URL format" }, { status: 400 });
  }

  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      return NextResponse.json({ error: "Could not reach this feed. Check the URL and try again." }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not parse this feed. It may not be valid RSS/Atom." }, { status: 422 });
  }

  const items = (feed.items || []).slice(0, Math.min(limit, 50)).map(item => {
    const rawContent = item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
    const textContent = rawContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return {
      title: item.title || "",
      content: textContent.slice(0, 5000),
      link: item.link || "",
      author: item.creator || item.author || "",
      publishedDate: item.pubDate || item.isoDate || "",
    };
  });

  return NextResponse.json({
    feedTitle: feed.title || feedUrl,
    items,
  });
}
