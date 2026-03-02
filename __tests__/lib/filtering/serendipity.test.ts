import {
  detectSerendipity,
  classifyDiscovery,
  generateDiscoveryReason,
} from "@/lib/filtering/serendipity";
import type { FilterPipelineResult, FilteredItem } from "@/lib/filtering/types";
import type { ContentItem } from "@/lib/types/content";
import type { WoTScore } from "@/lib/wot/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
    text: "Test content for scoring",
    source: "nostr",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai", "crypto"],
    nostrPubkey: "pk-unknown",
    ...overrides,
  };
}

function makeWoTScore(overrides: Partial<WoTScore> = {}): WoTScore {
  return {
    pubkey: "pk-unknown",
    trustScore: 0.1,
    hopDistance: Infinity,
    mutualFollows: 0,
    isInGraph: false,
    ...overrides,
  };
}

function makeFilteredItem(
  itemOverrides: Partial<ContentItem> = {},
  wotOverrides: Partial<WoTScore> | null = {},
  isSerendipity = true,
): FilteredItem {
  const item = makeItem(itemOverrides);
  const wotScore = wotOverrides === null ? null : makeWoTScore(wotOverrides);
  return {
    item,
    wotScore,
    weightedComposite: item.scores.composite * 0.5,
    isWoTSerendipity: isSerendipity,
    isContentSerendipity: false,
  };
}

function makeResult(items: FilteredItem[]): FilterPipelineResult {
  return {
    items,
    stats: {
      totalInput: items.length,
      wotScoredCount: items.filter(fi => fi.wotScore !== null).length,
      aiScoredCount: 0,
      serendipityCount: items.filter(fi => fi.isWoTSerendipity || fi.isContentSerendipity).length,
      estimatedAPICost: 0,
      mode: "pro",
      customRulesBurned: 0,
    },
  };
}

describe("detectSerendipity", () => {
  it("returns empty for no serendipity items", () => {
    const items = [makeFilteredItem({}, {}, false), makeFilteredItem({}, {}, false)];
    const result = detectSerendipity(makeResult(items));
    expect(result).toEqual([]);
  });

  it("filters correctly for isWoTSerendipity", () => {
    const items = [
      makeFilteredItem({ id: "s1" }, {}, true),
      makeFilteredItem({ id: "n1" }, {}, false),
      makeFilteredItem({ id: "s2" }, {}, true),
    ];
    const result = detectSerendipity(makeResult(items));
    expect(result).toHaveLength(2);
    expect(result.map(r => r.item.id)).toEqual(["s1", "s2"]);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeFilteredItem({ id: `s${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 - i * 0.1 } }, {}, true),
    );
    const result = detectSerendipity(makeResult(items));
    expect(result).toHaveLength(5);
  });

  it("sorts by composite descending", () => {
    const items = [
      makeFilteredItem({ id: "low", scores: { originality: 7, insight: 7, credibility: 7, composite: 7.5 } }, {}, true),
      makeFilteredItem({ id: "high", scores: { originality: 9, insight: 9, credibility: 9, composite: 9.5 } }, {}, true),
      makeFilteredItem({ id: "mid", scores: { originality: 8, insight: 8, credibility: 8, composite: 8.5 } }, {}, true),
    ];
    const result = detectSerendipity(makeResult(items));
    expect(result.map(r => r.item.id)).toEqual(["high", "mid", "low"]);
  });

  it("includes wotScore and qualityComposite", () => {
    const items = [makeFilteredItem({}, { trustScore: 0.15 }, true)];
    const result = detectSerendipity(makeResult(items));
    expect(result[0].wotScore).toBeCloseTo(0.15);
    expect(result[0].qualityComposite).toBe(8);
  });

  it("returns empty for empty pipeline result", () => {
    const result = detectSerendipity(makeResult([]));
    expect(result).toEqual([]);
  });
});

describe("classifyDiscovery", () => {
  it("returns out_of_network when not in graph", () => {
    const fi = makeFilteredItem({}, { isInGraph: false });
    expect(classifyDiscovery(fi)).toBe("out_of_network");
  });

  it("returns out_of_network when hopDistance >= 3", () => {
    const fi = makeFilteredItem({}, { isInGraph: true, hopDistance: 3 });
    expect(classifyDiscovery(fi)).toBe("out_of_network");
  });

  it("returns cross_language for high non-ASCII ratio", () => {
    const fi = makeFilteredItem(
      { text: "\u3053\u308C\u306F\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002\u54C1\u8CEA\u304C\u9AD8\u3044\u3067\u3059\u3002" },
      { isInGraph: true, hopDistance: 1 },
    );
    expect(classifyDiscovery(fi)).toBe("cross_language");
  });

  it("returns emerging_topic as default", () => {
    const fi = makeFilteredItem(
      { text: "This is normal English text about some topic" },
      { isInGraph: true, hopDistance: 2 },
    );
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("handles null wotScore gracefully", () => {
    const fi = makeFilteredItem({ text: "English text" }, null);
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });
});

describe("generateDiscoveryReason", () => {
  it("includes author and composite for out_of_network", () => {
    const fi = makeFilteredItem({ author: "alice" }, { isInGraph: false });
    const reason = generateDiscoveryReason(fi, "out_of_network");
    expect(reason).toContain("alice");
    expect(reason).toContain("8.0");
    expect(reason).toContain("outside your follow network");
  });

  it("includes author and composite for cross_language", () => {
    const fi = makeFilteredItem({ author: "bob" });
    const reason = generateDiscoveryReason(fi, "cross_language");
    expect(reason).toContain("bob");
    expect(reason).toContain("Cross-language");
  });

  it("includes topics for emerging_topic", () => {
    const fi = makeFilteredItem({ topics: ["defi", "governance"] });
    const reason = generateDiscoveryReason(fi, "emerging_topic");
    expect(reason).toContain("defi");
    expect(reason).toContain("governance");
    expect(reason).toContain("Emerging topic");
  });

  it("uses 'general' when no topics", () => {
    const fi = makeFilteredItem({ topics: undefined });
    const reason = generateDiscoveryReason(fi, "out_of_network");
    expect(reason).toContain("general");
  });
});
