import type { ContentItem } from "@/lib/types/content";
import type { RawItem } from "@/lib/ingestion/fetchers";
import { quickSlopFilter } from "@/lib/ingestion/quickFilter";
import { scoreItemWithHeuristics } from "@/lib/filtering/pipeline";

/**
 * Static demo feed.
 *
 * The anonymous demo used to run the live ingestion pipeline, so every visit
 * invoked /api/fetch/rss and /api/fetch/url on the server. It reads a committed
 * snapshot from the CDN instead — zero server functions, zero Active CPU.
 *
 * Only the INPUT is frozen. Filtering and scoring still run live in the
 * browser, so the demo keeps showing what the real pipeline decides, and the
 * snapshot stays a plain content file with no scores to go stale.
 *
 * Regenerate with `node scripts/generate-demo-feed.mjs`.
 */

/** Served from public/ — a CDN hit, never a function invocation. */
export const DEMO_FEED_PATH = "/demo-feed.json";

/** Bumped by scripts/generate-demo-feed.mjs on a breaking shape change. */
export const DEMO_FEED_SCHEMA_VERSION = 1;

/** Caps applied on read so a bad snapshot cannot bloat the demo view. */
const MAX_ITEMS = 30;
const MAX_TEXT_LENGTH = 2000;

export interface DemoFeedItem {
  text: string;
  author: string;
  sourceUrl?: string;
  imageUrl?: string;
  /** Which lib/demo/sources.ts feed this came from. */
  feedUrl: string;
}

function isDemoFeedItem(value: unknown): value is DemoFeedItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.text === "string"
    && item.text.length > 0
    && typeof item.author === "string"
    && typeof item.feedUrl === "string";
}

/**
 * Fetches and scores the snapshot. Throws when the file is missing or malformed
 * so the caller can tell the visitor — an empty demo looks identical to "the
 * filter rejected everything", which would hide the outage. There is no fallback
 * to live ingestion: that is exactly the server cost this replaces.
 */
export async function loadDemoFeed(signal?: AbortSignal): Promise<ContentItem[]> {
  const res = await fetch(DEMO_FEED_PATH, { signal });
  if (!res.ok) throw new Error(`Demo feed unavailable (HTTP ${res.status})`);

  const payload: unknown = await res.json();
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Demo feed is not an object");
  }
  const { schemaVersion, items: rawItems } = payload as { schemaVersion?: unknown; items?: unknown };
  if (schemaVersion !== DEMO_FEED_SCHEMA_VERSION) {
    throw new Error(`Demo feed schema ${String(schemaVersion)} is not supported`);
  }
  if (!Array.isArray(rawItems)) throw new Error("Demo feed has no items array");

  return rawItems
    .slice(0, MAX_ITEMS)
    .filter(isDemoFeedItem)
    .filter(item => quickSlopFilter(item.text))
    .map(item => {
      const raw: RawItem = {
        text: item.text.slice(0, MAX_TEXT_LENGTH),
        author: item.author,
        sourceUrl: item.sourceUrl,
        imageUrl: item.imageUrl,
      };
      return scoreItemWithHeuristics(raw, "rss");
    });
}
