import {
  attributeItem,
  classifyQualityHealth,
  computeSourceQualityStats,
  computeUnattributedStats,
  KEEP_QUALITY_YIELD,
  MIN_SAMPLE_SIZE,
  recommend,
  SLOP_REMOVE_THRESHOLD,
  STALE_MS,
  TIME_WINDOWS,
  WATCH_FLOOR,
} from "@/lib/dashboard/sourceQuality";
import type { ContentItem } from "@/lib/types/content";
import type { SavedSource } from "@/lib/types/sources";
import type { SourceRuntimeState } from "@/lib/ingestion/sourceState";
import { defaultState } from "@/lib/ingestion/sourceState";

const NOW = 1_750_000_000_000;

function makeItem(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: over.id ?? `i-${Math.random()}`,
    owner: "",
    author: "",
    avatar: "",
    text: "lorem ipsum",
    source: "rss",
    sourceUrl: undefined,
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "",
    createdAt: NOW - 60_000,
    validated: false,
    flagged: false,
    timestamp: "1m ago",
    ...over,
  };
}

function makeSource(over: Partial<SavedSource> = {}): SavedSource {
  return {
    id: over.id ?? "s-1",
    type: over.type ?? "rss",
    label: "Source",
    enabled: true,
    feedUrl: "https://example.com/feed",
    createdAt: NOW - 86_400_000,
    ...over,
  };
}

function makeRuntime(over: Partial<SourceRuntimeState> = {}): SourceRuntimeState {
  return { ...defaultState(), ...over };
}

describe("recommend()", () => {
  const base = { fetchHealth: "healthy" as const, isStale: false };

  it("insufficient_data when below MIN_SAMPLE_SIZE", () => {
    expect(recommend({ ...base, sampleSize: MIN_SAMPLE_SIZE - 1, qualityYield: 0.99, slopRate: 0 }))
      .toBe("insufficient_data");
  });

  it("keep at exact KEEP_QUALITY_YIELD with healthy slop rate", () => {
    expect(recommend({ ...base, sampleSize: MIN_SAMPLE_SIZE, qualityYield: KEEP_QUALITY_YIELD, slopRate: 0.1 }))
      .toBe("keep");
  });

  it("watch just below KEEP_QUALITY_YIELD", () => {
    expect(recommend({ ...base, sampleSize: 20, qualityYield: KEEP_QUALITY_YIELD - 0.01, slopRate: 0.2 }))
      .toBe("watch");
  });

  it("mute just below WATCH_FLOOR", () => {
    expect(recommend({ ...base, sampleSize: 20, qualityYield: WATCH_FLOOR - 0.01, slopRate: 0.4 }))
      .toBe("mute");
  });

  it("mute when slopRate >= SLOP_REMOVE_THRESHOLD even if qualityYield is high", () => {
    expect(recommend({ ...base, sampleSize: 20, qualityYield: 0.7, slopRate: SLOP_REMOVE_THRESHOLD }))
      .toBe("mute");
  });

  it("remove when fetchHealth disabled AND stale", () => {
    expect(recommend({ fetchHealth: "disabled", isStale: true, sampleSize: 100, qualityYield: 0.9, slopRate: 0 }))
      .toBe("remove");
  });

  it("does NOT remove when only disabled (not stale)", () => {
    expect(recommend({ fetchHealth: "disabled", isStale: false, sampleSize: 100, qualityYield: 0.9, slopRate: 0 }))
      .toBe("keep");
  });
});

describe("classifyQualityHealth()", () => {
  it("issue when fetchHealth disabled regardless of yield", () => {
    expect(classifyQualityHealth({ fetchHealth: "disabled", isStale: false, sampleSize: 50, qualityYield: 1, slopRate: 0 }))
      .toBe("issue");
  });
  it("stale takes precedence over learning", () => {
    expect(classifyQualityHealth({ fetchHealth: "healthy", isStale: true, sampleSize: 1, qualityYield: 0, slopRate: 0 }))
      .toBe("stale");
  });
  it("learning when sampleSize below threshold and not stale/issue", () => {
    expect(classifyQualityHealth({ fetchHealth: "healthy", isStale: false, sampleSize: 3, qualityYield: 0, slopRate: 0 }))
      .toBe("learning");
  });
  it("noisy when slopRate >= threshold", () => {
    expect(classifyQualityHealth({ fetchHealth: "healthy", isStale: false, sampleSize: 30, qualityYield: 0.4, slopRate: SLOP_REMOVE_THRESHOLD }))
      .toBe("noisy");
  });
  it("healthy in the green zone", () => {
    expect(classifyQualityHealth({ fetchHealth: "healthy", isStale: false, sampleSize: 30, qualityYield: 0.8, slopRate: 0.1 }))
      .toBe("healthy");
  });
});

describe("attributeItem()", () => {
  it("returns existing savedSourceId without re-inference", () => {
    const sources: SavedSource[] = [];
    expect(attributeItem(makeItem({ savedSourceId: "preset" }), sources)).toBe("preset");
  });

  it("nostr — matches by pubkey", () => {
    const sources = [makeSource({ id: "n1", type: "nostr", pubkeys: ["abc123"] })];
    const item = makeItem({ source: "nostr", nostrPubkey: "abc123" });
    expect(attributeItem(item, sources)).toBe("n1");
    expect(item.savedSourceId).toBe("n1");
  });

  it("nostr — undefined when pubkey not in any source", () => {
    const sources = [makeSource({ id: "n1", type: "nostr", pubkeys: ["other"] })];
    expect(attributeItem(makeItem({ source: "nostr", nostrPubkey: "abc" }), sources)).toBeUndefined();
  });

  it("rss — matches by hostname (www stripped)", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://www.example.com/feed.xml" })];
    const item = makeItem({ source: "rss", sourceUrl: "https://example.com/articles/1" });
    expect(attributeItem(item, sources)).toBe("r1");
  });

  it("rss — feedburner intermediate with single candidate falls back to that source", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://blog.example.com/rss" })];
    const item = makeItem({ source: "rss", sourceUrl: "https://feeds.feedburner.com/Whatever" });
    expect(attributeItem(item, sources)).toBe("r1");
  });

  it("rss — multiple sources with feedburner intermediate without ?url= → undefined", () => {
    const sources = [
      makeSource({ id: "r1", type: "rss", feedUrl: "https://blog.example.com/rss" }),
      makeSource({ id: "r2", type: "rss", feedUrl: "https://other.example.org/rss" }),
    ];
    const item = makeItem({ source: "rss", sourceUrl: "https://feeds.feedburner.com/Whatever" });
    expect(attributeItem(item, sources)).toBeUndefined();
  });

  it("rss — google news ?url= encoded target maps to matching source", () => {
    const sources = [
      makeSource({ id: "r1", type: "rss", feedUrl: "https://blog.example.com/rss" }),
      makeSource({ id: "r2", type: "rss", feedUrl: "https://other.example.org/rss" }),
    ];
    const item = makeItem({
      source: "rss",
      sourceUrl: "https://news.google.com/rss/articles?url=https%3A%2F%2Fother.example.org%2Fpost",
    });
    expect(attributeItem(item, sources)).toBe("r2");
  });

  it("rss — undefined when hostname matches nothing", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const item = makeItem({ source: "rss", sourceUrl: "https://other.org/post" });
    expect(attributeItem(item, sources)).toBeUndefined();
  });

  it("farcaster — matches by username path segment", () => {
    const sources = [makeSource({ id: "f1", type: "farcaster", username: "alice", fid: 42 })];
    const item = makeItem({ source: "farcaster", sourceUrl: "https://warpcast.com/alice/0xabc" });
    expect(attributeItem(item, sources)).toBe("f1");
  });

  it("farcaster — falls back to fid when username miss", () => {
    const sources = [makeSource({ id: "f1", type: "farcaster", username: "alice", fid: 42 })];
    const item = makeItem({ source: "farcaster", sourceUrl: "https://warpcast.com/42/0xabc" });
    expect(attributeItem(item, sources)).toBe("f1");
  });

  it("manual / d2a / unknown sources → undefined", () => {
    const sources = [makeSource()];
    expect(attributeItem(makeItem({ source: "manual" }), sources)).toBeUndefined();
  });

  it("caches inferred id on the item (mutation)", () => {
    const sources = [makeSource({ id: "n1", type: "nostr", pubkeys: ["abc"] })];
    const item = makeItem({ source: "nostr", nostrPubkey: "abc" });
    expect(item.savedSourceId).toBeUndefined();
    attributeItem(item, sources);
    expect(item.savedSourceId).toBe("n1");
  });
});

describe("computeSourceQualityStats()", () => {
  it("groups items by attribution and computes yield/slop/review", () => {
    const sources = [
      makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" }),
    ];
    const content: ContentItem[] = [
      makeItem({ id: "1", source: "rss", sourceUrl: "https://example.com/a", verdict: "quality", validated: true, createdAt: NOW - 1000 }),
      makeItem({ id: "2", source: "rss", sourceUrl: "https://example.com/b", verdict: "quality", createdAt: NOW - 1000 }),
      makeItem({ id: "3", source: "rss", sourceUrl: "https://example.com/c", verdict: "slop", flagged: true, createdAt: NOW - 1000 }),
    ];
    const runtime = new Map([["rss:https://example.com/feed", makeRuntime({ duplicatesSuppressed: 7, lastFetchedAt: NOW - 3600_000 })]]);

    const stats = computeSourceQualityStats(content, sources, runtime, NOW - TIME_WINDOWS["7d"]);
    expect(stats).toHaveLength(1);
    const s = stats[0];
    expect(s.scored).toBe(3);
    expect(s.quality).toBe(2);
    expect(s.slop).toBe(1);
    expect(s.validated).toBe(1);
    expect(s.flagged).toBe(1);
    expect(s.qualityYield).toBeCloseTo(2 / 3, 5);
    expect(s.slopRate).toBeCloseTo(1 / 3, 5);
    expect(s.reviewRate).toBeCloseTo(2 / 3, 5);
    expect(s.validateRatio).toBeCloseTo(0.5, 5);
    expect(s.duplicatesSuppressed).toBe(7);
    expect(s.recommendation).toBe("insufficient_data");
  });

  it("excludes items outside sinceMs", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const content: ContentItem[] = [
      makeItem({ id: "old", source: "rss", sourceUrl: "https://example.com/x", createdAt: NOW - 90 * 86_400_000 }),
      makeItem({ id: "new", source: "rss", sourceUrl: "https://example.com/y", createdAt: NOW - 1000 }),
    ];
    const stats = computeSourceQualityStats(content, sources, new Map(), NOW - TIME_WINDOWS["30d"]);
    expect(stats[0].scored).toBe(1);
  });

  it("recommends keep at sample-size threshold with high yield", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const items = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => makeItem({
      id: String(i),
      source: "rss",
      sourceUrl: `https://example.com/${i}`,
      verdict: i < MIN_SAMPLE_SIZE - 1 ? "quality" : "slop",
      createdAt: NOW - 1000,
    }));
    const stats = computeSourceQualityStats(items, sources, new Map(), NOW - TIME_WINDOWS["30d"]);
    expect(stats[0].recommendation).toBe("keep");
  });

  it("isStale flips when lastFetchedAt older than STALE_MS", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const runtime = new Map([
      ["rss:https://example.com/feed", makeRuntime({ lastFetchedAt: NOW - STALE_MS - 1000 })],
    ]);
    const stats = computeSourceQualityStats([], sources, runtime, NOW - TIME_WINDOWS["30d"]);
    expect(stats[0].isStale).toBe(true);
    expect(stats[0].qualityHealth).toBe("stale");
  });

  it("source with no runtime entry defaults to healthy fetchHealth", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const stats = computeSourceQualityStats([], sources, new Map(), NOW - TIME_WINDOWS["30d"]);
    expect(stats[0].fetchHealth).toBe("healthy");
    expect(stats[0].lastFetchedAt).toBe(0);
  });
});

describe("computeUnattributedStats()", () => {
  it("buckets manual / d2a / sharedUrl content separately", () => {
    const sources: SavedSource[] = [];
    const content: ContentItem[] = [
      makeItem({ id: "m1", source: "manual", verdict: "quality" }),
      makeItem({ id: "m2", source: "manual", verdict: "slop" }),
      makeItem({ id: "u1", source: "url", verdict: "quality" }),
      makeItem({ id: "d1", source: "manual", reason: "Received via D2A from peer-abc", verdict: "quality" }),
    ];
    const result = computeUnattributedStats(content, sources, NOW - TIME_WINDOWS["30d"]);
    expect(result.manual.scored).toBe(2);
    expect(result.manual.quality).toBe(1);
    expect(result.manual.slop).toBe(1);
    expect(result.sharedUrl.scored).toBe(1);
    expect(result.d2a.scored).toBe(1);
  });

  it("attributed items skipped from unattributed buckets", () => {
    const sources = [makeSource({ id: "r1", type: "rss", feedUrl: "https://example.com/feed" })];
    const content: ContentItem[] = [
      makeItem({ source: "rss", sourceUrl: "https://example.com/post", verdict: "quality" }),
    ];
    const result = computeUnattributedStats(content, sources, NOW - TIME_WINDOWS["30d"]);
    expect(result.manual.scored).toBe(0);
    expect(result.sharedUrl.scored).toBe(0);
    expect(result.d2a.scored).toBe(0);
  });
});
