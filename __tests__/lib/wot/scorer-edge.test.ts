import {
  calculateWoTScore,
  calculateWoTScores,
  calculateWeightedScore,
  isWoTSerendipity,
} from "@/lib/wot/scorer";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";

function makeGraph(nodes?: Array<[string, Partial<WoTNode>]>): WoTGraph {
  const nodeMap = new Map<string, WoTNode>();
  if (nodes) {
    for (const [pk, partial] of nodes) {
      nodeMap.set(pk, { pubkey: pk, follows: [], hopDistance: 1, mutualFollows: 0, ...partial });
    }
  }
  return { userPubkey: "user-pk", nodes: nodeMap, maxHops: 3, builtAt: Date.now() };
}

describe("calculateWoTScore — edge cases", () => {
  it("handles empty graph (no nodes)", () => {
    const graph = makeGraph();
    const score = calculateWoTScore("any-pk", graph);
    expect(score.trustScore).toBe(0);
    expect(score.isInGraph).toBe(false);
    expect(score.hopDistance).toBe(Infinity);
  });

  it("handles graph with only user node", () => {
    const graph = makeGraph([["user-pk", { hopDistance: 0, mutualFollows: 0 }]]);
    const score = calculateWoTScore("user-pk", graph);
    expect(score.trustScore).toBe(1.0);
    expect(score.hopDistance).toBe(0);
  });

  it("handles very large hop distance", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["distant", { hopDistance: 100, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("distant", graph);
    // (1/100)*0.6 + 0 + 0.1 = 0.006 + 0.1 = 0.106
    expect(score.trustScore).toBeCloseTo(0.106, 3);
    expect(score.isInGraph).toBe(true);
  });

  it("handles node where all mutual follows are from one node", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["only-node", { hopDistance: 1, mutualFollows: 100 }],
    ]);
    const score = calculateWoTScore("only-node", graph);
    // maxMutual = 100, mutual/maxMutual = 1.0
    // (1/1)*0.6 + (100/100)*0.3 + 0.1 ≈ 1.0 (float precision)
    // Math.min(1, ...) caps at 1.0
    expect(score.trustScore).toBeCloseTo(1.0, 10);
  });

  it("handles node with 0 mutual follows when maxMutual > 0", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["popular", { hopDistance: 1, mutualFollows: 50 }],
      ["isolated", { hopDistance: 2, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("isolated", graph);
    // (1/2)*0.6 + (0/50)*0.3 + 0.1 = 0.3 + 0 + 0.1 = 0.4
    expect(score.trustScore).toBeCloseTo(0.4, 5);
  });

  it("handles duplicate pubkey lookup", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["pk-a", { hopDistance: 1, mutualFollows: 5 }],
    ]);
    const score1 = calculateWoTScore("pk-a", graph);
    const score2 = calculateWoTScore("pk-a", graph);
    expect(score1.trustScore).toBe(score2.trustScore);
  });

  it("handles pubkey that looks like user pubkey but isn't", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["user-pk-2", { hopDistance: 2, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("user-pk-2", graph);
    expect(score.hopDistance).toBe(2);
    expect(score.isInGraph).toBe(true);
  });
});

describe("calculateWoTScores — edge cases", () => {
  it("handles duplicates in input array", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["pk-a", { hopDistance: 1 }],
    ]);
    const scores = calculateWoTScores(["pk-a", "pk-a", "pk-a"], graph);
    // Map deduplicates, so last write wins (all same value)
    expect(scores.size).toBe(1);
    expect(scores.get("pk-a")!.isInGraph).toBe(true);
  });

  it("handles mix of known and unknown pubkeys", () => {
    const graph = makeGraph([
      ["user-pk", { hopDistance: 0 }],
      ["known", { hopDistance: 1 }],
    ]);
    const scores = calculateWoTScores(["known", "unknown1", "unknown2"], graph);
    expect(scores.get("known")!.isInGraph).toBe(true);
    expect(scores.get("unknown1")!.isInGraph).toBe(false);
    expect(scores.get("unknown2")!.isInGraph).toBe(false);
  });

  it("handles large batch (1000 pubkeys)", () => {
    const nodes: Array<[string, Partial<WoTNode>]> = [["user-pk", { hopDistance: 0 }]];
    for (let i = 0; i < 1000; i++) {
      nodes.push([`pk-${i}`, { hopDistance: 2, mutualFollows: i % 10 }]);
    }
    const graph = makeGraph(nodes);
    const pubkeys = Array.from({ length: 1000 }, (_, i) => `pk-${i}`);
    const scores = calculateWoTScores(pubkeys, graph);
    expect(scores.size).toBe(1000);
    Array.from(scores.values()).forEach(score => {
      expect(score.trustScore).toBeGreaterThan(0);
      expect(score.isInGraph).toBe(true);
    });
  });
});

describe("calculateWeightedScore — edge cases", () => {
  it("handles negative raw composite", () => {
    const result = calculateWeightedScore(-5, 1.0);
    expect(result).toBeCloseTo(-5, 5);
  });

  it("handles negative trust score", () => {
    const result = calculateWeightedScore(8.0, -0.5);
    // 8.0 * (0.5 + (-0.5) * 0.5) = 8.0 * 0.25 = 2.0
    expect(result).toBeCloseTo(2.0, 5);
  });

  it("handles trust score > 1.0", () => {
    const result = calculateWeightedScore(8.0, 2.0);
    // 8.0 * (0.5 + 2.0 * 0.5) = 8.0 * 1.5 = 12.0
    expect(result).toBeCloseTo(12.0, 5);
  });

  it("handles both values as zero", () => {
    expect(calculateWeightedScore(0, 0)).toBe(0);
  });

  it("handles very small positive values", () => {
    const result = calculateWeightedScore(0.001, 0.001);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.001);
  });

  it("is deterministic (same inputs → same output)", () => {
    const a = calculateWeightedScore(7.5, 0.8);
    const b = calculateWeightedScore(7.5, 0.8);
    expect(a).toBe(b);
  });
});

describe("isWoTSerendipity — edge cases", () => {
  it("handles zero trust and zero quality", () => {
    expect(isWoTSerendipity(0, 0)).toBe(false);
  });

  it("handles negative values", () => {
    expect(isWoTSerendipity(-1, 8)).toBe(true); // -1 < 0.3 && 8 > 7.0
    expect(isWoTSerendipity(0.1, -1)).toBe(false); // -1 not > 7.0
  });

  it("handles NaN values", () => {
    expect(isWoTSerendipity(NaN, 8)).toBe(false); // NaN < 0.3 is false
    expect(isWoTSerendipity(0.1, NaN)).toBe(false); // NaN > 7.0 is false
  });

  it("handles Infinity", () => {
    expect(isWoTSerendipity(Infinity, 8)).toBe(false); // Infinity not < 0.3
    expect(isWoTSerendipity(0.1, Infinity)).toBe(true); // Infinity > 7.0
  });

  it("is consistent across boundary values", () => {
    // Just below thresholds
    expect(isWoTSerendipity(0.299, 7.001)).toBe(true);
    // Just above thresholds
    expect(isWoTSerendipity(0.301, 7.001)).toBe(false);
    expect(isWoTSerendipity(0.299, 6.999)).toBe(false);
  });

  it("returns false at exact boundary values (strict inequality)", () => {
    // trustScore < 0.3 (strict) && qualityComposite > 7.0 (strict)
    expect(isWoTSerendipity(0.3, 8.0)).toBe(false);  // 0.3 is NOT < 0.3
    expect(isWoTSerendipity(0.1, 7.0)).toBe(false);  // 7.0 is NOT > 7.0
    expect(isWoTSerendipity(0.3, 7.0)).toBe(false);  // both at boundary
  });
});
