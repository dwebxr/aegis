import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { blockPrivateUrl } from "@/lib/utils/url";
import { detectPlatformFeed, extractYouTubeChannelId } from "@/lib/sources/platformFeed";

export const maxDuration = 30;

const COMMON_PATHS = ["/feed", "/rss", "/feed.xml", "/atom.xml", "/rss.xml", "/index.xml"];

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 15, 60_000);
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

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const blocked = blockPrivateUrl(url);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 });
  }

  const platformResult = detectPlatformFeed(parsedUrl);
  if (platformResult) {
    return NextResponse.json(platformResult);
  }

  const feeds: Array<{ url: string; title?: string; type?: string }> = [];

  // Step 1: Fetch HTML and look for <link rel="alternate"> tags
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Aegis/2.0 Feed Discovery",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const cl = parseInt(res.headers?.get("content-length") || "0", 10);
      if (cl > 5_000_000) {
        console.warn("[discover-feed] Skipping oversized response:", cl);
      } else {
        const raw = await res.text();
        const html = raw.length > 2_000_000 ? raw.slice(0, 2_000_000) : raw;

        const host = parsedUrl.hostname.replace("www.", "");
        if ((host === "youtube.com" || host === "m.youtube.com") && feeds.length === 0) {
          const channelId = extractYouTubeChannelId(html);
          if (channelId) {
            feeds.push({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, title: "YouTube Channel", type: "atom" });
          }
        }

        const linkRegex = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
        let match;
        let iters = 0;
        while ((match = linkRegex.exec(html)) !== null && iters++ < 100) {
          const tag = match[0];
          const typeMatch = tag.match(/type=["']([^"']+)["']/);
          const hrefMatch = tag.match(/href=["']([^"']+)["']/);
          const titleMatch = tag.match(/title=["']([^"']+)["']/);

          if (hrefMatch && typeMatch) {
            const type = typeMatch[1].toLowerCase();
            if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
              let feedUrl = hrefMatch[1];
              if (feedUrl.startsWith("/")) {
                feedUrl = `${parsedUrl.origin}${feedUrl}`;
              } else if (!feedUrl.startsWith("http")) {
                feedUrl = new URL(feedUrl, url).href;
              }
              feeds.push({
                url: feedUrl,
                title: titleMatch?.[1],
                type: type.includes("atom") ? "atom" : "rss",
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[discover-feed] HTML fetch failed:", errMsg(err));
  }

  // Step 2: If no feeds found via <link> tags, probe common paths
  if (feeds.length === 0) {
    const origin = parsedUrl.origin;
    const probed = await Promise.all(
      COMMON_PATHS.map(async (path) => {
        const probeUrl = `${origin}${path}`;
        if (blockPrivateUrl(probeUrl)) return null;

        try {
          const res = await fetch(probeUrl, {
            method: "HEAD",
            headers: { "User-Agent": "Aegis/2.0 Feed Discovery" },
            signal: AbortSignal.timeout(5_000),
            redirect: "follow",
          });
          const ct = res.headers.get("content-type") ?? "";
          if (res.ok && (ct.includes("xml") || ct.includes("rss") || ct.includes("atom"))) {
            return { url: probeUrl, type: "rss" };
          }
        } catch { /* probe 404 is expected for most paths */ }
        return null;
      })
    );

    feeds.push(...probed.filter((f): f is NonNullable<typeof f> => f !== null));
  }

  return NextResponse.json({ feeds });
}
