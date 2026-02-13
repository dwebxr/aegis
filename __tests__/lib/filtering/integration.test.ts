/**
 * Integration test: FilterPipeline → SerendipityDetection → CostTracking
 * Tests the full data flow without mocks.
 */
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { detectSerendipity, classifyDiscovery } from "@/lib/filtering/serendipity";
import { recordFilterRun, getDailyCost, getMonthlyCost } from "@/lib/filtering/costTracker";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
    text: "Test content for integration",
    source: "nostr",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    nostrPubkey: "pk-test",
    ...overrides,
  };
}

function makeGraph(nodes: Array<[string, Partial<WoTNode>]>): WoTGraph {
  const nodeMap = new Map<string, WoTNode>();
  for (const [pk, partial] of nodes) {
    nodeMap.set(pk, { pubkey: pk, follows: [], hopDistance: 1, mutualFollows: 0, ...partial });
  }
  return { userPubkey: "user-pk", nodes: nodeMap, maxHops: 3, builtAt: Date.now() };
}

describe("Filter Pipeline → Serendipity → Cost Tracking integration", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: jest.fn((key: string) => store[key] ?? null),
      setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: jest.fn((key: string) => { delete store[key]; }),
      clear: jest.fn(() => { store = {}; }),
      get length() { return Object.keys(store).length; },
      key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
    };
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("full flow: pipeline → serendipity detection → cost recording → monthly summary", () => {
    // 1. Setup graph with user + 1 trusted node + 1 unknown node
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0, mutualFollows: 0 }],
      ["trusted-pk", { hopDistance: 1, mutualFollows: 5 }],
    ]);

    // 2. Create content: 3 trusted, 2 unknown (potential serendipity)
    const content: ContentItem[] = [
      makeItem({ id: "t1", nostrPubkey: "trusted-pk", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "t2", nostrPubkey: "trusted-pk", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
      makeItem({ id: "t3", nostrPubkey: "trusted-pk", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
      makeItem({ id: "s1", nostrPubkey: "unknown-pk1", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "s2", nostrPubkey: "unknown-pk2", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];

    // 3. Run pipeline
    const result = runFilterPipeline(content, graph, {
      mode: "pro",
      wotEnabled: true,
      qualityThreshold: 0,
    });

    expect(result.items).toHaveLength(5);
    expect(result.stats.totalInput).toBe(5);
    expect(result.stats.wotScoredCount).toBe(5); // All have nostrPubkey

    // 4. Detect serendipity
    const discoveries = detectSerendipity(result);

    // unknown-pk1 and unknown-pk2 should be serendipity (trust=0, quality>7)
    expect(discoveries.length).toBeGreaterThanOrEqual(2);
    for (const d of discoveries) {
      expect(d.wotScore).toBeLessThan(0.3);
      expect(d.qualityComposite).toBeGreaterThan(7.0);
      expect(d.discoveryType).toBeDefined();
      expect(d.reason.length).toBeGreaterThan(0);
    }

    // Verify discoveries are sorted by composite desc
    for (let i = 1; i < discoveries.length; i++) {
      expect(discoveries[i - 1].qualityComposite).toBeGreaterThanOrEqual(discoveries[i].qualityComposite);
    }

    // 5. Record cost
    recordFilterRun({
      articlesEvaluated: result.stats.totalInput,
      wotScoredCount: result.stats.wotScoredCount,
      aiScoredCount: result.stats.aiScoredCount,
      discoveriesFound: discoveries.length,
      aiCostUSD: result.stats.estimatedAPICost,
    });

    // 6. Verify daily cost
    const today = new Date().toISOString().slice(0, 10);
    const daily = getDailyCost(today);
    expect(daily).not.toBeNull();
    expect(daily!.articlesEvaluated).toBe(5);
    expect(daily!.discoveriesFound).toBe(discoveries.length);

    // 7. Verify monthly summary
    const month = new Date().toISOString().slice(0, 7);
    const monthly = getMonthlyCost(month);
    expect(monthly.totalEvaluated).toBe(5);
    expect(monthly.totalDays).toBe(1);
    expect(monthly.timeSavedMinutes).toBeGreaterThanOrEqual(0);
  });

  it("serendipity classification integrates with pipeline WoT scoring", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0, mutualFollows: 0 }],
    ]);

    const content: ContentItem[] = [
      makeItem({
        id: "out-of-network",
        nostrPubkey: "unknown-pk",
        text: "English content about technology",
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }),
      makeItem({
        id: "cross-lang",
        nostrPubkey: "jp-pk",
        text: "\u3053\u308C\u306F\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002\u54C1\u8CEA\u304C\u9AD8\u3044\u30B3\u30F3\u30C6\u30F3\u30C4\u3067\u3059\u3002",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
      }),
    ];

    const result = runFilterPipeline(content, graph, {
      mode: "pro",
      wotEnabled: true,
      qualityThreshold: 0,
    });

    const discoveries = detectSerendipity(result);
    expect(discoveries).toHaveLength(2);

    // Both are unknown to the graph → out_of_network takes priority
    // But let's verify the actual classification
    const outOfNetwork = discoveries.find(d => d.item.id === "out-of-network");
    const crossLang = discoveries.find(d => d.item.id === "cross-lang");

    expect(outOfNetwork).toBeDefined();
    expect(outOfNetwork!.discoveryType).toBe("out_of_network");

    expect(crossLang).toBeDefined();
    // cross-lang item: wotScore is not in graph → out_of_network (takes priority over cross_language)
    expect(crossLang!.discoveryType).toBe("out_of_network");
  });

  it("classifyDiscovery uses actual pipeline FilteredItem shape", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["jp-user", { hopDistance: 1, mutualFollows: 2 }],
    ]);

    // jp-user is in-graph at hop 1 → not out_of_network
    // Text is Japanese → should be cross_language
    const content: ContentItem[] = [
      makeItem({
        nostrPubkey: "jp-user",
        text: "\u6280\u8853\u306E\u9032\u6B69\u306B\u3064\u3044\u3066\u306E\u8A73\u7D30\u306A\u5206\u6790\u3002\u3053\u306E\u30EC\u30DD\u30FC\u30C8\u306F\u91CD\u8981\u306A\u6D1E\u5BDF\u3092\u63D0\u4F9B\u3057\u307E\u3059\u3002",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
      }),
    ];

    const result = runFilterPipeline(content, graph, {
      mode: "pro",
      wotEnabled: true,
      qualityThreshold: 0,
    });

    // jp-user at hop 1 with mutualFollows → trust > 0.3 → NOT serendipity
    // isWoTSerendipity requires trust < 0.3
    const jpItem = result.items[0];
    expect(jpItem.wotScore!.trustScore).toBeGreaterThan(0.3);
    expect(jpItem.isWoTSerendipity).toBe(false);

    // But if we manually call classifyDiscovery, it should work
    const type = classifyDiscovery(jpItem);
    // In-graph at hop 1 → not out_of_network
    // Japanese text → cross_language
    expect(type).toBe("cross_language");
  });

  it("cost tracking accumulates across multiple pipeline runs", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0 }]]);

    for (let cycle = 0; cycle < 5; cycle++) {
      const content: ContentItem[] = Array.from({ length: 10 }, (_, i) =>
        makeItem({ id: `c${cycle}-${i}` }),
      );

      const result = runFilterPipeline(content, graph, {
        mode: "pro",
        wotEnabled: true,
        qualityThreshold: 0,
      });

      recordFilterRun({
        articlesEvaluated: result.stats.totalInput,
        wotScoredCount: result.stats.wotScoredCount,
        aiScoredCount: result.stats.aiScoredCount,
        discoveriesFound: 0,
        aiCostUSD: result.stats.estimatedAPICost,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const daily = getDailyCost(today);
    expect(daily!.articlesEvaluated).toBe(50); // 5 cycles * 10 items

    const month = new Date().toISOString().slice(0, 7);
    const monthly = getMonthlyCost(month);
    expect(monthly.totalEvaluated).toBe(50);
    expect(monthly.totalDays).toBe(1);
  });

  it("handles empty content through full pipeline", () => {
    const result = runFilterPipeline([], null, { mode: "lite", wotEnabled: false, qualityThreshold: 0 });
    const discoveries = detectSerendipity(result);

    expect(result.items).toHaveLength(0);
    expect(discoveries).toHaveLength(0);

    recordFilterRun({
      articlesEvaluated: 0,
      wotScoredCount: 0,
      aiScoredCount: 0,
      discoveriesFound: 0,
      aiCostUSD: 0,
    });

    const today = new Date().toISOString().slice(0, 10);
    const daily = getDailyCost(today);
    expect(daily!.articlesEvaluated).toBe(0);
  });
});
