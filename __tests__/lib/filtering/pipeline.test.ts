import { runFilterPipeline, scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";
import type { FilterConfig } from "@/lib/filtering/types";

// Mock uuid
jest.mock("uuid", () => ({ v4: () => "test-uuid" }));

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
      nodeMap.set(pk, {
        pubkey: pk,
        follows: [],
        hopDistance: 1,
        mutualFollows: 0,
        ...partial,
      });
    }
  }
  return { userPubkey: "user-pk", nodes: nodeMap, maxHops: 3, builtAt: Date.now() };
}

const liteConfig: FilterConfig = { mode: "lite", wotEnabled: true, qualityThreshold: 0 };
const proConfig: FilterConfig = { mode: "pro", wotEnabled: true, qualityThreshold: 0 };

describe("runFilterPipeline", () => {
  it("returns empty result for empty content", () => {
    const result = runFilterPipeline([], null, liteConfig);
    expect(result.items).toEqual([]);
    expect(result.stats.totalInput).toBe(0);
    expect(result.stats.wotScoredCount).toBe(0);
  });

  it("applies WoT scoring to nostr items with pubkey", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["pk-a", { hopDistance: 1, mutualFollows: 3 }],
    ]);
    const item = makeItem({ nostrPubkey: "pk-a" });
    const result = runFilterPipeline([item], graph, proConfig);

    expect(result.stats.wotScoredCount).toBe(1);
    expect(result.items[0].wotScore).not.toBeNull();
    expect(result.items[0].wotScore!.isInGraph).toBe(true);
  });

  it("assigns neutral 0.5 trust for non-nostr items", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }]]);
    const rssItem = makeItem({ source: "rss", nostrPubkey: undefined });
    const result = runFilterPipeline([rssItem], graph, proConfig);

    expect(result.items[0].wotScore).toBeNull();
    // weightedComposite = 7 * (0.5 + 0.5 * 0.5) = 7 * 0.75 = 5.25
    expect(result.items[0].weightedComposite).toBeCloseTo(5.25, 2);
  });

  it("sorts by weighted composite descending", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["trusted", { hopDistance: 1, mutualFollows: 5 }],
      ["untrusted", { hopDistance: 3, mutualFollows: 0 }],
    ]);
    const items = [
      makeItem({ nostrPubkey: "untrusted", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ nostrPubkey: "trusted", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    const result = runFilterPipeline(items, graph, proConfig);

    // Trusted item (hop 1, high mutual) should get higher weighted composite even with lower raw score
    expect(result.items[0].item.nostrPubkey).toBe("trusted");
  });

  it("detects serendipity items", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["stranger", { hopDistance: 3, mutualFollows: 0 }],
    ]);
    // stranger at hop 3: trust ≈ 0.3, so serendipity needs quality > 7.0
    // hop 3 trust = (1/3)*0.6 + 0 + 0.1 = 0.3 → exactly 0.3, not < 0.3
    // Need even more distant or craft a node that yields < 0.3
    // Let's use unknown pubkey (trust = 0, isInGraph = false)
    const item = makeItem({
      nostrPubkey: "unknown-pk",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
    });
    const result = runFilterPipeline([item], graph, proConfig);

    // unknown pubkey: WoT scored with trust 0, but isWoTSerendipity checks trust < 0.3 && quality > 7.0
    // wotScore is { trustScore: 0, isInGraph: false }, so serendipity = true
    expect(result.stats.serendipityCount).toBe(1);
    expect(result.items[0].isWoTSerendipity).toBe(true);
  });

  it("works with null wotGraph", () => {
    const items = [makeItem(), makeItem()];
    const result = runFilterPipeline(items, null, liteConfig);

    expect(result.stats.wotScoredCount).toBe(0);
    expect(result.items.length).toBe(2);
    // All items get neutral 0.5 trust
    for (const fi of result.items) {
      expect(fi.wotScore).toBeNull();
    }
  });

  it("counts AI calls correctly (lite vs pro)", () => {
    const items = [
      makeItem({ reason: "Heuristic: word-count based scoring" }),
      makeItem({ reason: "Heuristic: basic analysis" }),
      makeItem({ reason: "Good insight and original analysis" }),
    ];
    const result = runFilterPipeline(items, null, liteConfig);

    expect(result.stats.aiScoredCount).toBe(1);
    expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 5);
  });

  it("reports correct mode in stats", () => {
    const result = runFilterPipeline([], null, liteConfig);
    expect(result.stats.mode).toBe("lite");

    const result2 = runFilterPipeline([], null, proConfig);
    expect(result2.stats.mode).toBe("pro");
  });

  describe("scoringEngine cost attribution", () => {
    it("counts ollama as AI-scored but NOT paid", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "ollama" as ContentItem["scoringEngine"], reason: "Ollama scored" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(1);
      expect(result.stats.estimatedAPICost).toBe(0);
    });

    it("counts webllm as AI-scored but NOT paid", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "webllm" as ContentItem["scoringEngine"], reason: "WebLLM scored" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(1);
      expect(result.stats.estimatedAPICost).toBe(0);
    });

    it("counts heuristic engine as NOT AI-scored", () => {
      const items = [
        makeItem({ scoredByAI: false, scoringEngine: "heuristic" as ContentItem["scoringEngine"], reason: "Heuristic: short" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(0);
      expect(result.stats.estimatedAPICost).toBe(0);
    });

    it("counts claude-byok as paid", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "claude-byok" as ContentItem["scoringEngine"], reason: "Claude BYOK" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(1);
      expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 5);
    });

    it("counts claude-server as paid", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "claude-server" as ContentItem["scoringEngine"], reason: "Server" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 5);
    });

    it("counts claude-ic as paid", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "claude-ic" as ContentItem["scoringEngine"], reason: "IC scored" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 5);
    });

    it("accumulates cost for multiple paid items", () => {
      const items = [
        makeItem({ scoredByAI: true, scoringEngine: "claude-byok" as ContentItem["scoringEngine"], reason: "BYOK" }),
        makeItem({ scoredByAI: true, scoringEngine: "claude-server" as ContentItem["scoringEngine"], reason: "Server" }),
        makeItem({ scoredByAI: true, scoringEngine: "ollama" as ContentItem["scoringEngine"], reason: "Free" }),
      ];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(3);
      expect(result.stats.estimatedAPICost).toBeCloseTo(0.006, 5); // 2 paid * 0.003
    });
  });

  describe("legacy AI detection", () => {
    it("scoredByAI=null with non-Heuristic reason → AI-scored (legacy)", () => {
      const items = [makeItem({ scoredByAI: undefined, scoringEngine: undefined, reason: "Claude analysis" })];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(1);
      expect(result.stats.estimatedAPICost).toBeCloseTo(0.003, 5);
    });

    it("scoredByAI=null with reason=null → AI-scored (legacy)", () => {
      const items = [makeItem({ scoredByAI: undefined, scoringEngine: undefined, reason: undefined as unknown as string })];
      const result = runFilterPipeline(items, null, liteConfig);
      // reason?.startsWith("Heuristic") → undefined → !undefined → true → legacyAI
      expect(result.stats.aiScoredCount).toBe(1);
    });

    it("scoredByAI=true always counts as AI-scored regardless of reason", () => {
      const items = [makeItem({ scoredByAI: true, scoringEngine: undefined, reason: "Heuristic: blah" })];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(1);
    });

    it("scoredByAI=false with Heuristic reason → NOT AI-scored", () => {
      const items = [makeItem({ scoredByAI: false, reason: "Heuristic (AI unavailable): short" })];
      const result = runFilterPipeline(items, null, liteConfig);
      expect(result.stats.aiScoredCount).toBe(0);
      expect(result.stats.estimatedAPICost).toBe(0);
    });
  });

  describe("qualityThreshold filtering", () => {
    it("filters items below threshold", () => {
      const items = [
        makeItem({ scores: { originality: 2, insight: 2, credibility: 2, composite: 2 } }),
        makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      ];
      const config: FilterConfig = { mode: "pro", wotEnabled: false, qualityThreshold: 5 };
      const result = runFilterPipeline(items, null, config);
      expect(result.items.length).toBe(1);
      expect(result.items[0].item.scores.composite).toBe(8);
    });

    it("includes items at exactly the threshold", () => {
      const items = [
        makeItem({ scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
      ];
      const config: FilterConfig = { mode: "pro", wotEnabled: false, qualityThreshold: 5 };
      const result = runFilterPipeline(items, null, config);
      expect(result.items.length).toBe(1);
    });

    it("excludes items just below threshold", () => {
      const items = [
        makeItem({ scores: { originality: 5, insight: 5, credibility: 5, composite: 4.9 } }),
      ];
      const config: FilterConfig = { mode: "pro", wotEnabled: false, qualityThreshold: 5 };
      const result = runFilterPipeline(items, null, config);
      expect(result.items.length).toBe(0);
    });
  });
});

describe("scoreItemWithHeuristics", () => {
  it("creates a ContentItem with heuristic scores", () => {
    const raw = {
      text: "This is a meaningful piece of content with enough words to avoid the short-text penalty in heuristic scoring. The analysis provides insight into an important topic.",
      author: "test-author",
      sourceUrl: "https://example.com",
    };
    const item = scoreItemWithHeuristics(raw, "rss");

    expect(item.id).toBe("test-uuid");
    expect(item.author).toBe("test-author");
    expect(item.source).toBe("rss");
    expect(item.sourceUrl).toBe("https://example.com");
    expect(item.scores.composite).toBeGreaterThanOrEqual(0);
    expect(item.scores.composite).toBeLessThanOrEqual(10);
    expect(item.reason).toMatch(/^Heuristic/);
    expect(item.validated).toBe(false);
    expect(item.flagged).toBe(false);
  });

  it("preserves nostrPubkey", () => {
    const raw = {
      text: "Some nostr note content",
      author: "nostr-user",
      nostrPubkey: "npub123",
    };
    const item = scoreItemWithHeuristics(raw, "nostr");
    expect(item.nostrPubkey).toBe("npub123");
  });

  it("uses correct avatar per source type", () => {
    const raw = { text: "test", author: "a" };
    const nostrItem = scoreItemWithHeuristics(raw, "nostr");
    const rssItem = scoreItemWithHeuristics(raw, "rss");
    expect(nostrItem.avatar).toBe("\uD83D\uDD2E");
    expect(rssItem.avatar).toBe("\uD83D\uDCE1");
  });

  it("truncates text to 300 characters", () => {
    const raw = { text: "x".repeat(500), author: "a" };
    const item = scoreItemWithHeuristics(raw, "url");
    expect(item.text.length).toBeLessThanOrEqual(300);
  });
});
