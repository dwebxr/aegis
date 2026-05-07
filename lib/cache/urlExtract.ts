/** In-memory cache for extracted articles. TTL = 30 min. */

/**
 * Shape of `data` produced by /api/fetch/url after running
 * `@extractus/article-extractor` and post-processing. Fields originate
 * from the extractor (title, author, description, image, published) plus
 * the post-processed text content and parsed hostname.
 */
interface ExtractedArticle {
  title: string;
  author: string;
  content: string;
  description: string;
  publishedDate: string;
  source: string;
  imageUrl?: string;
}

export interface ExtractionResult {
  data?: ExtractedArticle;
  error?: string;
  status: number;
}

const urlCache = new Map<string, { data: ExtractionResult; expiresAt: number }>();
const URL_CACHE_TTL = 30 * 60 * 1000;
const URL_CACHE_MAX = 200;

export function getUrlCached(url: string): ExtractionResult | undefined {
  const entry = urlCache.get(url);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    urlCache.delete(url);
    return undefined;
  }
  return entry.data;
}

export function setUrlCache(url: string, result: ExtractionResult): void {
  if (urlCache.size >= URL_CACHE_MAX) {
    const first = urlCache.keys().next().value;
    if (first) urlCache.delete(first);
  }
  urlCache.set(url, { data: result, expiresAt: Date.now() + URL_CACHE_TTL });
}

export function _resetUrlCache(): void {
  urlCache.clear();
}
