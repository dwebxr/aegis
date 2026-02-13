import {
  calculateWoTScore,
  calculateWoTScores,
  calculateWeightedScore,
  isWoTSerendipity,
} from "@/lib/wot/scorer";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";

function makeGraph(overrides: Partial<WoTGraph> = {}, nodes?: Array<[string, Partial<WoTNode>]>): WoTGraph {
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
  return {
    userPubkey: "user-pk",
    nodes: nodeMap,
    maxHops: 3,
    builtAt: Date.now(),
    ...overrides,
  };
}

describe("calculateWoTScore", () => {
  it("returns zero trust for unknown pubkey", () => {
    const graph = makeGraph();
    const score = calculateWoTScore("unknown", graph);
    expect(score.trustScore).toBe(0);
    expect(score.hopDistance).toBe(Infinity);
    expect(score.isInGraph).toBe(false);
  });

  it("returns trust 1.0 for hop 0 (self)", () => {
    const graph = makeGraph({}, [["user-pk", { hopDistance: 0 }]]);
    const score = calculateWoTScore("user-pk", graph);
    expect(score.trustScore).toBe(1.0);
    expect(score.hopDistance).toBe(0);
    expect(score.isInGraph).toBe(true);
  });

  it("calculates correct trust for hop 1 with no mutual follows", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["friend", { hopDistance: 1, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("friend", graph);
    // hop=1: (1/1)*0.6 + 0 + 0.1 = 0.7
    expect(score.trustScore).toBeCloseTo(0.7, 5);
    expect(score.isInGraph).toBe(true);
  });

  it("calculates correct trust for hop 2", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["hop2", { hopDistance: 2, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("hop2", graph);
    // (1/2)*0.6 + 0 + 0.1 = 0.4
    expect(score.trustScore).toBeCloseTo(0.4, 5);
  });

  it("calculates correct trust for hop 3", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["hop3", { hopDistance: 3, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("hop3", graph);
    // (1/3)*0.6 + 0 + 0.1 = 0.3
    expect(score.trustScore).toBeCloseTo(0.3, 5);
  });

  it("includes mutual follows component", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["a", { hopDistance: 1, mutualFollows: 5 }],
      ["b", { hopDistance: 1, mutualFollows: 10 }],
    ]);
    const scoreA = calculateWoTScore("a", graph);
    const scoreB = calculateWoTScore("b", graph);
    // a: (1/1)*0.6 + (5/10)*0.3 + 0.1 = 0.85
    expect(scoreA.trustScore).toBeCloseTo(0.85, 5);
    // b: (1/1)*0.6 + (10/10)*0.3 + 0.1 = 1.0
    expect(scoreB.trustScore).toBeCloseTo(1.0, 5);
    expect(scoreB.trustScore).toBeGreaterThan(scoreA.trustScore);
  });

  it("caps trust at 1.0", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["high", { hopDistance: 1, mutualFollows: 100 }],
    ]);
    const score = calculateWoTScore("high", graph);
    expect(score.trustScore).toBeLessThanOrEqual(1.0);
  });
});

describe("calculateWoTScores (batch)", () => {
  it("returns scores for multiple pubkeys", () => {
    const graph = makeGraph({}, [
      ["user-pk", { hopDistance: 0 }],
      ["a", { hopDistance: 1 }],
      ["b", { hopDistance: 2 }],
    ]);
    const scores = calculateWoTScores(["a", "b", "unknown"], graph);
    expect(scores.size).toBe(3);
    expect(scores.get("a")!.isInGraph).toBe(true);
    expect(scores.get("b")!.isInGraph).toBe(true);
    expect(scores.get("unknown")!.isInGraph).toBe(false);
  });

  it("returns empty map for empty input", () => {
    const graph = makeGraph();
    const scores = calculateWoTScores([], graph);
    expect(scores.size).toBe(0);
  });
});

describe("calculateWeightedScore", () => {
  it("applies 50% floor for zero trust", () => {
    // raw * (0.5 + 0 * 0.5) = raw * 0.5
    expect(calculateWeightedScore(8.0, 0)).toBeCloseTo(4.0, 5);
  });

  it("applies full score for trust 1.0", () => {
    // raw * (0.5 + 1.0 * 0.5) = raw * 1.0
    expect(calculateWeightedScore(8.0, 1.0)).toBeCloseTo(8.0, 5);
  });

  it("applies 75% for trust 0.5", () => {
    // raw * (0.5 + 0.5 * 0.5) = raw * 0.75
    expect(calculateWeightedScore(8.0, 0.5)).toBeCloseTo(6.0, 5);
  });

  it("handles zero raw score", () => {
    expect(calculateWeightedScore(0, 1.0)).toBe(0);
  });
});

describe("isWoTSerendipity", () => {
  it("returns true for low trust + high quality", () => {
    expect(isWoTSerendipity(0.1, 8.0)).toBe(true);
  });

  it("returns false for high trust + high quality", () => {
    expect(isWoTSerendipity(0.5, 8.0)).toBe(false);
  });

  it("returns false for low trust + low quality", () => {
    expect(isWoTSerendipity(0.1, 5.0)).toBe(false);
  });

  it("returns false at exact boundary (trust=0.3)", () => {
    expect(isWoTSerendipity(0.3, 8.0)).toBe(false);
  });

  it("returns false at exact boundary (quality=7.0)", () => {
    expect(isWoTSerendipity(0.1, 7.0)).toBe(false);
  });

  it("returns true just inside boundary", () => {
    expect(isWoTSerendipity(0.29, 7.01)).toBe(true);
  });
});
