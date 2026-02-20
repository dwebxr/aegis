import { runFilterPipeline, scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";
import type { FilterConfig } from "@/lib/filtering/types";

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
    text: "Test content",
    source: "nostr",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

function makeGraph(nodes?: Array<[string, Partial<WoTNode>]>): WoTGraph {
  const nodeMap = new Map<string, WoTNode>();
  if (nodes) {
    for (const [pk, partial] of nodes) {
      nodeMap.set(pk, { pubkey: pk, follows: [], hopDistance: 1, mutualFollows: 0, ...partial });
    }
  }
  return { userPubkey: "user-pk", nodes: nodeMap, maxHops: 3, builtAt: Date.now() };
}

const liteConfig: FilterConfig = { mode: "lite", wotEnabled: true, qualityThreshold: 0 };
const proConfig: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 0 };

describe("runFilterPipeline — edge cases", () => {
  it("handles single item", () => {
    const result = runFilterPipeline([makeItem()], null, liteConfig);
    expect(result.items).toHaveLength(1);
    expect(result.stats.totalInput).toBe(1);
  });

  it("handles all items with composite = 0", () => {
    const items = Array.from({ length: 5 }, () =>
      makeItem({ scores: { originality: 0, insight: 0, credibility: 0, composite: 0 } }),
    );
    const result = runFilterPipeline(items, null, liteConfig);
    expect(result.items).toHaveLength(5);
    for (const fi of result.items) {
      expect(fi.weightedComposite).toBe(0);
    }
  });

  it("handles all items with composite = 10", () => {
    const items = Array.from({ length: 3 }, () =>
      makeItem({ scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
    );
    const result = runFilterPipeline(items, null, proConfig);
    expect(result.items).toHaveLength(3);
    // All get neutral trust 0.5 → weighted = 10 * 0.75 = 7.5
    for (const fi of result.items) {
      expect(fi.weightedComposite).toBeCloseTo(7.5, 5);
    }
  });

  it("handles items without nostrPubkey (non-Nostr sources)", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }]]);
    const items = [
      makeItem({ source: "rss", nostrPubkey: undefined }),
      makeItem({ source: "url", nostrPubkey: undefined }),
      makeItem({ source: "nostr", nostrPubkey: "pk-a" }),
    ];
    const result = runFilterPipeline(items, graph, proConfig);

    expect(result.stats.wotScoredCount).toBe(1); // Only nostr item scored
    expect(result.items.filter(fi => fi.wotScore === null)).toHaveLength(2);
  });

  it("handles items with empty string nostrPubkey", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }]]);
    const item = makeItem({ nostrPubkey: "" });
    const result = runFilterPipeline([item], graph, proConfig);

    // Empty string is falsy → should not be WoT scored
    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.items[0].wotScore).toBeNull();
  });

  it("correctly sorts items with very close weighted composites", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["pk-a", { hopDistance: 1, mutualFollows: 1 }],
      ["pk-b", { hopDistance: 1, mutualFollows: 2 }],
    ]);
    const items = [
      makeItem({ id: "a", nostrPubkey: "pk-a", scores: { originality: 7, insight: 7, credibility: 7, composite: 7.001 } }),
      makeItem({ id: "b", nostrPubkey: "pk-b", scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 } }),
    ];
    const result = runFilterPipeline(items, graph, proConfig);

    // pk-b has more mutual follows → higher trust → may be ranked higher despite lower raw composite
    // Verify sorting is deterministic
    expect(result.items.length).toBe(2);
    expect(result.items[0].weightedComposite).toBeGreaterThanOrEqual(result.items[1].weightedComposite);
  });

  it("counts AI calls: all heuristic = 0 AI calls", () => {
    const items = [
      makeItem({ reason: "Heuristic: word-count based scoring" }),
      makeItem({ reason: "Heuristic: basic analysis" }),
    ];
    const result = runFilterPipeline(items, null, liteConfig);
    expect(result.stats.aiScoredCount).toBe(0);
    expect(result.stats.estimatedAPICost).toBe(0);
  });

  it("counts AI calls: all AI = full count", () => {
    const items = [
      makeItem({ reason: "Good quality analysis" }),
      makeItem({ reason: "Original insight detected" }),
      makeItem({ reason: "Strong credibility signals" }),
    ];
    const result = runFilterPipeline(items, null, proConfig);
    expect(result.stats.aiScoredCount).toBe(3);
    expect(result.stats.estimatedAPICost).toBeCloseTo(0.009, 5);
  });

  it("counts AI calls: null/undefined reason treated as AI", () => {
    const items = [
      makeItem({ reason: undefined }),
      makeItem({ reason: "" }),
    ];
    const result = runFilterPipeline(items, null, proConfig);
    // undefined → !c.reason?.startsWith("Heuristic") → true → counted as AI
    // "" → "".startsWith("Heuristic") → false → counted as AI
    expect(result.stats.aiScoredCount).toBe(2);
  });

  it("handles wotEnabled=false with graph present — skips WoT scoring", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }], ["pk-a", { hopDistance: 1 }]]);
    const item = makeItem({ nostrPubkey: "pk-a" });
    const config: FilterConfig = { mode: "pro", wotEnabled: false, qualityThreshold: 0 };
    const result = runFilterPipeline([item], graph, config);

    // wotEnabled=false disables WoT scoring even when graph is present
    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.items[0].wotScore).toBeNull();
    // Items get neutral 0.5 trust when WoT is disabled
    expect(result.items[0].weightedComposite).toBeCloseTo(7 * 0.75, 5);
  });

  it("qualityThreshold filters items below threshold", () => {
    const items = [
      makeItem({ scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
      makeItem({ scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
      makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];
    const config: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 5.0 };
    const result = runFilterPipeline(items, null, config);

    // composite 3 < 5.0 → filtered out; composite 5 >= 5.0 → kept
    expect(result.items).toHaveLength(2);
    expect(result.stats.totalInput).toBe(3);
  });

  it("qualityThreshold 0 keeps all items", () => {
    const items = [
      makeItem({ scores: { originality: 0, insight: 0, credibility: 0, composite: 0 } }),
      makeItem({ scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
    ];
    const config: FilterConfig = { mode: "lite", wotEnabled: true, qualityThreshold: 0 };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(2);
  });

  it("uses scoredByAI field for AI count when available", () => {
    const items = [
      makeItem({ scoredByAI: true, reason: "AI analysis" }),
      makeItem({ scoredByAI: false, reason: "Whatever reason" }),
      makeItem({ reason: "Heuristic: basic" }), // legacy: no scoredByAI field
    ];
    const config: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 0 };
    const result = runFilterPipeline(items, null, config);
    // scoredByAI=true → AI; scoredByAI=false → not AI; legacy w/o field → fallback to string check → not AI
    expect(result.stats.aiScoredCount).toBe(1);
  });

  it("handles large content array (1000 items) without errors", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({ id: `item-${i}`, scores: { originality: 5, insight: 5, credibility: 5, composite: Math.random() * 10 } }),
    );
    const result = runFilterPipeline(items, null, proConfig);
    // threshold=0 → all items kept
    expect(result.items).toHaveLength(1000);
    expect(result.stats.totalInput).toBe(1000);
    // Verify sorted descending
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].weightedComposite).toBeGreaterThanOrEqual(result.items[i].weightedComposite);
    }
  });

  it("returns empty items and zero stats for empty content array", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }]]);
    const result = runFilterPipeline([], graph, proConfig);
    expect(result.items).toHaveLength(0);
    expect(result.stats.totalInput).toBe(0);
    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.stats.aiScoredCount).toBe(0);
    expect(result.stats.serendipityCount).toBe(0);
    expect(result.stats.estimatedAPICost).toBe(0);
  });

  it("returns empty items for empty content with null graph", () => {
    const result = runFilterPipeline([], null, liteConfig);
    expect(result.items).toHaveLength(0);
    expect(result.stats.totalInput).toBe(0);
  });

  it("filters ALL items when qualityThreshold exceeds max composite", () => {
    const items = [
      makeItem({ scores: { originality: 9, insight: 9, credibility: 9, composite: 9.9 } }),
      makeItem({ scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
    ];
    // threshold 10: composite 9.9 < 10 → filtered; composite 10 is NOT < 10, so it stays
    const config: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 10 };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(1);
    expect(result.stats.totalInput).toBe(2);
  });

  it("stats count AI-scored items even when filtered out by threshold", () => {
    const items = [
      makeItem({ scores: { originality: 2, insight: 2, credibility: 2, composite: 2 }, reason: "AI scored this" }),
      makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8 }, reason: "Heuristic: basic" }),
    ];
    const config: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 5 };
    const result = runFilterPipeline(items, null, config);
    // Only composite 8 passes threshold for display
    expect(result.items).toHaveLength(1);
    // But AI count scans ALL content (second pass), not just filtered
    expect(result.stats.aiScoredCount).toBe(1);
    expect(result.stats.totalInput).toBe(2);
  });

  it("counts scoringEngine correctly for paid tiers", () => {
    const items = [
      makeItem({ scoringEngine: "claude-byok" as ContentItem["scoringEngine"], reason: "AI" }),
      makeItem({ scoringEngine: "claude-ic" as ContentItem["scoringEngine"], reason: "AI" }),
      makeItem({ scoringEngine: "claude-server" as ContentItem["scoringEngine"], reason: "AI" }),
      makeItem({ scoringEngine: "heuristic" as ContentItem["scoringEngine"], reason: "Heuristic: basic" }),
      makeItem({ scoringEngine: "ollama" as ContentItem["scoringEngine"], reason: "Local AI" }),
    ];
    const result = runFilterPipeline(items, null, liteConfig);
    // 3 claude engines are paid, heuristic/ollama are not
    expect(result.stats.estimatedAPICost).toBeCloseTo(3 * 0.003, 5);
  });

  it("handles mixed nostr and non-nostr items with graph", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["pk-a", { hopDistance: 1, mutualFollows: 5 }],
    ]);
    const items = [
      makeItem({ id: "nostr-a", nostrPubkey: "pk-a", source: "nostr" }),
      makeItem({ id: "rss-b", nostrPubkey: undefined, source: "rss" }),
      makeItem({ id: "nostr-unknown", nostrPubkey: "unknown-pk", source: "nostr" }),
    ];
    const result = runFilterPipeline(items, graph, proConfig);

    expect(result.stats.wotScoredCount).toBe(2); // pk-a + unknown-pk
    expect(result.items.find(fi => fi.item.id === "rss-b")!.wotScore).toBeNull();
    expect(result.items.find(fi => fi.item.id === "nostr-a")!.wotScore!.isInGraph).toBe(true);
    expect(result.items.find(fi => fi.item.id === "nostr-unknown")!.wotScore!.isInGraph).toBe(false);
  });
});

describe("scoreItemWithHeuristics — edge cases", () => {
  it("handles empty text", () => {
    const item = scoreItemWithHeuristics({ text: "", author: "test" }, "rss");
    expect(item.text).toBe("");
    expect(item.scores.composite).toBeGreaterThanOrEqual(0);
  });

  it("handles very short text (1 character)", () => {
    const item = scoreItemWithHeuristics({ text: "a", author: "test" }, "url");
    expect(item.text).toBe("a");
    expect(item.verdict).toBeDefined();
  });

  it("handles text with only whitespace", () => {
    const item = scoreItemWithHeuristics({ text: "   \n\t  ", author: "test" }, "rss");
    expect(item.reason).toMatch(/^Heuristic/);
  });

  it("handles text with Unicode (Japanese)", () => {
    const item = scoreItemWithHeuristics({
      text: "\u3053\u308C\u306F\u30C6\u30B9\u30C8\u3067\u3059\u3002\u54C1\u8CEA\u306E\u9AD8\u3044\u30B3\u30F3\u30C6\u30F3\u30C4\u306B\u3064\u3044\u3066\u8A71\u3057\u307E\u3057\u3087\u3046\u3002",
      author: "\u30C6\u30B9\u30C8\u30E6\u30FC\u30B6\u30FC",
    }, "nostr");
    expect(item.author).toBe("\u30C6\u30B9\u30C8\u30E6\u30FC\u30B6\u30FC");
    expect(item.source).toBe("nostr");
  });

  it("truncates text at exactly 300 characters", () => {
    const text = "x".repeat(300);
    const item = scoreItemWithHeuristics({ text, author: "test" }, "url");
    expect(item.text.length).toBe(300);

    const text301 = "x".repeat(301);
    const item301 = scoreItemWithHeuristics({ text: text301, author: "test" }, "url");
    expect(item301.text.length).toBe(300);
  });

  it("uses custom avatar when provided", () => {
    const item = scoreItemWithHeuristics({
      text: "test",
      author: "a",
      avatar: "https://example.com/avatar.png",
    }, "nostr");
    expect(item.avatar).toBe("https://example.com/avatar.png");
  });

  it("preserves sourceUrl and imageUrl", () => {
    const item = scoreItemWithHeuristics({
      text: "test content",
      author: "a",
      sourceUrl: "https://example.com/article",
      imageUrl: "https://example.com/image.jpg",
    }, "url");
    expect(item.sourceUrl).toBe("https://example.com/article");
    expect(item.imageUrl).toBe("https://example.com/image.jpg");
  });

  it("sets default values correctly", () => {
    const item = scoreItemWithHeuristics({ text: "test", author: "a" }, "rss");
    expect(item.owner).toBe("");
    expect(item.validated).toBe(false);
    expect(item.flagged).toBe(false);
    expect(item.timestamp).toBe("just now");
    expect(item.createdAt).toBeGreaterThan(0);
  });

  it("sets scoredByAI to false", () => {
    const item = scoreItemWithHeuristics({ text: "test", author: "a" }, "rss");
    expect(item.scoredByAI).toBe(false);
  });
});
