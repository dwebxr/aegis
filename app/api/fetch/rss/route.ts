import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { blockPrivateUrl } from "@/lib/utils/url";

export const maxDuration = 30;

function feedErrorResponse(err: unknown, feedUrl: string, context: string): NextResponse {
  console.error(`[fetch/rss] ${context}:`, feedUrl, err);
  const msg = errMsg(err);
  if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
    return NextResponse.json({ error: "Could not reach this feed. Check the URL and try again." }, { status: 502 });
  }
  return NextResponse.json({ error: "Could not parse feed" }, { status: 422 });
}

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

/** Extract an XML attribute from rss-parser's custom field value. */
function extractAttr(field: unknown, attr: string): string | undefined {
  if (!field) return undefined;
  if (typeof field === "string") return attr === "url" ? field : undefined;
  if (typeof field === "object") {
    const obj = field as Record<string, unknown>;
    // rss-parser wraps attrs in `$`: { $: { url: "...", type: "..." } }
    if (obj.$ && typeof obj.$ === "object") {
      const attrs = obj.$ as Record<string, unknown>;
      const val = attrs[attr];
      return typeof val === "string" ? val : undefined;
    }
    if (typeof obj[attr] === "string") return obj[attr] as string;
  }
  return undefined;
}

function extractImage(item: Record<string, unknown>, rawContent: string): string | undefined {
  const enc = item.enclosure as { url?: string; type?: string } | undefined;
  if (enc?.url && /image/i.test(enc.type || "")) return enc.url;
  const thumbUrl = extractAttr(item.mediaThumbnail, "url");
  if (thumbUrl) return thumbUrl;
  const mediaUrl = extractAttr(item.mediaContent, "url");
  if (mediaUrl && /image/i.test(extractAttr(item.mediaContent, "type") || "")) {
    return mediaUrl;
  }
  if (item.mediaGroup && typeof item.mediaGroup === "object") {
    const group = item.mediaGroup as Record<string, unknown>;
    const thumb = extractAttr(group["media:thumbnail"], "url");
    if (thumb) return thumb;
  }
  if (item.itunes && typeof item.itunes === "object") {
    const itunes = item.itunes as Record<string, unknown>;
    if (typeof itunes.image === "string") return itunes.image;
  }
  const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return imgMatch[1];
  return undefined;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { feedUrl, limit: rawLimit, etag, lastModified } = body;
  const limit = typeof rawLimit === "number" && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 20;

  if (!feedUrl || typeof feedUrl !== "string") {
    return NextResponse.json({ error: "Feed URL is required" }, { status: 400 });
  }

  const blocked = blockPrivateUrl(feedUrl);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Aegis/2.0 Content Quality Filter",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const res = await fetch(feedUrl, { headers, signal: AbortSignal.timeout(10_000) });

    if (res.status === 304) {
      return NextResponse.json({
        feedTitle: "",
        notModified: true,
        etag: res.headers.get("etag") || etag,
        lastModified: res.headers.get("last-modified") || lastModified,
        items: [],
      });
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Feed returned HTTP ${res.status}` }, { status: 502 });
    }

    const xml = await res.text();
    const feed = await parser.parseString(xml);

    return NextResponse.json({
      feedTitle: feed.title || feedUrl,
      etag: res.headers.get("etag") || undefined,
      lastModified: res.headers.get("last-modified") || undefined,
      items: buildItems(feed, limit),
    });
  } catch (err: unknown) {
    return feedErrorResponse(err, feedUrl, "Fetch/parse failed");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rss-parser Output type uses `any` for media extensions
function buildItems(feed: Parser.Output<any>, limit: number) {
  return (feed.items || []).slice(0, Math.min(limit, 50)).map(item => {
    const raw = item as unknown as Record<string, unknown>;
    const contentEncoded = typeof raw["content:encoded"] === "string" ? raw["content:encoded"] : "";
    const rawContent: string = contentEncoded || item.content || item.contentSnippet || item.summary || "";
    const textContent = rawContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const imageUrl = extractImage(raw, rawContent);
    const rawAuthor = typeof raw.author === "string" ? raw.author : "";
    return {
      title: item.title || "",
      content: textContent.slice(0, 5000),
      link: item.link || "",
      author: item.creator || rawAuthor || "",
      publishedDate: item.pubDate || item.isoDate || "",
      imageUrl,
    };
  });
}
