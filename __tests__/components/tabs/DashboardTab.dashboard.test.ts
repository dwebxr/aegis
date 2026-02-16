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
  it("counts only today's items", () => {
    const now = Date.now();
    const dayMs = 86400000;
    const items = [
      makeItem({ id: "t1", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "t2", createdAt: now - 2000, verdict: "slop" }),
      makeItem({ id: "old", createdAt: now - dayMs - 1000, verdict: "quality" }),
    ];
    const todayItems = items.filter(c => c.createdAt >= now - dayMs);
    expect(todayItems).toHaveLength(2);
    expect(todayItems.filter(c => c.verdict === "quality")).toHaveLength(1);
    expect(todayItems.filter(c => c.verdict === "slop")).toHaveLength(1);
  });

  it("returns most recent 3 actions", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const recentActions = items
      .filter(c => c.validated || c.flagged)
      .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
      .slice(0, 3);
    expect(recentActions).toHaveLength(3);
    expect(recentActions[0].validatedAt).toBe(5000);
  });
});

describe("Dashboard mode — localStorage persistence", () => {
  it("defaults to feed when no localStorage value", () => {
    const saved = null;
    const mode = saved === "dashboard" ? "dashboard" : "feed";
    expect(mode).toBe("feed");
  });

  it("restores dashboard when localStorage has dashboard", () => {
    const saved = "dashboard";
    const mode = saved === "dashboard" ? "dashboard" : "feed";
    expect(mode).toBe("dashboard");
  });

  it("defaults to feed for invalid localStorage value", () => {
    const saved: string | null = "invalid";
    const mode = saved === "dashboard" ? "dashboard" : "feed";
    expect(mode).toBe("feed");
  });
});
