import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { extractFromHtml } from "@extractus/article-extractor";
import { distributedGuardAndParse } from "@/lib/api/rateLimit";
import { blockPrivateUrl } from "@/lib/utils/url";
import { safeFetch } from "@/lib/utils/safeFetch.server";
import { readCappedText } from "@/lib/utils/httpBody.server";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";
import { stripHtmlToText } from "@/lib/utils/text";
import { type ExtractionResult, getUrlCached, setUrlCache } from "@/lib/cache/urlExtract";

const MAX_HTML_BYTES = 5_000_000;

export const maxDuration = 30;

// SSRF-safe fetch + extract: hostname/IP are validated by safeFetch on every
// redirect hop, so article-extractor never sees a raw URL that could resolve
// to a private network.
async function fetchAndExtract(url: string) {
  const res = await safeFetch(url, {
    headers: { "user-agent": "AegisBot/1.0 (+https://aegis-ai.xyz)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  // Streamed, hard-capped read — never buffers an unbounded chunked body (no
  // Content-Length) into function memory before the size check. Oversize bodies
  // are truncated to the cap and still extracted, matching fetch/discover-feed.
  const html = await readCappedText(res, MAX_HTML_BYTES);
  return extractFromHtml(html, url);
}

async function extractOne(url: string): Promise<ExtractionResult> {
  const cached = getUrlCached(url);
  if (cached) return cached;

  const blocked = blockPrivateUrl(url);
  if (blocked) {
    return { error: blocked, status: 400 };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL", status: 400 };
  }

  let article;
  try {
    article = await withTimeout(fetchAndExtract(url), 15_000, "Article extraction timed out");
  } catch (err) {
    console.error("[fetch/url] Extract failed:", url, errMsg(err));
    Sentry.captureException(err, { tags: { route: "fetch-url", failure: "extract" }, extra: { url } });
    return { error: "Could not reach this URL. Please verify it is accessible.", status: 502 };
  }

  if (!article) {
    return { error: "Page returned no parseable content — it may require authentication or JavaScript", status: 422 };
  }

  if (!article.content) {
    return { error: "Page loaded but contained no article text", status: 422 };
  }

  const textContent = stripHtmlToText(article.content);

  if (textContent.length < 50) {
    return { error: "Extracted content is too short to evaluate meaningfully.", status: 422 };
  }

  const result: ExtractionResult = {
    data: {
      title: article.title || "",
      author: article.author || "Unknown",
      content: textContent.slice(0, 10000),
      description: article.description || "",
      publishedDate: article.published || "",
      source: parsed.hostname,
      imageUrl: article.image || undefined,
    },
    status: 200,
  };
  setUrlCache(url, result);
  return result;
}

export async function POST(request: NextRequest) {
  const { body, error } = await distributedGuardAndParse<{ url?: string; urls?: string[] }>(request);
  if (error) return error;

  const { url, urls } = body;

  if (urls && Array.isArray(urls)) {
    const validUrls = urls
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 10);

    if (validUrls.length === 0) {
      return NextResponse.json({ error: "At least one URL is required" }, { status: 400 });
    }

    const extractions = await Promise.allSettled(validUrls.map(u => extractOne(u)));
    return NextResponse.json({
      results: extractions.map((r, i) => {
        if (r.status === "fulfilled") {
          const ex = r.value;
          return ex.data
            ? { url: validUrls[i], ...ex.data }
            : { url: validUrls[i], error: ex.error };
        }
        return { url: validUrls[i], error: "Extraction failed" };
      }),
    });
  }

  // Single mode (backward compatible — preserves exact status codes)
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const result = await extractOne(url);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
