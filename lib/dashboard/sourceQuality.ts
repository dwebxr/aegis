import type { ContentItem } from "@/lib/types/content";
import type { SavedSource } from "@/lib/types/sources";
import type { SourceRuntimeState } from "@/lib/ingestion/sourceState";
import { getSourceHealth } from "@/lib/ingestion/sourceState";
import { normalizeUrl } from "@/contexts/content/dedup";
import { isD2AContent } from "@/lib/d2a/activity";

export const MIN_SAMPLE_SIZE = 10;
export const KEEP_QUALITY_YIELD = 0.6;
export const WATCH_FLOOR = 0.3;
export const SLOP_REMOVE_THRESHOLD = 0.5;
export const STALE_DAYS = 30;
export const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

export const TIME_WINDOWS = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
} as const;
export type TimeWindow = keyof typeof TIME_WINDOWS;

export type SourceRecommendation =
  | "keep"
  | "watch"
  | "mute"
  | "remove"
  | "insufficient_data";

export type QualityHealth =
  | "healthy"
  | "noisy"
  | "stale"
  | "learning"
  | "issue";

export interface SourceQualityStats {
  id: string;
  label: string;
  type: SavedSource["type"];
  enabled: boolean;
  scored: number;
  quality: number;
  slop: number;
  validated: number;
  flagged: number;
  duplicatesSuppressed: number;
  qualityYield: number;
  slopRate: number;
  /** (validated + flagged) / scored — share of items the user touched. */
  reviewRate: number;
  lastFetchedAt: number;
  lastError: string;
  fetchHealth: ReturnType<typeof getSourceHealth>;
  qualityHealth: QualityHealth;
  recommendation: SourceRecommendation;
  isStale: boolean;
}

export interface UnattributedStats {
  d2a: { scored: number; quality: number; slop: number };
  manual: { scored: number; quality: number; slop: number };
  sharedUrl: { scored: number; quality: number; slop: number };
  /**
   * Items whose `savedSourceId` references a SavedSource the user has since
   * deleted, with no live source matching by inference (pubkey / hostname /
   * username). The orphan stamp is kept on the item so we can surface these
   * in their own bucket rather than silently dropping them.
   */
  deletedSource: { scored: number; quality: number; slop: number };
}

export function recommend(s: {
  sampleSize: number;
  qualityYield: number;
  slopRate: number;
  fetchHealth: ReturnType<typeof getSourceHealth>;
  isStale: boolean;
}): SourceRecommendation {
  if (s.fetchHealth === "disabled" && s.isStale) return "remove";
  if (s.sampleSize < MIN_SAMPLE_SIZE) return "insufficient_data";
  if (s.slopRate >= SLOP_REMOVE_THRESHOLD) return "mute";
  if (s.qualityYield < WATCH_FLOOR) return "mute";
  if (s.qualityYield < KEEP_QUALITY_YIELD) return "watch";
  return "keep";
}

export function classifyQualityHealth(s: {
  sampleSize: number;
  qualityYield: number;
  slopRate: number;
  fetchHealth: ReturnType<typeof getSourceHealth>;
  isStale: boolean;
}): QualityHealth {
  if (s.fetchHealth === "disabled" || s.fetchHealth === "error") return "issue";
  if (s.isStale) return "stale";
  if (s.sampleSize < MIN_SAMPLE_SIZE) return "learning";
  if (s.slopRate >= SLOP_REMOVE_THRESHOLD || s.qualityYield < WATCH_FLOOR) return "noisy";
  return "healthy";
}

/**
 * True iff the item carries a `savedSourceId` that doesn't match any current
 * SavedSource — i.e. the source it came from has been deleted. Used by both
 * attributeItem (to fall through to re-inference) and computeUnattributedStats
 * (to bucket survivors as "deletedSource").
 */
export function isOrphan(
  item: ContentItem,
  sources: ReadonlyArray<SavedSource>,
): boolean {
  if (!item.savedSourceId) return false;
  for (const s of sources) {
    if (s.id === item.savedSourceId) return false;
  }
  return true;
}

/**
 * Map a ContentItem back to its originating SavedSource id when possible.
 * Mutates `item.savedSourceId` on successful inference so repeat lookups are
 * O(1). Cached stamps are validated against `sources[]` on every call: if the
 * source has been deleted, the stamp is ignored (but kept on the item so the
 * orphan can be detected by isOrphan / computeUnattributedStats).
 *
 * Match priority: live cached stamp > nostr pubkey membership > rss feed
 * hostname (with feedburner / google news intermediaries) > farcaster
 * fid/username in URL.
 */
export function attributeItem(
  item: ContentItem,
  sources: ReadonlyArray<SavedSource>,
): string | undefined {
  if (item.savedSourceId) {
    for (const s of sources) {
      if (s.id === item.savedSourceId) return item.savedSourceId;
    }
    // Stamp points to a deleted source; fall through to re-inference. We do
    // NOT clear item.savedSourceId so isOrphan() can still detect this.
  }

  if (item.source === "nostr" && item.nostrPubkey) {
    for (const s of sources) {
      if (s.type === "nostr" && s.pubkeys?.includes(item.nostrPubkey)) {
        item.savedSourceId = s.id;
        return s.id;
      }
    }
  }

  if (item.source === "rss" && item.sourceUrl) {
    const itemHost = hostnameOf(item.sourceUrl);
    if (itemHost) {
      const intermediate = isFeedRedirector(itemHost);
      const candidates = sources.filter(s => s.type === "rss" && s.feedUrl);

      for (const s of candidates) {
        if (hostnameOf(s.feedUrl!) === itemHost) {
          item.savedSourceId = s.id;
          return s.id;
        }
      }
      if (intermediate && candidates.length === 1) {
        item.savedSourceId = candidates[0].id;
        return candidates[0].id;
      }
      if (intermediate) {
        const target = extractRedirectTarget(item.sourceUrl);
        if (target) {
          for (const s of candidates) {
            if (hostnameOf(s.feedUrl!) === target) {
              item.savedSourceId = s.id;
              return s.id;
            }
          }
        }
      }
    }
  }

  if (item.source === "farcaster" && item.sourceUrl) {
    for (const s of sources) {
      if (s.type !== "farcaster") continue;
      if (s.username && item.sourceUrl.includes(`/${s.username}/`)) {
        item.savedSourceId = s.id;
        return s.id;
      }
      if (s.fid && item.sourceUrl.includes(`/${s.fid}/`)) {
        item.savedSourceId = s.id;
        return s.id;
      }
    }
  }

  return undefined;
}

function hostnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const FEED_REDIRECTORS = new Set([
  "feeds.feedburner.com",
  "feedproxy.google.com",
  "feedburner.com",
  "news.google.com",
  "rss.feedspot.com",
]);

function isFeedRedirector(hostname: string): boolean {
  return FEED_REDIRECTORS.has(hostname);
}

function extractRedirectTarget(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const candidate = u.searchParams.get("url") || u.searchParams.get("u");
    if (candidate) return hostnameOf(candidate);
  } catch {
    return null;
  }
  return null;
}

export function computeSourceQualityStats(
  content: ReadonlyArray<ContentItem>,
  sources: ReadonlyArray<SavedSource>,
  runtimeStates: ReadonlyMap<string, SourceRuntimeState>,
  sinceMs: number = Date.now() - TIME_WINDOWS["30d"],
): SourceQualityStats[] {
  const now = Date.now();
  const inWindow = content.filter(c => c.createdAt >= sinceMs);

  const groups = new Map<string, ContentItem[]>();
  for (const item of inWindow) {
    const id = attributeItem(item, sources);
    if (id === undefined) continue;
    const list = groups.get(id);
    if (list) list.push(item);
    else groups.set(id, [item]);
  }

  const stats: SourceQualityStats[] = [];
  for (const source of sources) {
    const items = groups.get(source.id) ?? [];
    const runtimeKey = runtimeKeyFor(source);
    const runtime = runtimeKey ? runtimeStates.get(runtimeKey) : undefined;

    let quality = 0;
    let slop = 0;
    let validated = 0;
    let flagged = 0;
    for (const i of items) {
      if (i.verdict === "quality") quality++;
      else if (i.verdict === "slop") slop++;
      if (i.validated) validated++;
      if (i.flagged) flagged++;
    }

    const scored = items.length;
    const qualityYield = scored > 0 ? quality / scored : 0;
    const slopRate = scored > 0 ? slop / scored : 0;
    const reviewRate = scored > 0 ? (validated + flagged) / scored : 0;

    const lastFetchedAt = runtime?.lastFetchedAt ?? 0;
    const lastError = runtime?.lastError ?? "";
    const fetchHealth = runtime ? getSourceHealth(runtime) : "healthy";
    const isStale = lastFetchedAt > 0 && (now - lastFetchedAt) > STALE_MS;

    const recInputs = { sampleSize: scored, qualityYield, slopRate, fetchHealth, isStale };
    const qualityHealth = classifyQualityHealth(recInputs);
    const recommendation = recommend(recInputs);

    stats.push({
      id: source.id,
      label: source.label,
      type: source.type,
      enabled: source.enabled,
      scored,
      quality,
      slop,
      validated,
      flagged,
      duplicatesSuppressed: runtime?.duplicatesSuppressed ?? 0,
      qualityYield,
      slopRate,
      reviewRate,
      lastFetchedAt,
      lastError,
      fetchHealth,
      qualityHealth,
      recommendation,
      isStale,
    });
  }

  return stats;
}

export function computeUnattributedStats(
  content: ReadonlyArray<ContentItem>,
  sources: ReadonlyArray<SavedSource>,
  sinceMs: number = Date.now() - TIME_WINDOWS["30d"],
): UnattributedStats {
  const buckets: UnattributedStats = {
    d2a: { scored: 0, quality: 0, slop: 0 },
    manual: { scored: 0, quality: 0, slop: 0 },
    sharedUrl: { scored: 0, quality: 0, slop: 0 },
    deletedSource: { scored: 0, quality: 0, slop: 0 },
  };

  for (const item of content) {
    if (item.createdAt < sinceMs) continue;
    if (attributeItem(item, sources) !== undefined) continue;

    // attributeItem returned undefined. Either the item was stamped to a
    // since-deleted source AND inference couldn't re-attribute it (orphan),
    // or it was never stamped (genuine D2A / manual / shared URL).
    const bucket = isOrphan(item, sources)
      ? buckets.deletedSource
      : isD2AContent(item)
        ? buckets.d2a
        : item.source === "manual"
          ? buckets.manual
          : item.source === "url"
            ? buckets.sharedUrl
            : null;

    if (!bucket) continue;
    bucket.scored++;
    if (item.verdict === "quality") bucket.quality++;
    else if (item.verdict === "slop") bucket.slop++;
  }

  return buckets;
}

function runtimeKeyFor(source: SavedSource): string | null {
  if (source.type === "rss" && source.feedUrl) return `rss:${source.feedUrl}`;
  if (source.type === "nostr" && source.relays && source.relays.length > 0) {
    return `nostr:${source.relays.join(",")}`;
  }
  if (source.type === "farcaster") {
    const ident = source.fid !== undefined ? String(source.fid) : source.username || "unknown";
    return `farcaster:${ident}`;
  }
  return null;
}
