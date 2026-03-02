import {
  computeDashboardActivity,
  computeDashboardSaved,
  computeTopicTrends,
  applyDashboardFilters,
  buildTopicPatternCache,
  matchesTopic,
  clusterByStory,
  titleWordOverlap,
  type TopicTrend,
  type StoryCluster,
} from "@/lib/dashboard/utils";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
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

// ─── computeDashboardActivity ────────────────────────────────────

describe("computeDashboardActivity", () => {
  const DAY_MS = 86400000;
  const now = 1700000000000;

  it("counts quality and slop items within range", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 0.5 }),
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 0.3 }),
      makeItem({ verdict: "slop", createdAt: now - DAY_MS * 0.1 }),
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 2 }), // outside "today" range
    ];
    const stats = computeDashboardActivity(items, "today", now);
    expect(stats.qualityCount).toBe(2);
    expect(stats.slopCount).toBe(1);
    expect(stats.totalEvaluated).toBe(3);
  });

  it("7d range includes items from last 7 days", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 3 }),
      makeItem({ verdict: "slop", createdAt: now - DAY_MS * 6 }),
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 8 }), // outside range
    ];
    const stats = computeDashboardActivity(items, "7d", now);
    expect(stats.qualityCount).toBe(1);
    expect(stats.slopCount).toBe(1);
    expect(stats.totalEvaluated).toBe(2);
  });

  it("30d range includes items from last 30 days", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 15 }),
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 29 }),
      makeItem({ verdict: "slop", createdAt: now - DAY_MS * 31 }), // outside range
    ];
    const stats = computeDashboardActivity(items, "30d", now);
    expect(stats.totalEvaluated).toBe(2);
  });

  it("recentActions limited to 3 for today, 5 for 7d/30d", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `action-${i}`, validated: true, validatedAt: now - i * 1000 }),
    );
    expect(computeDashboardActivity(items, "today", now).recentActions).toHaveLength(3);
    expect(computeDashboardActivity(items, "7d", now).recentActions).toHaveLength(5);
    expect(computeDashboardActivity(items, "30d", now).recentActions).toHaveLength(5);
  });

  it("recentActions includes flagged items", () => {
    const items = [
      makeItem({ id: "flagged", flagged: true, createdAt: now - 1000 }),
      makeItem({ id: "normal", flagged: false, validated: false, createdAt: now - 500 }),
    ];
    const stats = computeDashboardActivity(items, "today", now);
    expect(stats.recentActions.map(a => a.id)).toContain("flagged");
    expect(stats.recentActions.map(a => a.id)).not.toContain("normal");
  });

  it("recentActions sorted by validatedAt desc", () => {
    const items = [
      makeItem({ id: "old", validated: true, validatedAt: now - 5000 }),
      makeItem({ id: "new", validated: true, validatedAt: now - 1000 }),
      makeItem({ id: "mid", validated: true, validatedAt: now - 3000 }),
    ];
    const stats = computeDashboardActivity(items, "7d", now);
    expect(stats.recentActions.map(a => a.id)).toEqual(["new", "mid", "old"]);
  });

  it("produces correct chart data for today (1 day)", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - DAY_MS * 0.5 }),
      makeItem({ verdict: "slop", createdAt: now - DAY_MS * 0.3 }),
    ];
    const stats = computeDashboardActivity(items, "today", now);
    expect(stats.chartQuality).toHaveLength(1);
    expect(stats.chartSlop).toHaveLength(1);
    expect(stats.chartQuality[0]).toBe(50); // 1 quality out of 2
    expect(stats.chartSlop[0]).toBe(1);
  });

  it("chart shows 0% for empty days", () => {
    const stats = computeDashboardActivity([], "7d", now);
    expect(stats.chartQuality).toHaveLength(7);
    expect(stats.chartQuality.every(v => v === 0)).toBe(true);
    expect(stats.chartSlop.every(v => v === 0)).toBe(true);
  });

  it("handles empty content array", () => {
    const stats = computeDashboardActivity([], "today", now);
    expect(stats.qualityCount).toBe(0);
    expect(stats.slopCount).toBe(0);
    expect(stats.totalEvaluated).toBe(0);
    expect(stats.recentActions).toEqual([]);
  });
});

// ─── computeDashboardSaved ───────────────────────────────────────

describe("computeDashboardSaved", () => {
  it("returns only bookmarked items", () => {
    const items = [
      makeItem({ id: "bm1" }),
      makeItem({ id: "bm2" }),
      makeItem({ id: "not-bm" }),
    ];
    const saved = computeDashboardSaved(items, ["bm1", "bm2"], new Set());
    expect(saved.map(i => i.id).sort()).toEqual(["bm1", "bm2"]);
  });

  it("excludes items in excludeIds", () => {
    const items = [
      makeItem({ id: "bm1" }),
      makeItem({ id: "bm2" }),
    ];
    const saved = computeDashboardSaved(items, ["bm1", "bm2"], new Set(["bm1"]));
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("bm2");
  });

  it("sorts by composite score descending", () => {
    const items = [
      makeItem({ id: "low", scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
      makeItem({ id: "high", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "mid", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const saved = computeDashboardSaved(items, ["low", "high", "mid"], new Set());
    expect(saved.map(i => i.id)).toEqual(["high", "mid", "low"]);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem({ id: `bm-${i}` }));
    const saved = computeDashboardSaved(items, items.map(i => i.id), new Set());
    expect(saved).toHaveLength(5);
  });

  it("returns empty when no bookmarks match", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    expect(computeDashboardSaved(items, ["nonexistent"], new Set())).toEqual([]);
  });

  it("returns empty for empty bookmarkedIds", () => {
    const items = [makeItem({ id: "a" })];
    expect(computeDashboardSaved(items, [], new Set())).toEqual([]);
  });

  it("returns empty for empty content", () => {
    expect(computeDashboardSaved([], ["bm1"], new Set())).toEqual([]);
  });
});

// ─── applyDashboardFilters ───────────────────────────────────────

describe("applyDashboardFilters", () => {
  const items = [
    makeItem({ id: "q1", verdict: "quality", source: "rss", validated: true, validatedAt: 1000 }),
    makeItem({ id: "q2", verdict: "quality", source: "nostr", validated: false }),
    makeItem({ id: "s1", verdict: "slop", source: "rss" }),
    makeItem({ id: "s2", verdict: "slop", source: "nostr" }),
  ];

  it("returns all items with 'all' filters", () => {
    const result = applyDashboardFilters(items, "all", "all");
    expect(result).toHaveLength(4);
  });

  it("filters by verdict 'quality'", () => {
    const result = applyDashboardFilters(items, "quality", "all");
    expect(result.every(c => c.verdict === "quality")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("filters by verdict 'slop'", () => {
    const result = applyDashboardFilters(items, "slop", "all");
    expect(result.every(c => c.verdict === "slop")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("filters validated items and sorts by validatedAt desc", () => {
    const result = applyDashboardFilters(items, "validated", "all");
    expect(result.every(c => c.validated)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("q1");
  });

  it("filters by source", () => {
    const result = applyDashboardFilters(items, "all", "rss");
    expect(result.every(c => c.source === "rss")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("combines verdict and source filters", () => {
    const result = applyDashboardFilters(items, "quality", "nostr");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("q2");
  });

  it("returns empty when no items match", () => {
    const result = applyDashboardFilters(items, "quality", "twitter");
    expect(result).toEqual([]);
  });
});

// ─── buildTopicPatternCache / matchesTopic ───────────────────────

describe("buildTopicPatternCache + matchesTopic", () => {
  it("builds case-insensitive regex for topics", () => {
    const cache = buildTopicPatternCache(["AI", "Machine Learning"]);
    expect(cache.size).toBe(2);
    expect(cache.get("AI")).toBeDefined();
    expect(cache.get("Machine Learning")).toBeDefined();
  });

  it("matchesTopic returns true for topic tag match", () => {
    const cache = buildTopicPatternCache(["crypto"]);
    const item = makeItem({ topics: ["crypto"] });
    expect(matchesTopic(item, "crypto", cache)).toBe(true);
  });

  it("matchesTopic returns true for text regex match", () => {
    const cache = buildTopicPatternCache(["quantum"]);
    const item = makeItem({ topics: [], text: "A study on quantum computing" });
    expect(matchesTopic(item, "quantum", cache)).toBe(true);
  });

  it("matchesTopic uses word boundary (no partial matches)", () => {
    const cache = buildTopicPatternCache(["ai"]);
    const item = makeItem({ topics: [], text: "The main goal is" }); // "main" contains "ai" but not at boundary
    expect(matchesTopic(item, "ai", cache)).toBe(false);
  });

  it("matchesTopic is case-insensitive for tags", () => {
    const cache = buildTopicPatternCache(["AI"]);
    const item = makeItem({ topics: ["ai"] });
    expect(matchesTopic(item, "AI", cache)).toBe(true);
  });

  it("escapes regex special chars in topic names", () => {
    const cache = buildTopicPatternCache(["C++"]);
    // "C++" as a topic tag matches via the tag path, not regex
    const item = makeItem({ topics: ["C++"], text: "Learning programming" });
    expect(matchesTopic(item, "C++", cache)).toBe(true);
  });
});

// ─── computeTopicTrends ──────────────────────────────────────────

describe("computeTopicTrends", () => {
  const WEEK_MS = 7 * 86400000;
  const now = Date.now();

  it("returns trends sorted by current count desc", () => {
    const items = [
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.5 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.3 }),
      makeItem({ topics: ["crypto"], createdAt: now - WEEK_MS * 0.1 }),
    ];
    const trends = computeTopicTrends(items, 2);
    expect(trends[0].topic).toBe("ai");
    expect(trends[0].currentCount).toBe(2);
  });

  it("calculates change percent correctly", () => {
    const items = [
      // Current week: 3 ai items
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.1 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.2 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.3 }),
      // Previous week: 1 ai item
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 1.5 }),
    ];
    const trends = computeTopicTrends(items, 2);
    const ai = trends.find(t => t.topic === "ai")!;
    expect(ai.currentCount).toBe(3);
    expect(ai.previousCount).toBe(1);
    expect(ai.changePercent).toBe(200); // (3-1)/1 * 100
    expect(ai.direction).toBe("up");
  });

  it("direction is 'down' for >10% decrease", () => {
    const items = [
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.5 }), // current: 1
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 1.2 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 1.3 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 1.4 }), // previous: 3
    ];
    const trends = computeTopicTrends(items, 2);
    const ai = trends.find(t => t.topic === "ai")!;
    expect(ai.direction).toBe("down");
  });

  it("direction is 'stable' for small changes", () => {
    const items = [
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.5 }),
      makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 1.5 }),
    ];
    const trends = computeTopicTrends(items, 2);
    const ai = trends.find(t => t.topic === "ai")!;
    expect(ai.changePercent).toBe(0);
    expect(ai.direction).toBe("stable");
  });

  it("handles new topic (100% change)", () => {
    const items = [
      makeItem({ topics: ["newTopic"], createdAt: now - WEEK_MS * 0.5 }),
    ];
    const trends = computeTopicTrends(items, 2);
    const t = trends.find(t => t.topic === "newtopic")!;
    expect(t.changePercent).toBe(100);
    expect(t.direction).toBe("up");
  });

  it("caps at 8 topics", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeItem({ topics: [`topic${i}`], createdAt: now - WEEK_MS * 0.5 }),
    );
    const trends = computeTopicTrends(items, 2);
    expect(trends.length).toBeLessThanOrEqual(8);
  });

  it("weeklyHistory has correct length", () => {
    const items = [makeItem({ topics: ["ai"], createdAt: now - WEEK_MS * 0.5 })];
    const trends = computeTopicTrends(items, 4);
    const ai = trends.find(t => t.topic === "ai")!;
    expect(ai.weeklyHistory).toHaveLength(4);
  });

  it("returns empty for empty content", () => {
    expect(computeTopicTrends([], 4)).toEqual([]);
  });
});

// ─── titleWordOverlap ────────────────────────────────────────────

describe("titleWordOverlap", () => {
  it("returns 1.0 for identical strings", () => {
    expect(titleWordOverlap("hello world test", "hello world test")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(titleWordOverlap("apple banana cherry", "dog elephant fox")).toBe(0);
  });

  it("ignores short words (<=2 chars)", () => {
    // Words >2 chars: "the", "cat" vs "the", "dog"
    // Intersection: "the" (1). Union: "the", "cat", "dog" (3). → 1/3
    const overlap = titleWordOverlap("a is the cat", "a is the dog");
    expect(overlap).toBeCloseTo(1 / 3);
  });

  it("returns 0 for empty strings", () => {
    expect(titleWordOverlap("", "hello")).toBe(0);
    expect(titleWordOverlap("hello", "")).toBe(0);
    expect(titleWordOverlap("", "")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(titleWordOverlap("Hello World", "hello world")).toBe(1);
  });

  it("handles partial overlap", () => {
    const overlap = titleWordOverlap("Breaking News About AI Safety", "Breaking Analysis About Safety");
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });
});

// ─── clusterByStory ──────────────────────────────────────────────

describe("clusterByStory", () => {
  const now = Date.now();

  it("returns empty array for empty input", () => {
    expect(clusterByStory([])).toEqual([]);
  });

  it("clusters items sharing 2+ topics within time window", () => {
    const items = [
      makeItem({ id: "a", topics: ["ai", "safety", "policy"], createdAt: now }),
      makeItem({ id: "b", topics: ["ai", "safety", "research"], createdAt: now - 1000 }),
      makeItem({ id: "c", topics: ["crypto", "defi"], createdAt: now }),
    ];
    const clusters = clusterByStory(items);
    // a and b share "ai" + "safety" (2 topics) → same cluster
    // c is separate
    const abCluster = clusters.find(cl => cl.members.some(m => m.id === "a") && cl.members.some(m => m.id === "b"));
    expect(abCluster).toBeDefined();
    expect(abCluster!.members).toHaveLength(2);

    const cCluster = clusters.find(cl => cl.members.some(m => m.id === "c"));
    expect(cCluster).toBeDefined();
    expect(cCluster!.members).toHaveLength(1);
  });

  it("does not cluster items outside 48h time window", () => {
    const items = [
      makeItem({ id: "recent", topics: ["ai", "safety"], createdAt: now }),
      makeItem({ id: "old", topics: ["ai", "safety"], createdAt: now - 49 * 3600 * 1000 }), // 49 hours ago
    ];
    const clusters = clusterByStory(items);
    // Should be 2 separate clusters
    expect(clusters).toHaveLength(2);
  });

  it("clusters items sharing 1 topic + high title overlap", () => {
    const items = [
      makeItem({ id: "a", text: "Breaking: Major earthquake hits Japan with magnitude 7.5", topics: ["earthquake"], createdAt: now }),
      makeItem({ id: "b", text: "Breaking: Major earthquake hits Japan causing widespread damage", topics: ["earthquake"], createdAt: now - 1000 }),
    ];
    const clusters = clusterByStory(items);
    // 1 shared topic + high title overlap → same cluster
    const combined = clusters.find(cl => cl.members.length === 2);
    expect(combined).toBeDefined();
    expect(combined!.members.map(m => m.id).sort()).toEqual(["a", "b"]);
    expect(combined!.sharedTopics).toContain("earthquake");
  });

  it("representative is highest-scoring member", () => {
    const items = [
      makeItem({ id: "low", topics: ["ai", "safety"], scores: { originality: 3, insight: 3, credibility: 3, composite: 3 }, createdAt: now }),
      makeItem({ id: "high", topics: ["ai", "safety"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 }, createdAt: now }),
    ];
    const clusters = clusterByStory(items);
    const cluster = clusters.find(cl => cl.members.length === 2)!;
    expect(cluster.representative.id).toBe("high");
  });

  it("sharedTopics contains topics common to all members", () => {
    const items = [
      makeItem({ id: "a", topics: ["ai", "safety", "policy"], createdAt: now }),
      makeItem({ id: "b", topics: ["ai", "safety", "research"], createdAt: now }),
    ];
    const clusters = clusterByStory(items);
    const cluster = clusters.find(cl => cl.members.length === 2)!;
    expect(cluster.sharedTopics).toContain("ai");
    expect(cluster.sharedTopics).toContain("safety");
    expect(cluster.sharedTopics).not.toContain("policy");
    expect(cluster.sharedTopics).not.toContain("research");
  });

  it("singleton clusters have empty sharedTopics", () => {
    const items = [makeItem({ id: "alone", topics: ["unique"], createdAt: now })];
    const clusters = clusterByStory(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sharedTopics).toEqual([]);
  });

  it("clusters sorted by representative composite desc", () => {
    const items = [
      makeItem({ id: "c1", topics: ["crypto", "defi"], scores: { originality: 3, insight: 3, credibility: 3, composite: 3 }, createdAt: now }),
      makeItem({ id: "c2", topics: ["crypto", "defi"], scores: { originality: 4, insight: 4, credibility: 4, composite: 4 }, createdAt: now }),
      makeItem({ id: "a1", topics: ["ai", "safety"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 }, createdAt: now }),
      makeItem({ id: "a2", topics: ["ai", "safety"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 }, createdAt: now }),
    ];
    const clusters = clusterByStory(items);
    expect(clusters[0].representative.scores.composite).toBeGreaterThanOrEqual(clusters[1].representative.scores.composite);
  });

  it("handles items with no topics (no clustering)", () => {
    const items = [
      makeItem({ id: "a", topics: [], createdAt: now }),
      makeItem({ id: "b", topics: [], createdAt: now }),
    ];
    const clusters = clusterByStory(items);
    // No topics means no shared topics, so each is singleton
    expect(clusters).toHaveLength(2);
  });
});
