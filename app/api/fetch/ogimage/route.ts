import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { blockPrivateUrl } from "@/lib/utils/url";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 10;

/**
 * Lightweight endpoint: fetch only the OG image URL from a page.
 * Returns { imageUrl: string | null }.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const blocked = blockPrivateUrl(url);
  if (blocked) {
    return NextResponse.json({ imageUrl: null });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Aegis/1.0 (OG Image Fetcher)" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ imageUrl: null });
    }

    // Read only first 50KB to find OG tags (avoid downloading full page)
    const reader = res.body?.getReader();
    if (!reader) return NextResponse.json({ imageUrl: null });

    let html = "";
    const decoder = new TextDecoder();
    const MAX_BYTES = 50_000;
    let totalBytes = 0;

    while (totalBytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      html += decoder.decode(value, { stream: true });
      // Stop early if we've passed </head>
      if (html.includes("</head>")) break;
    }
    reader.cancel().catch(() => {}); // cleanup — errors here are non-critical

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
