import "server-only";
import * as Sentry from "@/lib/observability";
import { extractFromHtml } from "@extractus/article-extractor";
import { type ExtractionResult, withUrlCache } from "@/lib/cache/urlExtract";
import { errMsg } from "@/lib/utils/errors";
import { readCappedText } from "@/lib/utils/httpBody.server";
import { safeFetch } from "@/lib/utils/safeFetch.server";
import { stripHtmlToText } from "@/lib/utils/text";
import { withTimeout } from "@/lib/utils/timeout";
import { blockPrivateUrl } from "@/lib/utils/url";

// Bounds how much markup the DOM parser has to walk — parsing is the single
// most CPU-expensive step here — without cutting real pages off. 512KB was
// tried first and rejected: mainstream article pages routinely exceed it (a
// live WIRED article measured 1.8MB), and extractFromHtml returns null on a
// document truncated before <article>, turning a working 200 into a 422. 2MB
// clears the pages that were checked and is still a 60% cut from the old 5MB.
const MAX_HTML_BYTES = 2_000_000;

async function fetchAndExtract(url: string) {
  const res = await safeFetch(url, {
    headers: { "user-agent": "AegisBot/1.0 (+https://aegis-ai.xyz)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  const { text: html, truncated } = await readCappedText(res, MAX_HTML_BYTES);
  return { article: await extractFromHtml(html, url), truncated };
}

export async function extractArticle(url: string): Promise<ExtractionResult> {
  // Every check that decides whether this URL may be fetched at all runs BEFORE
  // any cache is consulted. The extraction cache is shared across all visitors
  // now, so a lookup must never be able to answer for a URL that the SSRF and
  // credential rules would have rejected.
  const blocked = blockPrivateUrl(url);
  if (blocked) return { error: blocked, status: 400 };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL", status: 400 };
  }
  if (parsed.username || parsed.password) {
    return { error: "URLs with embedded credentials are not allowed", status: 400 };
  }

  return withUrlCache(url, async () => {
    let article;
    let truncated = false;
    try {
      ({ article, truncated } = await withTimeout(fetchAndExtract(url), 15_000, "Article extraction timed out"));
    } catch (err) {
      const safeUrl = `${parsed.origin}${parsed.pathname}`;
      console.error("[fetch/url] Extract failed:", safeUrl, errMsg(err));
      Sentry.captureException(err, {
        tags: { route: "fetch-url", failure: "extract" },
        extra: { url: safeUrl },
      });
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

    return {
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
      // A body that hit the byte cap may be missing the end of the article. It
      // is good enough to answer this request, but it must not be published to
      // the cache every other visitor reads for the next 24 hours.
      partial: truncated,
    };
  });
}
