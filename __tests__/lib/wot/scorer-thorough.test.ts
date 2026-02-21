/**
 * Thorough tests for WoT scorer — trust formula boundary conditions,
 * division safety, weighted score math, serendipity detection.
 */
import {
  calculateWoTScore,
  calculateWeightedScore,
  isWoTSerendipity,
} from "@/lib/wot/scorer";
import type { WoTGraph, WoTNode } from "@/lib/wot/types";

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

describe("calculateWoTScore — trust formula", () => {
  it("user (hop 0) gets trust 1.0", () => {
    const graph = makeGraph([["user", { hopDistance: 0 }]]);
    const score = calculateWoTScore("user", graph);
    expect(score.trustScore).toBe(1.0);
    expect(score.hopDistance).toBe(0);
    expect(score.isInGraph).toBe(true);
  });

  it("hop 1 with 0 mutual follows: trust = 0.6/1 + 0 + 0.1 = 0.7", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer", { hopDistance: 1, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("peer", graph);
    expect(score.trustScore).toBeCloseTo(0.7, 2);
  });

  it("hop 2 with 0 mutual: trust = 0.6/2 + 0 + 0.1 = 0.4", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer", { hopDistance: 2, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("peer", graph);
    expect(score.trustScore).toBeCloseTo(0.4, 2);
  });

  it("hop 3 with 0 mutual: trust = 0.6/3 + 0 + 0.1 = 0.3", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer", { hopDistance: 3, mutualFollows: 0 }],
    ]);
    const score = calculateWoTScore("peer", graph);
    expect(score.trustScore).toBeCloseTo(0.3, 2);
  });

  it("hop 1 with max mutual follows: trust approaches 1.0", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer", { hopDistance: 1, mutualFollows: 10 }],
    ]);
    const score = calculateWoTScore("peer", graph);
    // 0.6/1 + (10/10)*0.3 + 0.1 = 0.6 + 0.3 + 0.1 = 1.0
    expect(score.trustScore).toBeCloseTo(1.0, 2);
  });

  it("mutual follows component scales relative to max in graph", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer-a", { hopDistance: 1, mutualFollows: 5 }],
      ["peer-b", { hopDistance: 1, mutualFollows: 10 }], // max
    ]);
    const scoreA = calculateWoTScore("peer-a", graph);
    const scoreB = calculateWoTScore("peer-b", graph);
    // peer-a: 0.6 + (5/10)*0.3 + 0.1 = 0.85
    // peer-b: 0.6 + (10/10)*0.3 + 0.1 = 1.0
    expect(scoreA.trustScore).toBeCloseTo(0.85, 2);
    expect(scoreB.trustScore).toBeCloseTo(1.0, 2);
  });

  it("trust is capped at 1.0 even with extreme values", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0 }],
      ["peer", { hopDistance: 1, mutualFollows: 1000 }],
    ]);
    const score = calculateWoTScore("peer", graph);
    expect(score.trustScore).toBeLessThanOrEqual(1.0);
  });

  it("unknown pubkey (not in graph) gets trust 0", () => {
    const graph = makeGraph([["user", { hopDistance: 0 }]]);
    const score = calculateWoTScore("unknown", graph);
    expect(score.trustScore).toBe(0);
    expect(score.hopDistance).toBe(Infinity);
    expect(score.isInGraph).toBe(false);
  });

  it("all nodes with 0 mutual follows: mutual component is 0 for all", () => {
    const graph = makeGraph([
      ["user", { hopDistance: 0, mutualFollows: 0 }],
      ["peer-a", { hopDistance: 1, mutualFollows: 0 }],
      ["peer-b", { hopDistance: 2, mutualFollows: 0 }],
    ]);
    const scoreA = calculateWoTScore("peer-a", graph);
    const scoreB = calculateWoTScore("peer-b", graph);
    expect(scoreA.trustScore).toBeCloseTo(0.7, 2); // 0.6/1 + 0 + 0.1
    expect(scoreB.trustScore).toBeCloseTo(0.4, 2); // 0.6/2 + 0 + 0.1
  });
});

describe("calculateWeightedScore", () => {
  it("trust 0 → 50% of raw score", () => {
    expect(calculateWeightedScore(10, 0)).toBeCloseTo(5.0, 2);
  });

  it("trust 1 → 100% of raw score", () => {
    expect(calculateWeightedScore(10, 1)).toBeCloseTo(10.0, 2);
  });

  it("trust 0.5 → 75% of raw score", () => {
    // 10 * (0.5 + 0.5 * 0.5) = 10 * 0.75 = 7.5
    expect(calculateWeightedScore(10, 0.5)).toBeCloseTo(7.5, 2);
  });

  it("raw score 0 always gives 0", () => {
    expect(calculateWeightedScore(0, 1.0)).toBe(0);
    expect(calculateWeightedScore(0, 0)).toBe(0);
  });

  it("negative raw score (edge) scales correctly", () => {
    // Shouldn't happen in practice, but verify no crash
    expect(calculateWeightedScore(-5, 0.5)).toBeCloseTo(-3.75, 2);
  });
});

describe("isWoTSerendipity — boundary conditions", () => {
  it("low trust (0.29) + high quality (7.1) → true", () => {
    expect(isWoTSerendipity(0.29, 7.1)).toBe(true);
  });

  it("trust exactly 0.3 → false (threshold is <)", () => {
    expect(isWoTSerendipity(0.3, 8.0)).toBe(false);
  });

  it("trust 0.31 → false", () => {
    expect(isWoTSerendipity(0.31, 8.0)).toBe(false);
  });

  it("quality exactly 7.0 → false (threshold is >)", () => {
    expect(isWoTSerendipity(0.1, 7.0)).toBe(false);
  });

  it("quality 7.01 → true (if trust < 0.3)", () => {
    expect(isWoTSerendipity(0.1, 7.01)).toBe(true);
  });

  it("both conditions at boundary → false", () => {
    expect(isWoTSerendipity(0.3, 7.0)).toBe(false);
  });

  it("trust 0 + quality 10 → true (strongest serendipity)", () => {
    expect(isWoTSerendipity(0, 10)).toBe(true);
  });

  it("trust 0 + quality 1 → false (too low quality)", () => {
    expect(isWoTSerendipity(0, 1)).toBe(false);
  });
});
