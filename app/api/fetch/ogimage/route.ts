import { NextRequest, NextResponse } from "next/server";
import { guardAndParse } from "@/lib/api/rateLimit";
import { safeFetch } from "@/lib/utils/url";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const { body, error } = await guardAndParse<{ url?: string }>(request, { limit: 60 });
  if (error) return error;

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Aegis/1.0 (OG Image Fetcher)" },
    });

    if (!res.ok) {
      console.debug(`[fetch/ogimage] upstream returned ${res.status} for ${url}`);
      return NextResponse.json({ imageUrl: null });
    }

    // Read only first 50KB to find OG tags (avoid downloading full page)
    const reader = res.body?.getReader();
    if (!reader) return NextResponse.json({ imageUrl: null });

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
    // Resolve relative URLs against the page origin
    const imageUrl = raw ? new URL(raw, url).href : null;
    return NextResponse.json({ imageUrl });
  } catch (err) {
    console.warn("[fetch/ogimage] OG extraction failed:", errMsg(err));
    return NextResponse.json({ imageUrl: null });
  }
}
