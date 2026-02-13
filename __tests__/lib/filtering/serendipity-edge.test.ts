import {
  detectSerendipity,
  classifyDiscovery,
  generateDiscoveryReason,
} from "@/lib/filtering/serendipity";
import type { FilteredItem, FilterPipelineResult } from "@/lib/filtering/types";
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
  };
}

function makeResult(items: FilteredItem[]): FilterPipelineResult {
  return {
    items,
    stats: {
      totalInput: items.length,
      wotScoredCount: items.filter(fi => fi.wotScore !== null).length,
      aiScoredCount: 0,
      serendipityCount: items.filter(fi => fi.isWoTSerendipity).length,
      estimatedAPICost: 0,
      mode: "pro",
    },
  };
}

describe("classifyDiscovery — edge cases", () => {
  it("returns out_of_network when hopDistance is exactly 3", () => {
    const fi = makeFilteredItem({}, { isInGraph: true, hopDistance: 3 });
    expect(classifyDiscovery(fi)).toBe("out_of_network");
  });

  it("returns emerging_topic when hopDistance is 2 (just below threshold)", () => {
    const fi = makeFilteredItem(
      { text: "English text about technology" },
      { isInGraph: true, hopDistance: 2 },
    );
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("handles combined: not in graph AND hopDistance >= 3", () => {
    const fi = makeFilteredItem({}, { isInGraph: false, hopDistance: 5 });
    expect(classifyDiscovery(fi)).toBe("out_of_network");
  });

  it("returns cross_language for exactly 30.1% non-ASCII", () => {
    // 31 non-ASCII out of 100 chars = 31%
    const ascii = "a".repeat(69);
    const nonAscii = "\u3042".repeat(31);
    const fi = makeFilteredItem(
      { text: ascii + nonAscii },
      { isInGraph: true, hopDistance: 1 },
    );
    expect(classifyDiscovery(fi)).toBe("cross_language");
  });

  it("returns emerging_topic for exactly 30% non-ASCII (boundary)", () => {
    // 30 non-ASCII out of 100 chars = exactly 30%, which is NOT > 0.3
    const ascii = "a".repeat(70);
    const nonAscii = "\u3042".repeat(30);
    const fi = makeFilteredItem(
      { text: ascii + nonAscii },
      { isInGraph: true, hopDistance: 1 },
    );
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("handles empty text without division by zero", () => {
    const fi = makeFilteredItem(
      { text: "" },
      { isInGraph: true, hopDistance: 1 },
    );
    // Math.max(text.length, 1) prevents division by zero
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("handles text of exactly 1 character (ASCII)", () => {
    const fi = makeFilteredItem(
      { text: "a" },
      { isInGraph: true, hopDistance: 1 },
    );
    expect(classifyDiscovery(fi)).toBe("emerging_topic");
  });

  it("handles text of exactly 1 character (non-ASCII)", () => {
    const fi = makeFilteredItem(
      { text: "\u4E16" },
      { isInGraph: true, hopDistance: 1 },
    );
    // 1 non-ASCII out of 1 char = 100% > 30%
    expect(classifyDiscovery(fi)).toBe("cross_language");
  });

  it("prioritizes out_of_network over cross_language when both apply", () => {
    const fi = makeFilteredItem(
      { text: "\u3053\u308C\u306F\u65E5\u672C\u8A9E\u3067\u3059" },
      { isInGraph: false, hopDistance: Infinity },
    );
    expect(classifyDiscovery(fi)).toBe("out_of_network");
  });

  it("handles emoji-heavy text (emoji are non-ASCII)", () => {
    // All emojis → ratio > 0.3 → cross_language
    const fi = makeFilteredItem(
      { text: "\uD83D\uDE00\uD83D\uDE01\uD83D\uDE02\uD83D\uDE03" },
      { isInGraph: true, hopDistance: 1 },
    );
    expect(classifyDiscovery(fi)).toBe("cross_language");
  });
});

describe("generateDiscoveryReason — edge cases", () => {
  it("handles zero composite score", () => {
    const fi = makeFilteredItem({
      scores: { originality: 0, insight: 0, credibility: 0, composite: 0 },
      author: "alice",
    });
    const reason = generateDiscoveryReason(fi, "out_of_network");
    expect(reason).toContain("0.0/10");
  });

  it("handles composite score of exactly 10", () => {
    const fi = makeFilteredItem({
      scores: { originality: 10, insight: 10, credibility: 10, composite: 10 },
    });
    const reason = generateDiscoveryReason(fi, "emerging_topic");
    expect(reason).toContain("10.0/10");
  });

  it("handles empty author string", () => {
    const fi = makeFilteredItem({ author: "" });
    const reason = generateDiscoveryReason(fi, "cross_language");
    expect(reason).toContain("Cross-language signal from ");
  });

  it("handles single topic", () => {
    const fi = makeFilteredItem({ topics: ["bitcoin"] });
    const reason = generateDiscoveryReason(fi, "emerging_topic");
    expect(reason).toContain("bitcoin");
    expect(reason).not.toContain(",");
  });

  it("truncates topics to max 2", () => {
    const fi = makeFilteredItem({ topics: ["ai", "crypto", "web3", "defi"] });
    const reason = generateDiscoveryReason(fi, "emerging_topic");
    expect(reason).toContain("ai");
    expect(reason).toContain("crypto");
    expect(reason).not.toContain("web3");
    expect(reason).not.toContain("defi");
  });

  it("uses 'general' when topics is empty array", () => {
    const fi = makeFilteredItem({ topics: [] });
    const reason = generateDiscoveryReason(fi, "out_of_network");
    expect(reason).toContain("general");
  });

  it("handles decimal composite (e.g. 7.777)", () => {
    const fi = makeFilteredItem({
      scores: { originality: 8, insight: 8, credibility: 8, composite: 7.777 },
    });
    const reason = generateDiscoveryReason(fi, "out_of_network");
    expect(reason).toContain("7.8/10");
  });
});

describe("detectSerendipity — edge cases", () => {
  it("handles all items being serendipity (returns max 5)", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeFilteredItem(
        { id: `s${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } },
        {},
        true,
      ),
    );
    const result = detectSerendipity(makeResult(items));
    expect(result).toHaveLength(5);
  });

  it("handles items with identical composite scores (stable sort)", () => {
    const items = [
      makeFilteredItem({ id: "a", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }, {}, true),
      makeFilteredItem({ id: "b", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }, {}, true),
      makeFilteredItem({ id: "c", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }, {}, true),
    ];
    const result = detectSerendipity(makeResult(items));
    expect(result).toHaveLength(3);
    // All have same composite, so all should be present
    expect(result.map(r => r.qualityComposite)).toEqual([8, 8, 8]);
  });

  it("handles exactly 5 serendipity items (returns all 5)", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeFilteredItem({ id: `s${i}` }, {}, true),
    );
    const result = detectSerendipity(makeResult(items));
    expect(result).toHaveLength(5);
  });

  it("correctly populates wotScore from FilteredItem", () => {
    const items = [makeFilteredItem({}, { trustScore: 0.25 }, true)];
    const result = detectSerendipity(makeResult(items));
    expect(result[0].wotScore).toBe(0.25);
  });

  it("uses 0 for wotScore when wotScore is null", () => {
    const items = [makeFilteredItem({}, null, true)];
    const result = detectSerendipity(makeResult(items));
    expect(result[0].wotScore).toBe(0);
  });

  it("preserves item reference identity", () => {
    const originalItem = makeItem({ id: "preserve-test" });
    const fi: FilteredItem = {
      item: originalItem,
      wotScore: makeWoTScore(),
      weightedComposite: 4,
      isWoTSerendipity: true,
    };
    const result = detectSerendipity(makeResult([fi]));
    expect(result[0].item).toBe(originalItem);
  });

  it("correctly classifies and generates reason for each item", () => {
    const items = [
      makeFilteredItem(
        { text: "English text here" },
        { isInGraph: false },
        true,
      ),
    ];
    const result = detectSerendipity(makeResult(items));
    expect(result[0].discoveryType).toBe("out_of_network");
    expect(result[0].reason).toContain("outside your follow network");
  });
});
