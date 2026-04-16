import { NextRequest, NextResponse } from "next/server";
import { guardAndParse } from "@/lib/api/rateLimit";
import { safeFetch } from "@/lib/utils/url";
import { errMsg } from "@/lib/utils/errors";
import { getOgCached, setOgCache } from "@/lib/cache/ogimage";

export const maxDuration = 15;

async function extractOgImage(url: string): Promise<string | null> {
  const cached = getOgCached(url);
  if (cached !== undefined) return cached;

  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Aegis/1.0 (OG Image Fetcher)" },
    });

    if (!res.ok) {
      console.debug(`[fetch/ogimage] upstream returned ${res.status} for ${url}`);
      setOgCache(url, null);
      return null;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setOgCache(url, null);
      return null;
    }

    let html = "";
    const decoder = new TextDecoder();
    const MAX_BYTES = 50_000;
    let totalBytes = 0;

    try {
      while (totalBytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        html += decoder.decode(value, { stream: true });
        if (html.includes("</head>")) break;
      }
    } finally {
      reader.cancel().catch((e) => console.debug("[fetch/ogimage] stream cancel:", e));
    }

    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    const raw = ogMatch?.[1] || null;
    const imageUrl = raw ? new URL(raw, url).href : null;
    setOgCache(url, imageUrl);
    return imageUrl;
  } catch (err) {
    console.warn("[fetch/ogimage] OG extraction failed:", errMsg(err));
    setOgCache(url, null);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { body, error } = await guardAndParse<{ url?: string; urls?: string[] }>(request, { limit: 60 });
  if (error) return error;

  const { url, urls } = body;

  if (urls && Array.isArray(urls)) {
    const validUrls = urls.filter(u => typeof u === "string" && u.length > 0).slice(0, 30);
    if (validUrls.length === 0) {
      return NextResponse.json({ error: "At least one valid URL is required" }, { status: 400 });
    }
    const results = await Promise.all(
      validUrls.map(async (u) => ({
        url: u,
        imageUrl: await extractOgImage(u),
      })),
    );
    return NextResponse.json({ results });
  }

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const imageUrl = await extractOgImage(url);
  return NextResponse.json({ imageUrl });
}
