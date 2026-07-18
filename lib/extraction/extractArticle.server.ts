import "server-only";
import * as Sentry from "@sentry/nextjs";
import { extractFromHtml } from "@extractus/article-extractor";
import { type ExtractionResult, getUrlCached, setUrlCache } from "@/lib/cache/urlExtract";
import { errMsg } from "@/lib/utils/errors";
import { readCappedText } from "@/lib/utils/httpBody.server";
import { safeFetch } from "@/lib/utils/safeFetch.server";
import { stripHtmlToText } from "@/lib/utils/text";
import { withTimeout } from "@/lib/utils/timeout";
import { blockPrivateUrl } from "@/lib/utils/url";

const MAX_HTML_BYTES = 5_000_000;

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
  const html = await readCappedText(res, MAX_HTML_BYTES);
  return extractFromHtml(html, url);
}

export async function extractArticle(url: string): Promise<ExtractionResult> {
  const cached = getUrlCached(url);
  if (cached) return cached;

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

  let article;
  try {
    article = await withTimeout(fetchAndExtract(url), 15_000, "Article extraction timed out");
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
