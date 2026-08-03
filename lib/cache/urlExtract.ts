import { createHash } from "node:crypto";
import { urlExtractKV } from "@/lib/api/kv/namespace";
import { errMsg } from "@/lib/utils/errors";

/** Two-tier cache for extracted articles: in-process (30 min) over KV (24 h). */

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
  /** Set when the source body hit its byte cap. Such a result answers the
   *  request and may be reused inside this instance, but is never written to
   *  the shared cache — a prefix of a page must not become everyone's copy. */
  partial?: boolean;
}

const urlCache = new Map<string, { data: ExtractionResult; expiresAt: number }>();
const URL_CACHE_TTL = 30 * 60 * 1000;
const URL_CACHE_MAX = 200;

/** Article extraction is the most expensive thing this deployment does per CPU
 *  second (~85-115ms of DOM parsing per page), and the same handful of headline
 *  URLs is requested by every reader. A day is long enough to collapse that to
 *  one extraction per URL across all instances without serving genuinely stale
 *  article bodies — published articles do not change materially after a day. */
const SHARED_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** Bumped when ExtractedArticle changes shape, so old entries are ignored
 *  rather than deserialised into a shape the reader no longer expects. */
const SHARED_KEY_PREFIX = "v1:";

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

/** URLs run to 2KB and carry query tokens. Hashing keeps the key bounded and
 *  keeps the raw URL out of the key space an operator can read back. */
function sharedKey(url: string): string {
  return SHARED_KEY_PREFIX + createHash("sha256").update(url).digest("hex");
}

/** KV holds whatever was written last — validate before trusting it, so a
 *  corrupted or hand-edited entry degrades to a re-extraction, not to a
 *  response assembled from missing fields. */
function isExtractedArticle(value: unknown): value is ExtractedArticle {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return typeof a.title === "string"
    && typeof a.author === "string"
    && typeof a.content === "string"
    && a.content.length > 0
    && typeof a.description === "string"
    && typeof a.publishedDate === "string"
    && typeof a.source === "string"
    && (a.imageUrl === undefined || typeof a.imageUrl === "string");
}

/** In-flight extractions per instance, so a batch containing the same URL twice
 *  — or two concurrent requests for the same headline — parses it once. */
const inFlight = new Map<string, Promise<ExtractionResult>>();

/**
 * Reads the shared cache. Never throws: a cache is an optimisation, and a KV
 * outage must degrade to re-extracting, not to a 500 from the extraction API.
 * Callers MUST validate the URL (scheme, private-address block, credentials)
 * before calling — this layer is shared across every visitor and must never be
 * the thing that decides a URL was allowed.
 */
async function readShared(url: string): Promise<ExtractionResult | undefined> {
  try {
    const cached = await urlExtractKV.get<unknown>(sharedKey(url));
    // undefined = KV not configured or unavailable; null = key absent.
    if (!cached) return undefined;
    if (!isExtractedArticle(cached)) return undefined;
    return { data: cached, status: 200 };
  } catch (err) {
    console.warn("[urlExtract] shared cache read failed:", errMsg(err));
    return undefined;
  }
}

/** Writes the shared cache. Successes only — an error result is specific to one
 *  attempt and must not be replayed to every other visitor for a day. */
async function writeShared(url: string, result: ExtractionResult): Promise<void> {
  if (!result.data) return;
  try {
    await urlExtractKV.set(sharedKey(url), result.data, { ex: SHARED_CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn("[urlExtract] shared cache write failed:", errMsg(err));
  }
}

/**
 * Runs `extract` for `url` unless a cached or in-flight result already answers
 * it. Layered in-process → KV → extract, populating the cheaper layers on the
 * way back.
 */
export async function withUrlCache(
  url: string,
  extract: () => Promise<ExtractionResult>,
): Promise<ExtractionResult> {
  const local = getUrlCached(url);
  if (local) return local;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const run = (async () => {
    const shared = await readShared(url);
    if (shared) {
      setUrlCache(url, shared);
      return shared;
    }
    const result = await extract();
    if (result.data) {
      setUrlCache(url, result);
      if (!result.partial) await writeShared(url, result);
    }
    return result;
  })().finally(() => inFlight.delete(url));

  inFlight.set(url, run);
  return run;
}

export function _resetUrlCache(): void {
  urlCache.clear();
  inFlight.clear();
}
