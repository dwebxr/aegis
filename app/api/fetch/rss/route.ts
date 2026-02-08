import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Aegis/2.0 Content Quality Filter",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:group", "mediaGroup", { keepArray: false }],
    ],
  },
});

/** Extract an XML attribute from rss-parser's custom field value.
 *  rss-parser returns custom fields as either { $: { url, ... } } or a raw string. */
function extractAttr(field: unknown, attr: string): string | undefined {
  if (!field) return undefined;
  if (typeof field === "string") return attr === "url" ? field : undefined;
  if (typeof field === "object") {
    const obj = field as Record<string, unknown>;
    // rss-parser wraps attrs in `$`: { $: { url: "...", type: "..." } }
    if (obj.$ && typeof obj.$ === "object") {
      const attrs = obj.$ as Record<string, string>;
      return attrs[attr];
    }
    // Direct attribute access
    if (typeof obj[attr] === "string") return obj[attr] as string;
  }
  return undefined;
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = item as any;
    const rawContent: string = raw["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
    const textContent = rawContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const enc = item.enclosure as { url?: string; type?: string } | undefined;
    let imageUrl: string | undefined;
    if (enc?.url && /image/i.test(enc.type || "")) {
      // Standard RSS enclosure with image type
      imageUrl = enc.url;
    } else if (extractAttr(raw.mediaThumbnail, "url")) {
      // YouTube: <media:thumbnail url="..."/>
      imageUrl = extractAttr(raw.mediaThumbnail, "url");
    } else if (extractAttr(raw.mediaContent, "url") && /image/i.test(extractAttr(raw.mediaContent, "type") || "")) {
      // <media:content url="..." type="image/..."/>
      imageUrl = extractAttr(raw.mediaContent, "url");
    } else if (raw.mediaGroup && typeof raw.mediaGroup === "object") {
      // YouTube: <media:group><media:thumbnail url="..."/></media:group>
      const group = raw.mediaGroup as Record<string, unknown>;
      const thumb = extractAttr(group["media:thumbnail"], "url");
      if (thumb) imageUrl = thumb;
    } else if (raw.itunes && typeof raw.itunes === "object") {
      // Podcast: <itunes:image href="..."/>
      if (typeof raw.itunes.image === "string") imageUrl = raw.itunes.image;
    } else {
      // Fallback: extract <img src="..."> from HTML content
      const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch?.[1]) imageUrl = imgMatch[1];
    }
    return {
      title: item.title || "",
      content: textContent.slice(0, 5000),
      link: item.link || "",
      author: item.creator || raw.author || "",
      publishedDate: item.pubDate || item.isoDate || "",
      imageUrl,
    };
  });

  return NextResponse.json({
    feedTitle: feed.title || feedUrl,
    items,
  });
}
