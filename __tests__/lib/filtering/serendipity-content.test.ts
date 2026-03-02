import { isContentSerendipity, classifyDiscovery, generateDiscoveryReason, detectSerendipity } from "@/lib/filtering/serendipity";
import type { ContentItem } from "@/lib/types/content";
import type { FilteredItem, FilterPipelineResult } from "@/lib/filtering/types";
import { createEmptyProfile } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    text: "Test article about technology",
    author: "TestAuthor",
    source: "rss",
    verdict: "quality",
    reason: "Good",
    topics: ["tech"],
    createdAt: Date.now(),
    scores: { composite: 8, originality: 8, insight: 8, credibility: 8, weight: 1 },
    vSignal: 8,
    cContext: 8,
    lSlop: 2,
    ...overrides,
  };
}

function makeProfile(overrides = {}) {
  return {
    ...createEmptyProfile("user"),
    totalValidated: 20,
    totalFlagged: 5,
    topicAffinities: { tech: 0.5, crypto: 0.3 },
    authorTrust: { KnownAuthor: { validates: 5, flags: 0, trust: 0.8 } },
    ...overrides,
  };
}

describe("isContentSerendipity — boundary and edge cases", () => {
  it("returns false for low-composite items", () => {
    const item = makeItem({ scores: { composite: 5, originality: 5, insight: 5, credibility: 5, weight: 1 } });
    expect(isContentSerendipity(item, makeProfile())).toBe(false);
  });

  it("cold start: returns true for high-quality items (>8)", () => {
    const item = makeItem({ scores: { composite: 8.5, originality: 8, insight: 8, credibility: 8, weight: 1 } });
    expect(isContentSerendipity(item, undefined)).toBe(true);
  });

  it("cold start: returns false below 8.0 threshold", () => {
    const item = makeItem({ scores: { composite: 7.9, originality: 7, insight: 7, credibility: 7, weight: 1 } });
    expect(isContentSerendipity(item, undefined)).toBe(false);
  });

  it("returns true for novel topics (low affinity)", () => {
    const item = makeItem({
      topics: ["quantum_physics"],
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(true);
  });

  it("returns false for familiar topics", () => {
    const item = makeItem({
      topics: ["tech"],
      author: "KnownAuthor",
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(false);
  });

  it("returns true for unknown author even with familiar topics", () => {
    const item = makeItem({
      topics: ["tech"],
      author: "StrangerAuthor",
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(true);
  });

  it("handles empty topics array", () => {
    const item = makeItem({
      topics: [],
      author: "StrangerAuthor",
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(true);
  });

  it("borderline: composite exactly at threshold (7.0) is NOT serendipity", () => {
    const item = makeItem({
      topics: ["novel"],
      scores: { composite: 7.0, originality: 7, insight: 7, credibility: 7, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(false);
  });

  it("uses absolute value for negative affinities", () => {
    const item = makeItem({
      topics: ["disliked"],
      author: "KnownAuthor",
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    // abs(-0.8) = 0.8 > 0.15 → familiar, not novel; known author → false
    const profile = makeProfile({ topicAffinities: { disliked: -0.8 } });
    expect(isContentSerendipity(item, profile)).toBe(false);
  });

  it("mixed topics: average affinity determines novelty", () => {
    const item = makeItem({
      topics: ["tech", "quantum"], // tech=0.5, quantum=0 → avg=0.25 > 0.15
      author: "KnownAuthor",
      scores: { composite: 7.5, originality: 8, insight: 8, credibility: 8, weight: 1 },
    });
    expect(isContentSerendipity(item, makeProfile())).toBe(false);
  });
});

describe("classifyDiscovery — edge cases", () => {
  it("empty text does not trigger cross_language", () => {
    const fi: FilteredItem = {
      item: makeItem({ text: "" }),
      passed: true,
      wotScore: { trustScore: 0.5, isInGraph: true, hopDistance: 1 },
    };
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("30% non-ASCII is the boundary (not triggered at exactly 30%)", () => {
    // 3 non-ASCII out of 10 chars = 0.3
    const text = "abcdefg日本語"; // 7 ASCII + 3 non-ASCII = 10 chars, ratio = 0.3
    const fi: FilteredItem = {
      item: makeItem({ text }),
      passed: true,
      wotScore: { trustScore: 0.5, isInGraph: true, hopDistance: 1 },
    };
    // ratio === 0.3 → NOT cross_language (must be > 0.3)
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });
});

describe("detectSerendipity — limits and sorting", () => {
  it("caps at 5 discoveries", () => {
    const items: FilteredItem[] = Array.from({ length: 10 }, (_, i) => ({
      item: makeItem({ id: `item-${i}`, scores: { composite: 9 - i * 0.1, originality: 8, insight: 8, credibility: 8, weight: 1 } }),
      passed: true,
      isWoTSerendipity: true,
      wotScore: { trustScore: 0.1, isInGraph: false, hopDistance: 99 },
    }));

    const result: FilterPipelineResult = { items, totalProcessed: 10, wotFiltered: 0 };
    expect(detectSerendipity(result).length).toBe(5);
  });

  it("returns highest-composite items first", () => {
    const items: FilteredItem[] = [
      { item: makeItem({ id: "low", scores: { composite: 6, originality: 6, insight: 6, credibility: 6, weight: 1 } }), passed: true, isContentSerendipity: true },
      { item: makeItem({ id: "high", scores: { composite: 9, originality: 9, insight: 9, credibility: 9, weight: 1 } }), passed: true, isContentSerendipity: true },
    ];
    const result: FilterPipelineResult = { items, totalProcessed: 2, wotFiltered: 0 };
    const disc = detectSerendipity(result);
    expect(disc[0].item.id).toBe("high");
  });

  it("returns empty when no serendipity flags set", () => {
    const items: FilteredItem[] = [{ item: makeItem(), passed: true }];
    const result: FilterPipelineResult = { items, totalProcessed: 1, wotFiltered: 0 };
    expect(detectSerendipity(result)).toEqual([]);
  });

  it("includes correct wotScore and qualityComposite in output", () => {
    const items: FilteredItem[] = [{
      item: makeItem({ scores: { composite: 8.5, originality: 8, insight: 8, credibility: 8, weight: 1 } }),
      passed: true,
      isWoTSerendipity: true,
      wotScore: { trustScore: 0.2, isInGraph: false, hopDistance: 5 },
    }];
    const result: FilterPipelineResult = { items, totalProcessed: 1, wotFiltered: 0 };
    const [disc] = detectSerendipity(result);
    expect(disc.wotScore).toBe(0.2);
    expect(disc.qualityComposite).toBe(8.5);
    expect(disc.discoveryType).toBe("out_of_network");
  });
});
