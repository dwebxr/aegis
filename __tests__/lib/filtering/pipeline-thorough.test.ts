import { runFilterPipeline, scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";
import type { FilterConfig } from "@/lib/filtering/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "",
    author: "Author",
    avatar: "📡",
    text: "Test article about technology with evidence and analysis.",
    source: "rss",
    scores: { originality: 7, insight: 8, credibility: 7, composite: 7.3 },
    verdict: "quality",
    reason: "Good article",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    ...overrides,
  };
}

function makeGraph(nodes: [string, Partial<WoTNode>][]): WoTGraph {
  const map = new Map<string, WoTNode>();
  for (const [pk, partial] of nodes) {
    map.set(pk, {
      pubkey: pk,
      follows: partial.follows ?? [],
      hopDistance: partial.hopDistance ?? 1,
      mutualFollows: partial.mutualFollows ?? 0,
    });
  }
  return { userPubkey: "user", nodes: map, maxHops: 3, builtAt: Date.now() };
}

const defaultConfig: FilterConfig = {
  qualityThreshold: 5.0,
  wotEnabled: true,
  mode: "pro",
};

describe("runFilterPipeline — basic filtering", () => {
  it("filters items below qualityThreshold", () => {
    const items = [
      makeItem({ id: "low", scores: { originality: 3, insight: 3, credibility: 3, composite: 3.0 } }),
      makeItem({ id: "high", scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } }),
    ];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item.id).toBe("high");
  });

  it("item at exact threshold passes", () => {
    const items = [
      makeItem({ scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 } }),
    ];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.items).toHaveLength(1);
  });

  it("empty input returns empty output with zero stats", () => {
    const result = runFilterPipeline([], null, defaultConfig);
    expect(result.items).toHaveLength(0);
    expect(result.stats.totalInput).toBe(0);
    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.stats.estimatedAPICost).toBe(0);
  });

  it("sorts by weighted composite descending", () => {
    const items = [
      makeItem({ id: "mid", scores: { originality: 6, insight: 6, credibility: 6, composite: 6.0 } }),
      makeItem({ id: "top", scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 } }),
      makeItem({ id: "low", scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 } }),
    ];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.items[0].item.id).toBe("top");
    expect(result.items[1].item.id).toBe("mid");
    expect(result.items[2].item.id).toBe("low");
  });
});

describe("runFilterPipeline — WoT integration", () => {
  it("applies WoT scores when wotEnabled and graph provided", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["author-pk", { hopDistance: 1, mutualFollows: 5 }],
    ]);
    const items = [makeItem({ nostrPubkey: "author-pk" })];
    const result = runFilterPipeline(items, graph, { ...defaultConfig, wotEnabled: true });
    expect(result.stats.wotScoredCount).toBe(1);
    expect(result.items[0].wotScore).not.toBeNull();
    expect(result.items[0].wotScore!.isInGraph).toBe(true);
  });

  it("skips WoT when wotEnabled is false", () => {
    const graph = makeGraph([["user", { hopDistance: 0 }], ["pk", { hopDistance: 1 }]]);
    const items = [makeItem({ nostrPubkey: "pk" })];
    const result = runFilterPipeline(items, graph, { ...defaultConfig, wotEnabled: false });
    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.items[0].wotScore).toBeNull();
  });

  it("skips WoT for items without nostrPubkey", () => {
    const graph = makeGraph([["user", { hopDistance: 0 }]]);
    const items = [makeItem({ nostrPubkey: undefined })];
    const result = runFilterPipeline(items, graph, defaultConfig);
    expect(result.stats.wotScoredCount).toBe(0);
  });

  it("skips WoT when graph is null", () => {
    const items = [makeItem({ nostrPubkey: "some-pk" })];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.stats.wotScoredCount).toBe(0);
  });
});

describe("runFilterPipeline — serendipity detection", () => {
  it("detects serendipity: unknown peer (trust 0) + high quality", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["far-peer", { hopDistance: 3, mutualFollows: 0 }],
    ]);
    // Unknown peer NOT in graph → calculateWoTScore returns {trustScore: 0, isInGraph: false}
    // trust 0 < 0.3 AND composite 8.0 > 7.0 → serendipity = true
    const items = [makeItem({ nostrPubkey: "unknown-peer", scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } })];
    const result = runFilterPipeline(items, graph, defaultConfig);
    expect(result.items[0].isWoTSerendipity).toBe(true);
  });
});

describe("runFilterPipeline — cost estimation", () => {
  it("counts AI-scored items correctly", () => {
    const items = [
      makeItem({ id: "a", scoredByAI: true }),
      makeItem({ id: "b", scoredByAI: false }),
      makeItem({ id: "c", scoredByAI: true }),
    ];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.stats.aiScoredCount).toBe(2);
  });

  it("estimates cost for paid engines only", () => {
    const items = [
      makeItem({ id: "byok", scoringEngine: "claude-byok", scoredByAI: true }),
      makeItem({ id: "server", scoringEngine: "claude-server", scoredByAI: true }),
      makeItem({ id: "ollama", scoringEngine: "ollama", scoredByAI: true }),
      makeItem({ id: "heuristic", scoringEngine: "heuristic", scoredByAI: false }),
    ];
    const result = runFilterPipeline(items, null, defaultConfig);
    // Only claude-byok and claude-server are paid: 2 * 0.003 = 0.006
    expect(result.stats.estimatedAPICost).toBeCloseTo(0.006, 4);
  });

  it("counts claude-ic as paid tier", () => {
    const items = [makeItem({ scoringEngine: "claude-ic", scoredByAI: true })];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 4);
  });

  it("legacy items without scoringEngine: scoredByAI=true counted as paid", () => {
    const items = [makeItem({ scoringEngine: undefined, scoredByAI: true })];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.stats.aiScoredCount).toBe(1);
    expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 4);
  });
});

describe("runFilterPipeline — stats", () => {
  it("reports correct totalInput", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const result = runFilterPipeline(items, null, defaultConfig);
    expect(result.stats.totalInput).toBe(2);
  });

  it("reports mode from config", () => {
    const result = runFilterPipeline([], null, { ...defaultConfig, mode: "lite" });
    expect(result.stats.mode).toBe("lite");
  });
});

describe("scoreItemWithHeuristics — real heuristic path", () => {
  it("scores short text with low signals", () => {
    const result = scoreItemWithHeuristics(
      { text: "Hello", author: "Test" }, "rss",
    );
    expect(result.scoringEngine).toBe("heuristic");
    expect(result.scoredByAI).toBe(false);
    expect(result.scores.composite).toBeGreaterThan(0);
    expect(result.verdict).toMatch(/quality|slop/);
    expect(result.reason).toContain("Heuristic");
  });

  it("scores long analytical text with high signals", () => {
    const text = [
      "According to the latest analysis, the methodology used in this study shows strong evidence.",
      "The benchmark results demonstrate a 25% improvement over the baseline implementation.",
      "Source: https://example.com/paper with detailed dataset descriptions and algorithms.",
      "",
      "The study also examines correlation between the variables using a rigorous framework.",
      "",
      "In conclusion, the hypothesis is supported by the experimental evidence gathered over six months.",
    ].join("\n");
    const result = scoreItemWithHeuristics({ text, author: "Researcher" }, "rss");
    expect(result.scores.composite).toBeGreaterThan(5);
    expect(result.verdict).toBe("quality");
    expect(result.reason).toContain("analytical language");
    expect(result.reason).toContain("attribution present");
    expect(result.reason).toContain("contains links");
  });

  it("sets correct avatar per source type", () => {
    const nostr = scoreItemWithHeuristics({ text: "test", author: "A" }, "nostr");
    const rss = scoreItemWithHeuristics({ text: "test", author: "A" }, "rss");
    expect(nostr.avatar).toBe("\uD83D\uDD2E"); // crystal ball
    expect(rss.avatar).toBe("\uD83D\uDCE1"); // satellite
  });

  it("uses provided avatar over default", () => {
    const result = scoreItemWithHeuristics({ text: "test", author: "A", avatar: "A" }, "rss");
    expect(result.avatar).toBe("A");
  });

  it("truncates text to 300 chars", () => {
    const long = "X".repeat(500);
    const result = scoreItemWithHeuristics({ text: long, author: "A" }, "rss");
    expect(result.text).toHaveLength(300);
  });

  it("preserves metadata fields", () => {
    const result = scoreItemWithHeuristics({
      text: "test", author: "TestAuthor", sourceUrl: "https://example.com",
      imageUrl: "https://img.example.com/1.jpg", nostrPubkey: "pk123",
    }, "nostr");
    expect(result.author).toBe("TestAuthor");
    expect(result.sourceUrl).toBe("https://example.com");
    expect(result.imageUrl).toBe("https://img.example.com/1.jpg");
    expect(result.nostrPubkey).toBe("pk123");
    expect(result.source).toBe("nostr");
  });

  it("generates unique IDs", () => {
    const a = scoreItemWithHeuristics({ text: "a", author: "A" }, "rss");
    const b = scoreItemWithHeuristics({ text: "b", author: "A" }, "rss");
    expect(a.id).not.toBe(b.id);
  });
});
