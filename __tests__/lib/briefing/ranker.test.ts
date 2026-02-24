import { generateBriefing, classifyItem } from "@/lib/briefing/ranker";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "🧪",
    text: "Test content",
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

function makeProfile(overrides: Partial<UserPreferenceProfile> = {}): UserPreferenceProfile {
  return { ...createEmptyProfile("test"), ...overrides };
}

describe("generateBriefing", () => {
  describe("empty and minimal content", () => {
    it("returns empty briefing for no content", () => {
      const result = generateBriefing([], makeProfile());
      expect(result.priority).toEqual([]);
      expect(result.serendipity).toBeNull();
      expect(result.filteredOut).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it("returns empty briefing when all content is slop", () => {
      const items = [
        makeItem({ verdict: "slop" }),
        makeItem({ verdict: "slop" }),
      ];
      const result = generateBriefing(items, makeProfile());
      expect(result.priority).toEqual([]);
      expect(result.serendipity).toBeNull();
      // slop items go to filteredOut
      expect(result.filteredOut).toHaveLength(2);
    });

    it("returns empty briefing when all content is flagged", () => {
      const items = [
        makeItem({ flagged: true }),
        makeItem({ flagged: true }),
      ];
      const result = generateBriefing(items, makeProfile());
      expect(result.priority).toEqual([]);
    });

    it("handles single quality item", () => {
      const item = makeItem();
      const result = generateBriefing([item], makeProfile());
      expect(result.priority).toHaveLength(1);
      expect(result.priority[0].item.id).toBe(item.id);
      expect(result.serendipity).toBeNull(); // no remaining items for serendipity
    });
  });

  describe("priority selection", () => {
    it("selects top 5 quality items by briefingScore", () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeItem({
          id: `item-${i}`,
          scores: { originality: 5, insight: 5, credibility: 5, composite: i + 1 },
          createdAt: Date.now(), // all same recency
        })
      );
      const result = generateBriefing(items, makeProfile());
      expect(result.priority).toHaveLength(5);
      // Highest composite scores should be priority
      const priorityIds = result.priority.map(p => p.item.id);
      expect(priorityIds).toContain("item-9"); // composite 10
      expect(priorityIds).toContain("item-8"); // composite 9
      expect(priorityIds).toContain("item-7"); // composite 8
    });

    it("assigns isSerendipity=false for priority items", () => {
      const items = Array.from({ length: 3 }, () => makeItem());
      const result = generateBriefing(items, makeProfile());
      result.priority.forEach(p => {
        expect(p.isSerendipity).toBe(false);
      });
    });

    it("includes briefingScore in results", () => {
      const items = [makeItem()];
      const result = generateBriefing(items, makeProfile());
      expect(typeof result.priority[0].briefingScore).toBe("number");
      expect(result.priority[0].briefingScore).toBeGreaterThan(0);
    });
  });

  describe("serendipity selection", () => {
    it("selects serendipity from items beyond top 5", () => {
      const items = Array.from({ length: 8 }, (_, i) =>
        makeItem({
          id: `item-${i}`,
          scores: { originality: 5, insight: 5, credibility: 5, composite: 7 },
          topics: [`topic-${i}`],
          vSignal: 8,
          cContext: 2, // low context → high novelty
        })
      );
      const result = generateBriefing(items, makeProfile());
      expect(result.serendipity).not.toBeNull();
      expect(result.serendipity!.isSerendipity).toBe(true);
      // Serendipity should NOT be one of the priority items
      const priorityIds = result.priority.map(p => p.item.id);
      expect(priorityIds).not.toContain(result.serendipity!.item.id);
    });

    it("returns null serendipity when 5 or fewer quality items", () => {
      const items = Array.from({ length: 5 }, () => makeItem());
      const result = generateBriefing(items, makeProfile());
      // All 5 are priority, none left for serendipity
      expect(result.serendipity).toBeNull();
    });

    it("favors high vSignal + low cContext for serendipity", () => {
      const profile = makeProfile({
        topicAffinities: { "familiar": 0.9 },
      });
      const items = [
        ...Array.from({ length: 5 }, () => makeItem({ topics: ["familiar"] })),
        // Remaining items: one high novelty, one low novelty
        makeItem({
          id: "novel",
          topics: ["unknown-topic"],
          vSignal: 9,
          cContext: 1,
          scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        }),
        makeItem({
          id: "boring",
          topics: ["familiar"],
          vSignal: 3,
          cContext: 8,
          scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        }),
      ];
      const result = generateBriefing(items, profile);
      expect(result.serendipity).not.toBeNull();
      expect(result.serendipity!.item.id).toBe("novel");
    });
  });

  describe("filtered out", () => {
    it("includes all items not in priority or serendipity", () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeItem({ id: `item-${i}` })
      );
      const result = generateBriefing(items, makeProfile());
      const selectedIds = new Set([
        ...result.priority.map(p => p.item.id),
        ...(result.serendipity ? [result.serendipity.item.id] : []),
      ]);
      for (const item of result.filteredOut) {
        expect(selectedIds.has(item.id)).toBe(false);
      }
      // Total should be items.length
      expect(result.priority.length + (result.serendipity ? 1 : 0) + result.filteredOut.length)
        .toBe(items.length);
    });

    it("includes slop items in filteredOut", () => {
      const items = [
        makeItem({ id: "quality1" }),
        makeItem({ id: "slop1", verdict: "slop" }),
      ];
      const result = generateBriefing(items, makeProfile());
      expect(result.filteredOut.some(f => f.id === "slop1")).toBe(true);
    });
  });

  describe("totalItems", () => {
    it("reflects total input content count", () => {
      const items = Array.from({ length: 15 }, () => makeItem());
      const result = generateBriefing(items, makeProfile());
      expect(result.totalItems).toBe(15);
    });
  });

  describe("topic relevance boosting", () => {
    it("ranks items with high-affinity topics higher", () => {
      const profile = makeProfile({
        topicAffinities: { "ai": 0.9, "crypto": -0.5 },
      });
      const aiItem = makeItem({
        id: "ai-item",
        topics: ["ai"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      });
      const cryptoItem = makeItem({
        id: "crypto-item",
        topics: ["crypto"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      });
      const result = generateBriefing([aiItem, cryptoItem], profile);
      expect(result.priority[0].item.id).toBe("ai-item");
    });
  });

  describe("author trust boosting", () => {
    it("ranks items from trusted authors higher", () => {
      const profile = makeProfile({
        authorTrust: {
          "trusted": { validates: 10, flags: 0, trust: 0.8 },
          "unknown": { validates: 0, flags: 0, trust: 0 },
        },
      });
      const trustedItem = makeItem({
        id: "trusted-item",
        author: "trusted",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      });
      const unknownItem = makeItem({
        id: "unknown-item",
        author: "unknown",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      });
      const result = generateBriefing([trustedItem, unknownItem], profile);
      expect(result.priority[0].item.id).toBe("trusted-item");
    });
  });

  describe("recency decay", () => {
    it("ranks recent items higher than old ones (same score)", () => {
      const recentItem = makeItem({
        id: "recent",
        createdAt: Date.now(),
        scores: { originality: 5, insight: 5, credibility: 5, composite: 7 },
      });
      const oldItem = makeItem({
        id: "old",
        createdAt: Date.now() - 48 * 60 * 60 * 1000, // 48h ago
        scores: { originality: 5, insight: 5, credibility: 5, composite: 7 },
      });
      const result = generateBriefing([oldItem, recentItem], makeProfile());
      expect(result.priority[0].item.id).toBe("recent");
    });
  });

  describe("recentTopics bonus in briefingScore", () => {
    it("boosts items whose topics match recentTopics within 7-day window", () => {
      const now = Date.now();
      const profile = makeProfile({
        recentTopics: [
          { topic: "ai", timestamp: now - 1000 }, // very recent
        ],
      });
      const matchingItem = makeItem({
        id: "matching",
        topics: ["ai"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        createdAt: now,
      });
      const nonMatchingItem = makeItem({
        id: "non-matching",
        topics: ["crypto"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        createdAt: now,
      });
      const result = generateBriefing([nonMatchingItem, matchingItem], profile, now);
      // matching should rank higher due to recent topic bonus
      expect(result.priority[0].item.id).toBe("matching");
    });

    it("no bonus for topics older than 7 days", () => {
      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
      const profile = makeProfile({
        recentTopics: [
          { topic: "ai", timestamp: eightDaysAgo }, // expired
        ],
      });
      const item1 = makeItem({
        id: "item1",
        topics: ["ai"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        createdAt: now,
      });
      const item2 = makeItem({
        id: "item2",
        topics: ["crypto"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        createdAt: now,
      });
      const result = generateBriefing([item1, item2], profile, now);
      // Both should have equal composite scores, no recent bonus → sorted by id tiebreaker
      const scores = result.priority.map(p => p.briefingScore);
      expect(scores[0]).toBeCloseTo(scores[1], 5);
    });
  });

  describe("stable sort tiebreaker", () => {
    it("sorts by id when briefingScore is tied", () => {
      const now = Date.now();
      const items = ["c", "a", "b"].map(id =>
        makeItem({
          id,
          scores: { originality: 5, insight: 5, credibility: 5, composite: 7 },
          createdAt: now,
        })
      );
      const result = generateBriefing(items, makeProfile(), now);
      const ids = result.priority.map(p => p.item.id);
      // Equal scores → localeCompare by id → a, b, c
      expect(ids).toEqual(["a", "b", "c"]);
    });
  });

  describe("classification in generateBriefing output", () => {
    it("assigns classification to priority items", () => {
      const items = Array.from({ length: 3 }, () => makeItem());
      const result = generateBriefing(items, makeProfile());
      for (const p of result.priority) {
        expect(["familiar", "novel", "mixed"]).toContain(p.classification);
      }
    });

    it("serendipity item always has classification 'novel'", () => {
      const items = Array.from({ length: 8 }, (_, i) =>
        makeItem({ id: `item-${i}`, topics: [`topic-${i}`] })
      );
      const result = generateBriefing(items, makeProfile());
      if (result.serendipity) {
        expect(result.serendipity.classification).toBe("novel");
      }
    });
  });
});

describe("classifyItem", () => {
  it("returns 'novel' for item with no topics", () => {
    const item = makeItem({ topics: undefined });
    expect(classifyItem(item, makeProfile())).toBe("novel");
  });

  it("returns 'novel' for item with empty topics array", () => {
    const item = makeItem({ topics: [] });
    expect(classifyItem(item, makeProfile())).toBe("novel");
  });

  it("returns 'familiar' when avg |affinity| > 0.5", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.8, "ml": 0.7 },
    });
    const item = makeItem({ topics: ["ai", "ml"] });
    expect(classifyItem(item, profile)).toBe("familiar");
  });

  it("returns 'mixed' when avg |affinity| is between 0.15 and 0.5", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.3, "ml": 0.2 },
    });
    const item = makeItem({ topics: ["ai", "ml"] });
    expect(classifyItem(item, profile)).toBe("mixed");
  });

  it("returns 'novel' when avg |affinity| < 0.15", () => {
    const profile = makeProfile({
      topicAffinities: { "unknown-topic": 0.05 },
    });
    const item = makeItem({ topics: ["unknown-topic"] });
    expect(classifyItem(item, profile)).toBe("novel");
  });

  it("uses absolute value of negative affinities", () => {
    // Negative affinities still count as familiarity (user knows about it)
    const profile = makeProfile({
      topicAffinities: { "spam": -0.8, "scam": -0.7 },
    });
    const item = makeItem({ topics: ["spam", "scam"] });
    // avg |affinity| = (0.8 + 0.7) / 2 = 0.75 > 0.5 → "familiar"
    expect(classifyItem(item, profile)).toBe("familiar");
  });

  it("returns 'novel' when topics have no matching affinities", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.9 }, // high affinity but for different topic
    });
    const item = makeItem({ topics: ["gardening"] });
    // gardening has no affinity → 0 → < 0.15 → "novel"
    expect(classifyItem(item, profile)).toBe("novel");
  });

  it("boundary: avg |affinity| exactly at 0.5 is NOT familiar (> 0.5 required)", () => {
    const profile = makeProfile({
      topicAffinities: { "topic": 0.5 },
    });
    const item = makeItem({ topics: ["topic"] });
    // 0.5 is NOT > 0.5, so not familiar → check < 0.15? No → "mixed"
    expect(classifyItem(item, profile)).toBe("mixed");
  });

  it("boundary: avg |affinity| exactly at 0.15 is NOT novel (< 0.15 required)", () => {
    const profile = makeProfile({
      topicAffinities: { "topic": 0.15 },
    });
    const item = makeItem({ topics: ["topic"] });
    // 0.15 is NOT < 0.15, so not novel → check > 0.5? No → "mixed"
    expect(classifyItem(item, profile)).toBe("mixed");
  });
});
