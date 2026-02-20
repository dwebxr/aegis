import { generateBriefing } from "@/lib/briefing/ranker";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: "Test content text for testing purposes with enough words",
    source: "manual",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

describe("Dashboard mode — Today's Top 3", () => {
  it("returns top 3 from generateBriefing priority", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `item-${i}`, scores: { originality: 5, insight: 5, credibility: 5, composite: i + 1 } }),
    );
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing(items, profile);
    const top3 = briefing.priority.slice(0, 3);
    expect(top3.length).toBeLessThanOrEqual(3);
    expect(top3.length).toBeGreaterThan(0);
    // Highest composites first (after briefingScore weighting)
    expect(top3[0].briefingScore).toBeGreaterThanOrEqual(top3[1].briefingScore);
  });

  it("returns fewer than 3 when content is sparse", () => {
    const items = [makeItem({ scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } })];
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing(items, profile);
    expect(briefing.priority.slice(0, 3)).toHaveLength(1);
  });

  it("returns empty for all-slop content", () => {
    const items = [makeItem({ verdict: "slop", scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } })];
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing(items, profile);
    expect(briefing.priority.slice(0, 3)).toHaveLength(0);
  });
});

describe("Dashboard mode — Topic Spotlight", () => {
  it("selects best item per high-affinity topic", () => {
    const profile = {
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0.5, crypto: 0.4, cooking: 0.1 },
    };
    const items = [
      makeItem({ id: "a1", topics: ["ai"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "a2", topics: ["ai"], scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
      makeItem({ id: "c1", topics: ["crypto"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "k1", topics: ["cooking"], scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];

    const highTopics = Object.entries(profile.topicAffinities)
      .filter(([, v]) => v >= 0.3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k]) => k);

    expect(highTopics).toContain("ai");
    expect(highTopics).toContain("crypto");
    expect(highTopics).not.toContain("cooking"); // 0.1 < 0.3

    const qualityItems = items.filter(c => c.verdict === "quality" && !c.flagged);
    const spotlight = highTopics.map(topic => {
      const topicItems = qualityItems.filter(c => c.topics?.includes(topic));
      if (topicItems.length === 0) return null;
      return { topic, item: topicItems.reduce((a, b) => b.scores.composite > a.scores.composite ? b : a) };
    }).filter(Boolean) as Array<{ topic: string; item: ContentItem }>;

    expect(spotlight).toHaveLength(2);
    const aiEntry = spotlight.find(s => s.topic === "ai");
    expect(aiEntry!.item.scores.composite).toBe(8);
    const cryptoEntry = spotlight.find(s => s.topic === "crypto");
    expect(cryptoEntry!.item.scores.composite).toBe(9);
  });

  it("returns empty when no high-affinity topics exist", () => {
    const profile = {
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0.1, crypto: 0.2 },
    };
    const highTopics = Object.entries(profile.topicAffinities)
      .filter(([, v]) => v >= 0.3);
    expect(highTopics).toHaveLength(0);
  });

  it("caps at 5 topics", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 10; i++) affinities[`topic-${i}`] = 0.5 + i * 0.01;
    const highTopics = Object.entries(affinities)
      .filter(([, v]) => v >= 0.3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    expect(highTopics).toHaveLength(5);
  });
});

describe("Dashboard mode — Saved for Later", () => {
  it("returns validated items sorted by validatedAt descending", () => {
    const items = [
      makeItem({ id: "v1", validated: true, validatedAt: 1000 }),
      makeItem({ id: "v2", validated: true, validatedAt: 3000 }),
      makeItem({ id: "v3", validated: true, validatedAt: 2000 }),
      makeItem({ id: "nv", validated: false }),
    ];
    const result = items
      .filter(c => c.validated)
      .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
      .slice(0, 5);

    expect(result).toHaveLength(3);
    expect(result[0].validatedAt).toBe(3000);
    expect(result[1].validatedAt).toBe(2000);
    expect(result[2].validatedAt).toBe(1000);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `v-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = items
      .filter(c => c.validated)
      .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
      .slice(0, 5);
    expect(result).toHaveLength(5);
  });
});

describe("Dashboard mode — Recent Activity", () => {
  const now = Date.now();
  const dayMs = 86400000;

  // Replicate the dashboardActivity computation from DashboardTab
  function computeActivity(
    content: ContentItem[],
    activityRange: "today" | "7d" | "30d",
  ) {
    const rangeDays = activityRange === "30d" ? 30 : activityRange === "7d" ? 7 : 1;
    const rangeStart = now - rangeDays * dayMs;
    const rangeItems = content.filter(c => c.createdAt >= rangeStart);
    const actionLimit = activityRange === "today" ? 3 : 5;
    const recentActions = content
      .filter(c => c.validated || c.flagged)
      .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
      .slice(0, actionLimit);
    const chartDays = Math.min(rangeDays, 30);
    const chartQuality: number[] = [];
    const chartSlop: number[] = [];
    for (let i = chartDays - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * dayMs;
      const dayEnd = now - i * dayMs;
      const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
      const dayQual = dayItems.filter(c => c.verdict === "quality").length;
      const dayTotal = dayItems.length;
      chartQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
      chartSlop.push(dayItems.filter(c => c.verdict === "slop").length);
    }
    return {
      qualityCount: rangeItems.filter(c => c.verdict === "quality").length,
      slopCount: rangeItems.filter(c => c.verdict === "slop").length,
      totalEvaluated: rangeItems.length,
      recentActions,
      chartQuality,
      chartSlop,
    };
  }

  it("today range: counts only last 24h items", () => {
    const items = [
      makeItem({ id: "t1", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "t2", createdAt: now - 2000, verdict: "slop" }),
      makeItem({ id: "old", createdAt: now - dayMs - 1000, verdict: "quality" }),
    ];
    const result = computeActivity(items, "today");
    expect(result.qualityCount).toBe(1);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(2);
  });

  it("7d range: includes items from last 7 days", () => {
    const items = [
      makeItem({ id: "d0", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "d3", createdAt: now - 3 * dayMs, verdict: "quality" }),
      makeItem({ id: "d6", createdAt: now - 6 * dayMs, verdict: "slop" }),
      makeItem({ id: "d8", createdAt: now - 8 * dayMs, verdict: "quality" }), // outside 7d
    ];
    const result = computeActivity(items, "7d");
    expect(result.qualityCount).toBe(2);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(3);
  });

  it("30d range: includes items from last 30 days", () => {
    const items = [
      makeItem({ id: "d0", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "d15", createdAt: now - 15 * dayMs, verdict: "slop" }),
      makeItem({ id: "d29", createdAt: now - 29 * dayMs, verdict: "quality" }),
      makeItem({ id: "d31", createdAt: now - 31 * dayMs, verdict: "quality" }), // outside 30d
    ];
    const result = computeActivity(items, "30d");
    expect(result.qualityCount).toBe(2);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(3);
  });

  it("today range: limits recent actions to 3", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeActivity(items, "today");
    expect(result.recentActions).toHaveLength(3);
    expect(result.recentActions[0].validatedAt).toBe(5000);
  });

  it("7d range: limits recent actions to 5", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeActivity(items, "7d");
    expect(result.recentActions).toHaveLength(5);
  });

  it("30d range: limits recent actions to 5", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeActivity(items, "30d");
    expect(result.recentActions).toHaveLength(5);
  });

  it("chart data has correct number of days", () => {
    const items = [makeItem({ createdAt: now - 1000 })];
    expect(computeActivity(items, "today").chartQuality).toHaveLength(1);
    expect(computeActivity(items, "7d").chartQuality).toHaveLength(7);
    expect(computeActivity(items, "30d").chartQuality).toHaveLength(30);
  });

  it("chart data computes quality percentage per day", () => {
    // 2 quality, 1 slop in the most recent day bucket
    const items = [
      makeItem({ id: "q1", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "q2", createdAt: now - 2000, verdict: "quality" }),
      makeItem({ id: "s1", createdAt: now - 3000, verdict: "slop" }),
    ];
    const result = computeActivity(items, "today");
    // Last entry = most recent day: 2 quality / 3 total = 67%
    expect(result.chartQuality[result.chartQuality.length - 1]).toBe(67);
    expect(result.chartSlop[result.chartSlop.length - 1]).toBe(1);
  });
});

// localStorage persistence tests removed — they tested local variables
// instead of real component behavior. Real coverage is in DashboardTab.test.tsx
// "DashboardTab — dashboard mode rendering" → "restores dashboard mode from localStorage".
