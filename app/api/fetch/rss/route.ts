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
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
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
    console.error("[fetch/rss] Parse failed:", feedUrl, err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      return NextResponse.json({ error: "Could not reach this feed. Check the URL and try again." }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not parse this feed. It may not be valid RSS/Atom." }, { status: 422 });
  }

  const items = (feed.items || []).slice(0, Math.min(limit, 50)).map(item => {
    const rawContent = item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
    const textContent = rawContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const enc = item.enclosure as { url?: string; type?: string } | undefined;
    let imageUrl: string | undefined;
    if (enc?.url && /image/i.test(enc.type || "")) {
      imageUrl = enc.url;
    } else {
      const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch?.[1]) imageUrl = imgMatch[1];
    }
    return {
      title: item.title || "",
      content: textContent.slice(0, 5000),
      link: item.link || "",
      author: item.creator || item.author || "",
      publishedDate: item.pubDate || item.isoDate || "",
      imageUrl,
    };
  });

  return NextResponse.json({
    feedTitle: feed.title || feedUrl,
    items,
  });
}
