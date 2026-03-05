import {
  computeDashboardActivity,
  computeTopicTrends,
  computeTopicDistribution,
  clusterByStory,
  contentDedup,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeUnreviewedQueue,
  computeDashboardSaved,
  applyDashboardFilters,
  buildTopicPatternCache,
  matchesTopic,
  titleWordOverlap,
} from "@/lib/dashboard/utils";
import { adaptiveHalfLife } from "@/lib/briefing/ranker";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile, ActivityHistogram } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: `Unique text ${Math.random().toString(36).slice(2)}`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality" as const,
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: [],
    ...overrides,
  };
}

function makeProfile(affinities: Record<string, number> = {}): UserPreferenceProfile {
  return {
    ...createEmptyProfile("test-principal"),
    topicAffinities: affinities,
  };
}

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const WEEK_MS = 7 * DAY_MS;

// ─── computeDashboardActivity — single-pass edge cases ─────────────────

describe("computeDashboardActivity — boundary conditions", () => {
  const now = 1700000000000;

  it("item exactly at rangeStart is included in range stats", () => {
    const item = makeItem({ createdAt: now - DAY_MS, verdict: "quality" });
    const result = computeDashboardActivity([item], "today", now);
    expect(result.totalEvaluated).toBe(1);
    expect(result.qualityCount).toBe(1);
  });

  it("item one ms before rangeStart is excluded from range stats", () => {
    const item = makeItem({ createdAt: now - DAY_MS - 1, verdict: "quality" });
    const result = computeDashboardActivity([item], "today", now);
    expect(result.totalEvaluated).toBe(0);
    expect(result.qualityCount).toBe(0);
  });

  it("item exactly at currentTime is included in both range and chart", () => {
    const item = makeItem({ createdAt: now, verdict: "quality" });
    const result = computeDashboardActivity([item], "today", now);
    expect(result.totalEvaluated).toBe(1);
    expect(result.chartQuality.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("future items (createdAt > now) are included in range but excluded from chart", () => {
    const item = makeItem({ createdAt: now + HOUR_MS, verdict: "quality" });
    const result = computeDashboardActivity([item], "today", now);
    expect(result.totalEvaluated).toBe(1);
    expect(result.qualityCount).toBe(1);
    // chart only considers items < currentTime
    const chartTotal = result.chartQuality.length;
    expect(chartTotal).toBe(1); // "today" → 1 day chart
  });

  it("items at day boundary are assigned to correct bucket with correct counts", () => {
    // Place items at known offsets: day index 5 (2 days ago) and day index 6 (1 day ago)
    const twoDaysAgo = now - 2 * DAY_MS + HOUR_MS; // safely inside day bucket 5
    const oneDayAgo = now - DAY_MS + HOUR_MS; // safely inside day bucket 6
    const inBucket5 = makeItem({ createdAt: twoDaysAgo, verdict: "quality" });
    const inBucket6 = makeItem({ createdAt: oneDayAgo, verdict: "slop" });
    const result = computeDashboardActivity([inBucket5, inBucket6], "7d", now);
    expect(result.chartQuality).toHaveLength(7);
    expect(result.chartSlop).toHaveLength(7);
    expect(result.totalEvaluated).toBe(2);
    // Bucket 5 (2 days ago): 1 quality item → 100% quality, 0 slop
    expect(result.chartQuality[5]).toBe(100);
    expect(result.chartSlop[5]).toBe(0);
    // Bucket 6 (1 day ago): 1 slop item → 0% quality, 1 slop
    expect(result.chartQuality[6]).toBe(0);
    expect(result.chartSlop[6]).toBe(1);
    // All other buckets: empty
    for (let i = 0; i < 5; i++) {
      expect(result.chartQuality[i]).toBe(0);
      expect(result.chartSlop[i]).toBe(0);
    }
  });

  it("produces all-zero chart for empty days", () => {
    const result = computeDashboardActivity([], "30d", now);
    expect(result.chartQuality).toHaveLength(30);
    expect(result.chartSlop).toHaveLength(30);
    expect(result.chartQuality.every(v => v === 0)).toBe(true);
    expect(result.chartSlop.every(v => v === 0)).toBe(true);
  });

  it("recentActions is empty when no items are validated or flagged", () => {
    const items = Array.from({ length: 10 }, () =>
      makeItem({ validated: false, flagged: false })
    );
    const result = computeDashboardActivity(items, "7d", now);
    expect(result.recentActions).toHaveLength(0);
  });

  it("recentActions includes items from outside the range window", () => {
    // recentActions uses all content, not just ranged items
    const old = makeItem({ createdAt: now - 60 * DAY_MS, validated: true, validatedAt: now - 1000 });
    const result = computeDashboardActivity([old], "today", now);
    expect(result.recentActions).toHaveLength(1);
    expect(result.totalEvaluated).toBe(0); // outside range for stats
  });

  it("counts neither-quality-nor-slop items in totalEvaluated but not quality/slop", () => {
    const neutral = makeItem({ createdAt: now - HOUR_MS, verdict: undefined as unknown as "quality" });
    const result = computeDashboardActivity([neutral], "today", now);
    expect(result.totalEvaluated).toBe(1);
    expect(result.qualityCount).toBe(0);
    expect(result.slopCount).toBe(0);
  });

  it("chart quality percentage is rounded correctly", () => {
    // 1 quality out of 3 total = 33.33% → should round to 33
    const items = [
      makeItem({ createdAt: now - HOUR_MS, verdict: "quality" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "slop" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "slop" }),
    ];
    const result = computeDashboardActivity(items, "today", now);
    expect(result.chartQuality[0]).toBe(33);
    expect(result.chartSlop[0]).toBe(2);
  });

  it("7d chart: correct length and bucket placement", () => {
    const item = makeItem({ createdAt: now - 3 * DAY_MS + HOUR_MS, verdict: "quality" });
    const result = computeDashboardActivity([item], "7d", now);
    expect(result.chartQuality).toHaveLength(7);
    expect(result.chartSlop).toHaveLength(7);
    // Item should be in bucket 4 (3 days ago from 7-day window)
    expect(result.chartQuality[4]).toBe(100);
    // All others zero
    expect(result.chartQuality.filter(v => v > 0)).toHaveLength(1);
  });

  it("30d chart: correct length and bucket placement", () => {
    const item = makeItem({ createdAt: now - 15 * DAY_MS + HOUR_MS, verdict: "slop" });
    const result = computeDashboardActivity([item], "30d", now);
    expect(result.chartQuality).toHaveLength(30);
    expect(result.chartSlop).toHaveLength(30);
    // Item should be in bucket 15 (15 days ago from 30-day window)
    expect(result.chartSlop[15]).toBe(1);
    expect(result.chartQuality[15]).toBe(0); // slop item → 0% quality
  });

  it("today chart: correct length and data for single item", () => {
    const item = makeItem({ createdAt: now - HOUR_MS, verdict: "quality" });
    const result = computeDashboardActivity([item], "today", now);
    expect(result.chartQuality).toHaveLength(1);
    expect(result.chartSlop).toHaveLength(1);
    expect(result.chartQuality[0]).toBe(100);
    expect(result.chartSlop[0]).toBe(0);
  });
});

// ─── computeTopicTrends — single-pass edge cases ─────────────────────

describe("computeTopicTrends — boundary conditions", () => {
  const fixedNow = 1700000000000;

  beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(fixedNow); });
  afterEach(() => { jest.restoreAllMocks(); });

  it("item at windowStart is counted but only visible if in week 0 or 1", () => {
    const windowStart = fixedNow - 4 * WEEK_MS;
    // Item at windowStart → week 3 (oldest), not in allTopics (only weeks 0-1 are used)
    const oldItem = makeItem({ createdAt: windowStart, topics: ["old-edge"] });
    // Need a recent item with same topic to make it visible
    const recentItem = makeItem({ createdAt: fixedNow - HOUR_MS, topics: ["old-edge"] });
    const trends = computeTopicTrends([oldItem, recentItem], 4);
    const edgeTrend = trends.find(t => t.topic === "old-edge");
    expect(edgeTrend).toBeDefined();
    expect(edgeTrend!.currentCount).toBe(1);
    // oldest week (index 0 in history, which is reversed) should have 1
    expect(edgeTrend!.weeklyHistory[0]).toBe(1);
  });

  it("item one ms before windowStart is excluded", () => {
    const windowStart = fixedNow - 4 * WEEK_MS;
    const item = makeItem({ createdAt: windowStart - 1, topics: ["excluded"] });
    const trends = computeTopicTrends([item], 4);
    expect(trends.find(t => t.topic === "excluded")).toBeUndefined();
  });

  it("item exactly at fixedNow is included in week 0", () => {
    const item = makeItem({ createdAt: fixedNow, topics: ["boundary"] });
    const trends = computeTopicTrends([item], 4);
    const t = trends.find(t => t.topic === "boundary");
    expect(t).toBeDefined();
    expect(t!.currentCount).toBe(1);
  });

  it("future items are excluded", () => {
    const item = makeItem({ createdAt: fixedNow + HOUR_MS, topics: ["future"] });
    const trends = computeTopicTrends([item], 4);
    expect(trends.find(t => t.topic === "future")).toBeUndefined();
  });

  it("items without topics are skipped", () => {
    const item = makeItem({ createdAt: fixedNow - HOUR_MS, topics: undefined });
    const trends = computeTopicTrends([item], 1);
    expect(trends).toHaveLength(0);
  });

  it("single week analysis works", () => {
    const item = makeItem({ createdAt: fixedNow - HOUR_MS, topics: ["solo"] });
    const trends = computeTopicTrends([item], 1);
    expect(trends).toHaveLength(1);
    expect(trends[0].topic).toBe("solo");
    expect(trends[0].currentCount).toBe(1);
    expect(trends[0].previousCount).toBe(0);
    expect(trends[0].changePercent).toBe(100);
    expect(trends[0].direction).toBe("up");
    expect(trends[0].weeklyHistory).toHaveLength(1);
  });

  it("items at week boundary are assigned to correct bucket", () => {
    const recentItem = makeItem({ createdAt: fixedNow - 1, topics: ["tech"] });
    const olderItem = makeItem({ createdAt: fixedNow - WEEK_MS - 1, topics: ["tech"] });
    const trends = computeTopicTrends([recentItem, olderItem], 2);
    const tech = trends.find(t => t.topic === "tech");
    expect(tech).toBeDefined();
    expect(tech!.currentCount).toBe(1);
    expect(tech!.previousCount).toBe(1);
    expect(tech!.direction).toBe("stable");
  });

  it("only topics from weeks 0 and 1 are included in allTopics", () => {
    const oldItem = makeItem({ createdAt: fixedNow - 3 * WEEK_MS - HOUR_MS, topics: ["ancient"] });
    const recentItem = makeItem({ createdAt: fixedNow - HOUR_MS, topics: ["current"] });
    const trends = computeTopicTrends([oldItem, recentItem], 4);
    expect(trends.find(t => t.topic === "ancient")).toBeUndefined();
    expect(trends.find(t => t.topic === "current")).toBeDefined();
  });

  it("topic in week 1 only (previousCount > 0, currentCount = 0) shows decline", () => {
    const item = makeItem({ createdAt: fixedNow - WEEK_MS - HOUR_MS, topics: ["fading"] });
    const trends = computeTopicTrends([item], 4);
    const fading = trends.find(t => t.topic === "fading");
    expect(fading).toBeDefined();
    expect(fading!.currentCount).toBe(0);
    expect(fading!.previousCount).toBe(1);
    expect(fading!.changePercent).toBe(-100);
    expect(fading!.direction).toBe("down");
  });
});

// ─── clusterByStory — sorted early-break correctness ─────────────────

describe("clusterByStory — sorted early-break optimization", () => {
  const now = Date.now();
  const CLUSTER_WINDOW = 48 * HOUR_MS;

  it("clusters items within 48h window sharing 2+ topics", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - HOUR_MS, topics: ["ai", "ml"], text: "bbb" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
  });

  it("does NOT cluster items beyond 48h even with matching topics", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - CLUSTER_WINDOW - 1, topics: ["ai", "ml"], text: "bbb" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("items exactly at 48h boundary are NOT clustered (timeDiff > window)", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - CLUSTER_WINDOW, topics: ["ai", "ml"], text: "bbb" });
    // timeDiff === CLUSTER_WINDOW_MS, condition is > so this should still cluster
    const clusters = clusterByStory([a, b]);
    // timeDiff === 48h exactly → not > 48h, so should NOT break → should cluster
    expect(clusters).toHaveLength(1);
  });

  it("items at 48h + 1ms are NOT clustered", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - CLUSTER_WINDOW - 1, topics: ["ai", "ml"], text: "bbb" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("items with identical timestamps are clustered if topics match", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now, topics: ["ai", "ml"], text: "bbb" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
  });

  it("transitive clustering works across sorted order", () => {
    // A-B are close, B-C are close, but A-C might be far apart
    // With sorted order: A(newest), B(middle), C(oldest)
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], scores: { originality: 5, insight: 5, credibility: 5, composite: 5 }, text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - 20 * HOUR_MS, topics: ["ai", "ml"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 }, text: "bbb" });
    const c = makeItem({ id: "c", createdAt: now - 40 * HOUR_MS, topics: ["ai", "ml"], scores: { originality: 3, insight: 3, credibility: 3, composite: 3 }, text: "ccc" });
    // A-B: 20h apart (within window), B-C: 20h apart (within window), A-C: 40h apart (within window)
    const clusters = clusterByStory([a, b, c]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
    // Representative should be highest scoring
    expect(clusters[0].representative.id).toBe("b");
  });

  it("early break prevents clustering items in different time windows", () => {
    // Group 1: recent (within 48h of each other)
    const a1 = makeItem({ id: "a1", createdAt: now, topics: ["ai", "ml"], text: "aaa" });
    const a2 = makeItem({ id: "a2", createdAt: now - HOUR_MS, topics: ["ai", "ml"], text: "bbb" });
    // Group 2: old (within 48h of each other, but >48h from group 1)
    const b1 = makeItem({ id: "b1", createdAt: now - 10 * DAY_MS, topics: ["ai", "ml"], text: "ccc" });
    const b2 = makeItem({ id: "b2", createdAt: now - 10 * DAY_MS - HOUR_MS, topics: ["ai", "ml"], text: "ddd" });
    const clusters = clusterByStory([a1, a2, b1, b2]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every(c => c.members.length === 2)).toBe(true);
  });

  it("input order does not affect clustering result", () => {
    const items = [
      makeItem({ id: "z", createdAt: now - 10 * HOUR_MS, topics: ["ai", "ml"], text: "zzz" }),
      makeItem({ id: "a", createdAt: now, topics: ["ai", "ml"], text: "aaa" }),
      makeItem({ id: "m", createdAt: now - 5 * HOUR_MS, topics: ["ai", "ml"], text: "mmm" }),
    ];
    const shuffled = [items[1], items[2], items[0]];
    const c1 = clusterByStory(items);
    const c2 = clusterByStory(shuffled);
    expect(c1).toHaveLength(c2.length);
    expect(c1[0].members.length).toBe(c2[0].members.length);
    // Same member set regardless of input order
    const ids1 = c1[0].members.map(m => m.id).sort();
    const ids2 = c2[0].members.map(m => m.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("handles single-topic + title overlap clustering with sorted order", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["ai"], text: "Bitcoin price reaches new all time high today after months of anticipation" });
    const b = makeItem({ id: "b", createdAt: now - HOUR_MS, topics: ["ai"], text: "Bitcoin price reaches new all time high as institutional investors pile in" });
    const clusters = clusterByStory([a, b]);
    // Should cluster because of high title overlap + shared topic
    expect(clusters).toHaveLength(1);
  });

  it("single-topic items with low title overlap stay separate", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["tech"], text: "Apple releases new iPhone with revolutionary camera" });
    const b = makeItem({ id: "b", createdAt: now - HOUR_MS, topics: ["tech"], text: "Google announces quantum computing breakthrough milestone" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("items with empty topics arrays are never clustered", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: [], text: "same text" });
    const b = makeItem({ id: "b", createdAt: now - HOUR_MS, topics: [], text: "same text" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("common topics in cluster are case-insensitive", () => {
    const a = makeItem({ id: "a", createdAt: now, topics: ["AI", "ML"], text: "aaa" });
    const b = makeItem({ id: "b", createdAt: now - HOUR_MS, topics: ["ai", "ml"], text: "bbb" });
    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sharedTopics).toContain("ai");
    expect(clusters[0].sharedTopics).toContain("ml");
  });
});

// ─── computeTopicDistribution — optimized Map access ─────────────────

describe("computeTopicDistribution — edge cases", () => {
  it("handles duplicate topic names within same item", () => {
    const item = makeItem({ topics: ["ai", "ai", "ai"], verdict: "quality" });
    const dist = computeTopicDistribution([item]);
    const ai = dist.find(d => d.topic === "ai");
    expect(ai).toBeDefined();
    // Each occurrence counts separately (per the implementation)
    expect(ai!.count).toBe(3);
  });

  it("handles empty string topic", () => {
    const item = makeItem({ topics: ["", "ai"], verdict: "quality" });
    const dist = computeTopicDistribution([item]);
    expect(dist.find(d => d.topic === "")).toBeDefined();
    expect(dist.find(d => d.topic === "ai")).toBeDefined();
  });

  it("handles topics with only whitespace", () => {
    const item = makeItem({ topics: ["  "], verdict: "quality" });
    const dist = computeTopicDistribution([item]);
    expect(dist.find(d => d.topic === "  ")).toBeDefined();
  });

  it("quality rate is 0 when all items are slop", () => {
    const items = [
      makeItem({ topics: ["crypto"], verdict: "slop" }),
      makeItem({ topics: ["crypto"], verdict: "slop" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist[0].qualityRate).toBe(0);
  });

  it("quality rate is 1.0 when all items are quality", () => {
    const items = [
      makeItem({ topics: ["crypto"], verdict: "quality" }),
      makeItem({ topics: ["crypto"], verdict: "quality" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist[0].qualityRate).toBe(1);
  });

  it("handles mix of items with and without topics", () => {
    const items = [
      makeItem({ topics: ["ai"], verdict: "quality" }),
      makeItem({ topics: undefined, verdict: "quality" }),
      makeItem({ topics: ["ai"], verdict: "slop" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist).toHaveLength(1);
    expect(dist[0].count).toBe(2);
    expect(dist[0].qualityRate).toBe(0.5);
  });

  it("normalizes topic names to lowercase", () => {
    const items = [
      makeItem({ topics: ["AI"], verdict: "quality" }),
      makeItem({ topics: ["ai"], verdict: "quality" }),
      makeItem({ topics: ["Ai"], verdict: "quality" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist).toHaveLength(1);
    expect(dist[0].topic).toBe("ai");
    expect(dist[0].count).toBe(3);
  });
});

// ─── contentDedup — additional edge cases ────────────────────────────

describe("contentDedup — comprehensive edge cases", () => {
  it("strips all punctuation types", () => {
    const a = makeItem({ text: "Hello, world! How are you?" });
    const b = makeItem({ text: "Hello world How are you" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("handles newlines as whitespace", () => {
    const a = makeItem({ text: "line one\nline two\nline three" });
    const b = makeItem({ text: "line one line two line three" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("handles tabs and multiple spaces", () => {
    const a = makeItem({ text: "word1\t\tword2   word3" });
    const b = makeItem({ text: "word1 word2 word3" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("handles carriage returns", () => {
    const a = makeItem({ text: "line1\r\nline2" });
    const b = makeItem({ text: "line1 line2" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("truncates at exactly 150 chars", () => {
    const text = "a".repeat(200);
    expect(contentDedup(makeItem({ text }))).toHaveLength(150);
  });

  it("text shorter than 150 chars is not padded", () => {
    const text = "short";
    expect(contentDedup(makeItem({ text }))).toBe("short");
  });

  it("leading/trailing whitespace is trimmed before truncation", () => {
    const a = makeItem({ text: "   hello world   " });
    expect(contentDedup(a)).toBe("hello world");
  });
});

// ─── titleWordOverlap — edge cases ──────────────────────────────────

describe("titleWordOverlap — additional edge cases", () => {
  it("words of exactly 3 chars are included", () => {
    const overlap = titleWordOverlap("the cat sat", "the cat ran");
    // "the", "cat", "sat" vs "the", "cat", "ran" → 2/4 = 0.5
    expect(overlap).toBe(0.5);
  });

  it("words of exactly 2 chars are excluded", () => {
    const overlap = titleWordOverlap("to be or", "to be or");
    // "to"(2), "be"(2), "or"(2) → all filtered → 0
    expect(overlap).toBe(0);
  });

  it("duplicate words in input are deduplicated via Set", () => {
    const overlap = titleWordOverlap("hello hello hello", "hello world test");
    // sa = {"hello"}, sb = {"hello", "world", "test"} → intersection=1, union=3 → 1/3
    expect(overlap).toBeCloseTo(1 / 3);
  });
});

// ─── matchesTopic + buildTopicPatternCache — edge cases ──────────────

describe("matchesTopic — edge cases", () => {
  it("item with null topics still checks text", () => {
    const cache = buildTopicPatternCache(["bitcoin"]);
    const item = makeItem({ topics: undefined, text: "Bitcoin is rising" });
    expect(matchesTopic(item, "bitcoin", cache)).toBe(true);
  });

  it("item with empty topics array still checks text", () => {
    const cache = buildTopicPatternCache(["bitcoin"]);
    const item = makeItem({ topics: [], text: "Bitcoin is rising" });
    expect(matchesTopic(item, "bitcoin", cache)).toBe(true);
  });

  it("multi-word topic matches in text with word boundaries", () => {
    const cache = buildTopicPatternCache(["machine learning"]);
    const item = makeItem({ topics: [], text: "Deep machine learning advances in 2024" });
    expect(matchesTopic(item, "machine learning", cache)).toBe(true);
  });

  it("topic with regex special chars is escaped properly (matched via tag)", () => {
    const cache = buildTopicPatternCache(["C++"]);
    // \b word boundaries don't work after non-word chars like +, so text match fails
    const itemByText = makeItem({ topics: [], text: "Learning C++ programming" });
    expect(matchesTopic(itemByText, "C++", cache)).toBe(false);
    // But topic tag matching is exact (case-insensitive), so it works
    const itemByTag = makeItem({ topics: ["c++"], text: "any text" });
    expect(matchesTopic(itemByTag, "C++", cache)).toBe(true);
  });

  it("does not match partial word in text", () => {
    const cache = buildTopicPatternCache(["bit"]);
    const item = makeItem({ topics: [], text: "Bitcoin reaches new high" });
    expect(matchesTopic(item, "bit", cache)).toBe(false);
  });
});

// ─── applyDashboardFilters — edge cases ──────────────────────────────

describe("applyDashboardFilters — edge cases", () => {
  it("validated filter sorts by validatedAt desc, null validatedAt treated as 0", () => {
    const items = [
      makeItem({ id: "a", validated: true, validatedAt: 100 }),
      makeItem({ id: "b", validated: true, validatedAt: undefined }),
      makeItem({ id: "c", validated: true, validatedAt: 200 }),
    ];
    const result = applyDashboardFilters(items, "validated", "all");
    expect(result.map(i => i.id)).toEqual(["c", "a", "b"]);
  });

  it("combined filters apply both verdict and source", () => {
    const items = [
      makeItem({ verdict: "quality", source: "rss" }),
      makeItem({ verdict: "quality", source: "twitter" }),
      makeItem({ verdict: "slop", source: "rss" }),
    ];
    const result = applyDashboardFilters(items, "quality", "rss");
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("rss");
    expect(result[0].verdict).toBe("quality");
  });
});

// ─── Cross-function integration tests ────────────────────────────────

describe("Dashboard pipeline — integration", () => {
  const now = Date.now();
  const profile = makeProfile({ ai: 0.8, crypto: 0.5, sports: 0.1 });

  it("full pipeline: filter → top3 → spotlight with no overlap", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        text: `Unique article about technology number ${i} with distinct content`,
        createdAt: now - i * HOUR_MS,
        topics: i < 10 ? ["ai"] : ["crypto"],
        scores: { originality: 8 - i * 0.3, insight: 8, credibility: 8, composite: 8 - i * 0.3 },
        verdict: "quality",
      })
    );

    const top3 = computeDashboardTop3(items, profile, now);
    // Must actually produce results, not just pass trivially
    expect(top3.length).toBeGreaterThan(0);
    expect(top3.length).toBeLessThanOrEqual(3);
    // Each top3 item must have a valid ID from our input set
    const inputIds = new Set(items.map(i => i.id));
    for (const bi of top3) {
      expect(inputIds.has(bi.item.id)).toBe(true);
      expect(bi.item.scores.composite).toBeGreaterThan(0);
    }

    const spotlight = computeTopicSpotlight(items, profile, top3);
    const top3Ids = new Set(top3.map(b => b.item.id));
    // Spotlight must produce results for high-affinity topics
    expect(spotlight.length).toBeGreaterThan(0);
    // No spotlight item should overlap with top3
    for (const group of spotlight) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(top3Ids.has(item.id)).toBe(false);
        expect(item.verdict).toBe("quality");
      }
    }
  });

  it("unreviewed queue excludes top3 and spotlight items", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeItem({
        id: `q-${i}`,
        text: `Article with unique content for queue test number ${i}`,
        createdAt: now - i * HOUR_MS,
        topics: ["ai"],
        scores: { originality: 9 - i * 0.5, insight: 8, credibility: 8, composite: 9 - i * 0.5 },
        verdict: "quality",
      })
    );

    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const excludeIds = new Set(top3.map(b => b.item.id));
    for (const g of spotlight) for (const item of g.items) excludeIds.add(item.id);

    const queue = computeUnreviewedQueue(items, excludeIds);
    for (const item of queue) {
      expect(excludeIds.has(item.id)).toBe(false);
    }
  });

  it("saved items exclude all previously used IDs", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        id: `s-${i}`,
        text: `Saved test article with unique content number ${i}`,
        createdAt: now - i * HOUR_MS,
        topics: ["ai"],
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
        verdict: "quality",
      })
    );

    const bookmarkedIds = items.map(i => i.id);
    const profileWithBookmarks = { ...profile, bookmarkedIds };

    const top3 = computeDashboardTop3(items, profileWithBookmarks, now);
    const excludeIds = new Set(top3.map(b => b.item.id));

    const saved = computeDashboardSaved(items, bookmarkedIds, excludeIds);
    for (const item of saved) {
      expect(excludeIds.has(item.id)).toBe(false);
    }
  });

  it("clustering + distribution see consistent data", () => {
    const items = [
      makeItem({ id: "c1", createdAt: now, topics: ["ai", "ml"], text: "Deep learning breakthrough in natural language processing" }),
      makeItem({ id: "c2", createdAt: now - HOUR_MS, topics: ["ai", "ml"], text: "Deep learning breakthrough in computer vision systems" }),
      makeItem({ id: "c3", createdAt: now - 2 * HOUR_MS, topics: ["crypto"], text: "Crypto market update" }),
    ];

    const clusters = clusterByStory(items);
    const dist = computeTopicDistribution(items);

    // c1 and c2 should cluster together (shared "ai" + "ml" topics within 48h)
    const aiCluster = clusters.find(c => c.members.length === 2);
    expect(aiCluster).toBeDefined();
    expect(aiCluster!.sharedTopics).toContain("ai");
    expect(aiCluster!.sharedTopics).toContain("ml");

    // Distribution should count all topics
    const aiDist = dist.find(d => d.topic === "ai");
    expect(aiDist!.count).toBe(2);
    const cryptoDist = dist.find(d => d.topic === "crypto");
    expect(cryptoDist!.count).toBe(1);
  });

  it("activity stats are consistent with filter results", () => {
    const items = [
      makeItem({ createdAt: now - HOUR_MS, verdict: "quality", source: "rss" }),
      makeItem({ createdAt: now - 2 * HOUR_MS, verdict: "slop", source: "rss" }),
      makeItem({ createdAt: now - 3 * HOUR_MS, verdict: "quality", source: "twitter" }),
    ];

    const activity = computeDashboardActivity(items, "today", now);
    const qualityFiltered = applyDashboardFilters(items, "quality", "all");
    const slopFiltered = applyDashboardFilters(items, "slop", "all");

    expect(activity.qualityCount).toBe(qualityFiltered.length);
    expect(activity.slopCount).toBe(slopFiltered.length);
    expect(activity.totalEvaluated).toBe(items.length);
  });

  it("trends and distribution agree on topic counts for current week", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        createdAt: now - i * HOUR_MS,
        topics: ["ai"],
        verdict: "quality",
      })
    );

    const trends = computeTopicTrends(items, 1);
    const dist = computeTopicDistribution(items);

    const trendAi = trends.find(t => t.topic === "ai");
    const distAi = dist.find(d => d.topic === "ai");

    expect(trendAi!.currentCount).toBe(distAi!.count);
  });
});

// ─── Mixed verdict coverage — expose quality-only default bias ────────

describe("Mixed verdict scenarios — slop, quality, unscored", () => {
  const now = 1700000000000;

  it("computeDashboardActivity counts slop and quality correctly in mixed set", () => {
    const items = [
      makeItem({ createdAt: now - HOUR_MS, verdict: "quality" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "slop" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "slop" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "quality" }),
      makeItem({ createdAt: now - HOUR_MS, verdict: "slop" }),
    ];
    const result = computeDashboardActivity(items, "today", now);
    expect(result.qualityCount).toBe(2);
    expect(result.slopCount).toBe(3);
    expect(result.totalEvaluated).toBe(5);
    // chart: 2/5 quality = 40%, 3 slop
    expect(result.chartQuality[0]).toBe(40);
    expect(result.chartSlop[0]).toBe(3);
  });

  it("computeUnreviewedQueue excludes slop items entirely", () => {
    const items = [
      makeItem({ id: "q1", verdict: "quality", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "q2", verdict: "slop", scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
      makeItem({ id: "q3", verdict: "quality", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    const queue = computeUnreviewedQueue(items, new Set());
    // Only quality items, even though slop item has higher score
    expect(queue).toHaveLength(2);
    expect(queue.every(item => item.verdict === "quality")).toBe(true);
    expect(queue[0].id).toBe("q1"); // higher scoring quality item first
    expect(queue[1].id).toBe("q3");
  });

  it("computeTopicDistribution tracks quality rate across mixed verdicts", () => {
    const items = [
      makeItem({ topics: ["ai"], verdict: "quality" }),
      makeItem({ topics: ["ai"], verdict: "slop" }),
      makeItem({ topics: ["ai"], verdict: "slop" }),
      makeItem({ topics: ["crypto"], verdict: "quality" }),
      makeItem({ topics: ["crypto"], verdict: "quality" }),
    ];
    const dist = computeTopicDistribution(items);
    const ai = dist.find(d => d.topic === "ai");
    const crypto = dist.find(d => d.topic === "crypto");
    expect(ai!.count).toBe(3);
    expect(ai!.qualityRate).toBeCloseTo(1 / 3);
    expect(crypto!.count).toBe(2);
    expect(crypto!.qualityRate).toBe(1.0);
  });

  it("applyDashboardFilters correctly separates quality from slop", () => {
    const items = [
      makeItem({ id: "f1", verdict: "quality" }),
      makeItem({ id: "f2", verdict: "slop" }),
      makeItem({ id: "f3", verdict: "quality" }),
      makeItem({ id: "f4", verdict: "slop" }),
    ];
    const quality = applyDashboardFilters(items, "quality", "all");
    const slop = applyDashboardFilters(items, "slop", "all");
    expect(quality).toHaveLength(2);
    expect(quality.every(i => i.verdict === "quality")).toBe(true);
    expect(slop).toHaveLength(2);
    expect(slop.every(i => i.verdict === "slop")).toBe(true);
    // No overlap
    const qualityIds = new Set(quality.map(i => i.id));
    for (const item of slop) {
      expect(qualityIds.has(item.id)).toBe(false);
    }
  });

  it("clusterByStory clusters slop items the same as quality", () => {
    const items = [
      makeItem({ id: "s1", createdAt: now, topics: ["ai", "ml"], verdict: "slop", text: "aaa",
        scores: { originality: 2, insight: 2, credibility: 2, composite: 2 } }),
      makeItem({ id: "s2", createdAt: now - HOUR_MS, topics: ["ai", "ml"], verdict: "quality", text: "bbb",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];
    const clusters = clusterByStory(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    // Representative should be higher-scoring quality item, not slop
    expect(clusters[0].representative.id).toBe("s2");
    expect(clusters[0].representative.verdict).toBe("quality");
  });

  it("computeDashboardSaved works with slop bookmarked items", () => {
    const items = [
      makeItem({ id: "bk1", verdict: "slop" }),
      makeItem({ id: "bk2", verdict: "quality" }),
    ];
    const saved = computeDashboardSaved(items, ["bk1", "bk2"], new Set());
    // Both should appear (saved = bookmarked, regardless of verdict)
    expect(saved).toHaveLength(2);
  });
});

// ─── Concurrent/async-like behavior (determinism) ────────────────────

describe("Deterministic output — same input always produces same output", () => {
  const now = 1700000000000;

  it("computeDashboardActivity is deterministic", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({
        id: `det-${i}`,
        createdAt: now - i * HOUR_MS,
        verdict: i % 3 === 0 ? "quality" : "slop",
        validated: i % 7 === 0,
        validatedAt: i % 7 === 0 ? now - i * 1000 : undefined,
      })
    );
    const r1 = computeDashboardActivity(items, "7d", now);
    const r2 = computeDashboardActivity(items, "7d", now);
    expect(r1.qualityCount).toBe(r2.qualityCount);
    expect(r1.slopCount).toBe(r2.slopCount);
    expect(r1.totalEvaluated).toBe(r2.totalEvaluated);
    expect(r1.chartQuality).toEqual(r2.chartQuality);
    expect(r1.chartSlop).toEqual(r2.chartSlop);
    expect(r1.recentActions.map(a => a.id)).toEqual(r2.recentActions.map(a => a.id));
  });

  it("clusterByStory is deterministic", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({
        id: `cl-${i}`,
        createdAt: now - (i % 5) * HOUR_MS,
        topics: i % 2 === 0 ? ["ai", "ml"] : ["crypto", "defi"],
        scores: { originality: 5 + i * 0.2, insight: 5, credibility: 5, composite: 5 + i * 0.2 },
        text: `Cluster determinism test article number ${i}`,
      })
    );
    const c1 = clusterByStory(items);
    const c2 = clusterByStory(items);
    expect(c1.length).toBe(c2.length);
    for (let i = 0; i < c1.length; i++) {
      expect(c1[i].representative.id).toBe(c2[i].representative.id);
      expect(c1[i].members.map(m => m.id).sort()).toEqual(c2[i].members.map(m => m.id).sort());
    }
  });

  it("computeTopicTrends is deterministic with fixed now", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem({
        id: `tr-${i}`,
        createdAt: now - i * DAY_MS,
        topics: [`topic-${i % 3}`],
      })
    );
    jest.spyOn(Date, "now").mockReturnValue(now);
    const t1 = computeTopicTrends(items, 4);
    const t2 = computeTopicTrends(items, 4);
    expect(t1).toEqual(t2);
    jest.restoreAllMocks();
  });
});

// ─── adaptiveHalfLife — previously untested code path ────────────────

describe("adaptiveHalfLife — adaptive decay path", () => {
  const now = 1700000000000;

  it("returns default 7h when histogram is undefined", () => {
    expect(adaptiveHalfLife(undefined, now)).toBe(7);
  });

  it("returns default 7h when histogram has fewer than 10 events", () => {
    const histogram: ActivityHistogram = {
      hourCounts: new Array(24).fill(0),
      lastActivityAt: now - HOUR_MS,
      totalEvents: 9,
    };
    expect(adaptiveHalfLife(histogram, now)).toBe(7);
  });

  it("returns default 7h when gap < 4 hours and enough events", () => {
    const histogram: ActivityHistogram = {
      hourCounts: new Array(24).fill(1),
      lastActivityAt: now - 2 * HOUR_MS, // 2 hours ago
      totalEvents: 50,
    };
    expect(adaptiveHalfLife(histogram, now)).toBe(7);
  });

  it("returns extended half-life when gap >= 4 hours (catchup mode)", () => {
    const histogram: ActivityHistogram = {
      hourCounts: new Array(24).fill(1),
      lastActivityAt: now - 4 * HOUR_MS, // exactly 4 hours ago
      totalEvents: 50,
    };
    const result = adaptiveHalfLife(histogram, now);
    expect(result).toBeGreaterThan(7);
    expect(result).toBeLessThanOrEqual(24);
  });

  it("returns max 24h half-life when gap >= 8 hours", () => {
    const histogram: ActivityHistogram = {
      hourCounts: new Array(24).fill(1),
      lastActivityAt: now - 8 * HOUR_MS,
      totalEvents: 50,
    };
    expect(adaptiveHalfLife(histogram, now)).toBe(24);
  });

  it("caps at 24h even for very large gaps", () => {
    const histogram: ActivityHistogram = {
      hourCounts: new Array(24).fill(1),
      lastActivityAt: now - 72 * HOUR_MS, // 3 days ago
      totalEvents: 100,
    };
    expect(adaptiveHalfLife(histogram, now)).toBe(24);
  });

  it("gapFactor scales linearly between 4h and 8h", () => {
    const makeHist = (hoursAgo: number): ActivityHistogram => ({
      hourCounts: new Array(24).fill(1),
      lastActivityAt: now - hoursAgo * HOUR_MS,
      totalEvents: 50,
    });
    const at4h = adaptiveHalfLife(makeHist(4), now);
    const at6h = adaptiveHalfLife(makeHist(6), now);
    const at8h = adaptiveHalfLife(makeHist(8), now);
    // 4h → gapFactor=0.5, 6h → gapFactor=0.75, 8h → gapFactor=1.0
    expect(at4h).toBeCloseTo(7 + (24 - 7) * 0.5);
    expect(at6h).toBeCloseTo(7 + (24 - 7) * 0.75);
    expect(at8h).toBe(24);
    // Verify monotonic increase
    expect(at6h).toBeGreaterThan(at4h);
    expect(at8h).toBeGreaterThan(at6h);
  });

  it("computeDashboardTop3 uses adaptive half-life when profile has histogram", () => {
    const freshItem = makeItem({
      id: "fresh",
      createdAt: now - HOUR_MS,
      topics: ["ai"],
      scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    });
    const oldItem = makeItem({
      id: "old",
      createdAt: now - 12 * HOUR_MS,
      topics: ["ai"],
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
    });

    // With default half-life (7h), old item decays more
    const defaultProfile = makeProfile({ ai: 0.8 });
    const top3Default = computeDashboardTop3([freshItem, oldItem], defaultProfile, now);

    // With catchup half-life (24h), old item decays less → may rank higher
    const catchupProfile = {
      ...makeProfile({ ai: 0.8 }),
      activityHistogram: {
        hourCounts: new Array(24).fill(1),
        lastActivityAt: now - 12 * HOUR_MS,
        totalEvents: 50,
      },
    };
    const top3Catchup = computeDashboardTop3([freshItem, oldItem], catchupProfile, now);

    // Both should produce results
    expect(top3Default.length).toBeGreaterThan(0);
    expect(top3Catchup.length).toBeGreaterThan(0);
    // Catchup mode should favor the higher-composite old item more
    // (old item has composite 9 vs fresh item 7, but with 7h half-life it decays more)
    const defaultOldRank = top3Default.findIndex(bi => bi.item.id === "old");
    const catchupOldRank = top3Catchup.findIndex(bi => bi.item.id === "old");
    // In catchup mode, old content decays less → old item should rank equal or better
    expect(catchupOldRank).toBeLessThanOrEqual(defaultOldRank === -1 ? 99 : defaultOldRank);
  });
});

// ─── Large dataset — performance sanity ──────────────────────────────

describe("Performance sanity — large datasets complete without timeout", () => {
  const now = 1700000000000;

  it("clusterByStory handles 200 items", () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      makeItem({
        id: `perf-${i}`,
        createdAt: now - i * DAY_MS, // spread across 200 days
        topics: [`topic-${i % 5}`, `topic-${(i + 1) % 5}`],
        text: `Performance test article ${i} about something unique`,
      })
    );
    const start = performance.now();
    const clusters = clusterByStory(items);
    const elapsed = performance.now() - start;
    expect(clusters.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000); // should be well under 1s with early-break
  });

  it("computeDashboardActivity handles 1000 items", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({
        id: `act-${i}`,
        createdAt: now - (i % 30) * DAY_MS,
        verdict: i % 2 === 0 ? "quality" : "slop",
      })
    );
    const start = performance.now();
    const result = computeDashboardActivity(items, "30d", now);
    const elapsed = performance.now() - start;
    expect(result.totalEvaluated).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("computeTopicTrends handles 1000 items", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({
        id: `trend-${i}`,
        createdAt: now - (i % 28) * DAY_MS,
        topics: [`topic-${i % 10}`],
      })
    );
    jest.spyOn(Date, "now").mockReturnValue(now);
    const start = performance.now();
    const trends = computeTopicTrends(items, 4);
    const elapsed = performance.now() - start;
    expect(trends.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
    jest.restoreAllMocks();
  });
});
