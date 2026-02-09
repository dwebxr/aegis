/**
 * Edge case and boundary tests for lib/briefing/ranker.ts — generateBriefing.
 * Covers: tied scores, large datasets, empty topics, validated items,
 * negative affinities, zero-score items, extreme recency decay.
 */
import { generateBriefing } from "@/lib/briefing/ranker";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
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

describe("generateBriefing — tied scores", () => {
  it("handles all items having identical composite scores", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({
        id: `tied-${i}`,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        createdAt: Date.now(), // same timestamp
        topics: ["general"],
      })
    );
    const result = generateBriefing(items, makeProfile());

    expect(result.priority).toHaveLength(5);
    expect(result.serendipity).not.toBeNull();
    // Total items accounted for
    expect(result.priority.length + 1 + result.filteredOut.length).toBe(8);
  });

  it("breaks ties via recency when composite scores are identical", () => {
    const now = Date.now();
    const items = [
      makeItem({
        id: "older",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 7.0 },
        createdAt: now - 24 * 3600 * 1000, // 24h ago
      }),
      makeItem({
        id: "newer",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 7.0 },
        createdAt: now, // just now
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    // Newer item should be ranked higher due to recency factor
    expect(result.priority[0].item.id).toBe("newer");
  });
});

describe("generateBriefing — large datasets", () => {
  it("handles 100 items without error", () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({
        id: `large-${i}`,
        scores: { originality: 5, insight: 5, credibility: 5, composite: Math.random() * 10 },
      })
    );
    const result = generateBriefing(items, makeProfile());

    expect(result.priority).toHaveLength(5);
    expect(result.totalItems).toBe(100);
    // Priority scores should be sorted descending
    for (let i = 1; i < result.priority.length; i++) {
      expect(result.priority[i - 1].briefingScore).toBeGreaterThanOrEqual(result.priority[i].briefingScore);
    }
  });

  it("handles 1000 items without error", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({
        id: `bulk-${i}`,
        scores: { originality: 5, insight: 5, credibility: 5, composite: Math.random() * 10 },
      })
    );
    const start = performance.now();
    const result = generateBriefing(items, makeProfile());
    const elapsed = performance.now() - start;

    expect(result.totalItems).toBe(1000);
    expect(result.priority).toHaveLength(5);
    // Should complete in reasonable time (< 500ms)
    expect(elapsed).toBeLessThan(500);
  });
});

describe("generateBriefing — empty/missing topics", () => {
  it("handles items with undefined topics", () => {
    const items = [
      makeItem({ id: "no-topics-1", topics: undefined }),
      makeItem({ id: "no-topics-2", topics: undefined }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority.length).toBeGreaterThanOrEqual(1);
  });

  it("handles items with empty topics array", () => {
    const items = [
      makeItem({ id: "empty-topics-1", topics: [] }),
      makeItem({ id: "empty-topics-2", topics: [] }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority.length).toBeGreaterThanOrEqual(1);
  });

  it("mixed: some items with topics, some without", () => {
    const profile = makeProfile({ topicAffinities: { "ai": 0.9 } });
    const items = [
      makeItem({
        id: "with-topics",
        topics: ["ai"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
      makeItem({
        id: "without-topics",
        topics: undefined,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, profile);
    // Item with matching topic should rank higher
    expect(result.priority[0].item.id).toBe("with-topics");
  });
});

describe("generateBriefing — negative topic affinities", () => {
  it("ranks items with negative affinity topics lower", () => {
    const profile = makeProfile({
      topicAffinities: { "spam": -0.8, "quality": 0.8 },
    });
    const items = [
      makeItem({
        id: "neg-topic",
        topics: ["spam"],
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      }),
      makeItem({
        id: "pos-topic",
        topics: ["quality"],
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      }),
    ];
    const result = generateBriefing(items, profile);
    expect(result.priority[0].item.id).toBe("pos-topic");
  });

  it("items with very negative affinity can be ranked below lower-composite items", () => {
    const profile = makeProfile({
      topicAffinities: { "hated": -2.0, "liked": 0.5 },
    });
    const items = [
      makeItem({
        id: "high-score-hated",
        topics: ["hated"],
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }),
      makeItem({
        id: "low-score-liked",
        topics: ["liked"],
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, profile);
    // The -2.0 affinity * 2 = -4.0 penalty should pull the 9-composite item below
    expect(result.priority[0].item.id).toBe("low-score-liked");
  });
});

describe("generateBriefing — zero and extreme scores", () => {
  it("handles items with composite score of 0", () => {
    const items = [
      makeItem({
        id: "zero-score",
        scores: { originality: 0, insight: 0, credibility: 0, composite: 0 },
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority).toHaveLength(1);
    expect(result.priority[0].briefingScore).toBe(0);
  });

  it("handles items with composite score of 10", () => {
    const items = [
      makeItem({
        id: "perfect",
        scores: { originality: 10, insight: 10, credibility: 10, composite: 10 },
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority[0].briefingScore).toBeGreaterThan(0);
  });
});

describe("generateBriefing — validated and flagged items", () => {
  it("excludes flagged items from priority", () => {
    const items = [
      makeItem({ id: "flagged-1", flagged: true }),
      makeItem({ id: "not-flagged", flagged: false }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority).toHaveLength(1);
    expect(result.priority[0].item.id).toBe("not-flagged");
  });

  it("includes validated items in priority", () => {
    const items = [
      makeItem({ id: "validated-1", validated: true }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority).toHaveLength(1);
    expect(result.priority[0].item.id).toBe("validated-1");
  });

  it("flagged items appear in filteredOut", () => {
    const items = [
      makeItem({ id: "normal" }),
      makeItem({ id: "flagged", flagged: true }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.filteredOut.some(f => f.id === "flagged")).toBe(true);
  });
});

describe("generateBriefing — extreme recency", () => {
  it("very old items (30 days) have heavily decayed scores", () => {
    const items = [
      makeItem({
        id: "ancient",
        createdAt: Date.now() - 30 * 24 * 3600 * 1000, // 30 days ago
        scores: { originality: 10, insight: 10, credibility: 10, composite: 10 },
      }),
      makeItem({
        id: "fresh",
        createdAt: Date.now(),
        scores: { originality: 3, insight: 3, credibility: 3, composite: 3 },
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    // Fresh low-score item should rank higher than ancient high-score item
    expect(result.priority[0].item.id).toBe("fresh");
  });

  it("future timestamp (clock skew) does not crash", () => {
    const items = [
      makeItem({
        id: "future",
        createdAt: Date.now() + 3600 * 1000, // 1 hour in the future
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.priority).toHaveLength(1);
    // Score should still be positive (recencyFactor for negative age → exp(positive) > 1)
    expect(result.priority[0].briefingScore).toBeGreaterThan(0);
  });
});

describe("generateBriefing — serendipity scoring", () => {
  it("prefers items with high vSignal and low cContext for serendipity", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `filler-${i}`, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } })
      ),
      makeItem({
        id: "high-novelty",
        vSignal: 9,
        cContext: 1,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        topics: ["unknown-topic"],
      }),
      makeItem({
        id: "low-novelty",
        vSignal: 3,
        cContext: 9,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        topics: ["ai"],
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.serendipity).not.toBeNull();
    expect(result.serendipity!.item.id).toBe("high-novelty");
  });

  it("uses composite as vSignal fallback when vSignal is undefined", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `fill-${i}`, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } })
      ),
      makeItem({
        id: "no-vcl",
        // no vSignal, no cContext
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, makeProfile());
    expect(result.serendipity).not.toBeNull();
    // Should not crash and should have a valid briefingScore
    expect(typeof result.serendipity!.briefingScore).toBe("number");
  });

  it("topic novelty boosts serendipity for unknown topics", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.9 }, // well-known topic
    });
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `base-${i}`, topics: ["ai"] })
      ),
      makeItem({
        id: "novel-topic",
        topics: ["quantum-computing"], // not in affinities
        vSignal: 7,
        cContext: 3,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
      makeItem({
        id: "known-topic",
        topics: ["ai"],
        vSignal: 7,
        cContext: 3,
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, profile);
    expect(result.serendipity).not.toBeNull();
    // Novel topic should be preferred for serendipity
    expect(result.serendipity!.item.id).toBe("novel-topic");
  });
});

describe("generateBriefing — author trust", () => {
  it("author trust accumulates across multiple matching items", () => {
    const profile = makeProfile({
      authorTrust: {
        "trusted": { validates: 20, flags: 0, trust: 0.9 },
        "distrusted": { validates: 0, flags: 10, trust: -0.5 },
      },
    });
    const items = [
      makeItem({
        id: "from-trusted",
        author: "trusted",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
      makeItem({
        id: "from-distrusted",
        author: "distrusted",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, profile);
    expect(result.priority[0].item.id).toBe("from-trusted");
  });

  it("unknown author has zero trust boost", () => {
    const profile = makeProfile({
      authorTrust: { "known": { validates: 5, flags: 0, trust: 0.5 } },
    });
    const items = [
      makeItem({
        id: "from-known",
        author: "known",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
      makeItem({
        id: "from-unknown",
        author: "stranger",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }),
    ];
    const result = generateBriefing(items, profile);
    expect(result.priority[0].item.id).toBe("from-known");
  });
});

describe("generateBriefing — generatedAt timestamp", () => {
  it("sets generatedAt close to current time", () => {
    const before = Date.now();
    const result = generateBriefing([makeItem()], makeProfile());
    const after = Date.now();
    expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.generatedAt).toBeLessThanOrEqual(after);
  });
});
