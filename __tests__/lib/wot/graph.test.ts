import { buildFollowGraph, calculateMutualFollows } from "@/lib/wot/graph";
import type { WoTConfig, WoTNode } from "@/lib/wot/types";

// Mock nostr-tools/pool
const mockQuerySync = jest.fn();
const mockDestroy = jest.fn();
jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: mockQuerySync,
    destroy: mockDestroy,
  })),
}));

function makeKind3(pubkey: string, follows: string[], created_at = 1000) {
  return {
    pubkey,
    kind: 3,
    created_at,
    tags: follows.map(f => ["p", f]),
    id: `event-${pubkey}`,
    content: "",
    sig: "",
  };
}

const testConfig: WoTConfig = {
  maxHops: 3,
  maxNodes: 10_000,
  timeoutPerHopMs: 5000,
  cacheTTLMs: 3600000,
  relays: ["wss://test-relay"],
};

describe("buildFollowGraph", () => {
  beforeEach(() => {
    mockQuerySync.mockReset();
    mockDestroy.mockReset();
  });

  it("builds a simple 2-hop graph", async () => {
    // Hop 1: user follows A and B
    mockQuerySync.mockResolvedValueOnce([
      makeKind3("user-pk", ["a", "b"]),
    ]);
    // Hop 2: A follows C, B follows D
    mockQuerySync.mockResolvedValueOnce([
      makeKind3("a", ["c"]),
      makeKind3("b", ["d"]),
    ]);
    // Hop 3: C and D (no follow lists returned)
    mockQuerySync.mockResolvedValueOnce([]);

    const graph = await buildFollowGraph("user-pk", { ...testConfig, maxHops: 3 });

    expect(graph.userPubkey).toBe("user-pk");
    expect(graph.nodes.has("user-pk")).toBe(true);
    expect(graph.nodes.get("user-pk")!.hopDistance).toBe(0);
    expect(graph.nodes.get("user-pk")!.follows).toEqual(["a", "b"]);
    expect(graph.nodes.get("a")!.hopDistance).toBe(1);
    expect(graph.nodes.get("b")!.hopDistance).toBe(1);
    expect(graph.nodes.get("c")!.hopDistance).toBe(2);
    expect(graph.nodes.get("d")!.hopDistance).toBe(2);
  });

  it("deduplicates Kind:3 events by author (keeps latest)", async () => {
    mockQuerySync.mockResolvedValueOnce([
      makeKind3("user-pk", ["old-follow"], 100),
      makeKind3("user-pk", ["new-follow"], 200),
    ]);
    mockQuerySync.mockResolvedValueOnce([]);

    const graph = await buildFollowGraph("user-pk", { ...testConfig, maxHops: 1 });
    expect(graph.nodes.get("user-pk")!.follows).toEqual(["new-follow"]);
    expect(graph.nodes.has("new-follow")).toBe(true);
    expect(graph.nodes.has("old-follow")).toBe(false);
  });

  it("enforces maxNodes cap", async () => {
    const manyFollows = Array.from({ length: 20 }, (_, i) => `pk-${i}`);
    mockQuerySync.mockResolvedValueOnce([makeKind3("user-pk", manyFollows)]);
    // Each hop-1 node follows 20 more
    mockQuerySync.mockResolvedValue(
      manyFollows.map(pk => makeKind3(pk, Array.from({ length: 20 }, (_, i) => `${pk}-f${i}`))),
    );

    const graph = await buildFollowGraph("user-pk", { ...testConfig, maxNodes: 15 });
    expect(graph.nodes.size).toBeLessThanOrEqual(15);
  });

  it("handles timeout gracefully (continues with partial data)", async () => {
    mockQuerySync.mockResolvedValueOnce([makeKind3("user-pk", ["a"])]);
    mockQuerySync.mockRejectedValueOnce(new Error("hop-timeout"));

    const graph = await buildFollowGraph("user-pk", { ...testConfig, maxHops: 2 });
    expect(graph.nodes.has("user-pk")).toBe(true);
    expect(graph.nodes.has("a")).toBe(true);
  });

  it("calls pool.destroy() even on error", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("relay-error"));
    await buildFollowGraph("user-pk", { ...testConfig, maxHops: 1 });
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("calls onProgress callback", async () => {
    mockQuerySync.mockResolvedValueOnce([makeKind3("user-pk", ["a"])]);
    mockQuerySync.mockResolvedValueOnce([]);

    const progress = jest.fn();
    await buildFollowGraph("user-pk", { ...testConfig, maxHops: 2 }, progress);
    expect(progress).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it("handles empty follow list", async () => {
    mockQuerySync.mockResolvedValueOnce([makeKind3("user-pk", [])]);

    const graph = await buildFollowGraph("user-pk", { ...testConfig, maxHops: 2 });
    expect(graph.nodes.size).toBe(1);
    expect(graph.nodes.get("user-pk")!.follows).toEqual([]);
  });
});

describe("calculateMutualFollows", () => {
  it("counts mutual follows correctly", () => {
    const nodes = new Map<string, WoTNode>();
    nodes.set("user", { pubkey: "user", follows: ["a", "b"], hopDistance: 0, mutualFollows: 0 });
    nodes.set("a", { pubkey: "a", follows: ["c"], hopDistance: 1, mutualFollows: 0 });
    nodes.set("b", { pubkey: "b", follows: ["c"], hopDistance: 1, mutualFollows: 0 });
    nodes.set("c", { pubkey: "c", follows: [], hopDistance: 2, mutualFollows: 0 });

    calculateMutualFollows(nodes, "user");

    // c is followed by a and b, both are direct follows of user → 2 mutual follows
    expect(nodes.get("c")!.mutualFollows).toBe(2);
    // a is followed by nobody else in the graph
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });

  it("handles empty graph", () => {
    const nodes = new Map<string, WoTNode>();
    // Should not throw on empty input
    calculateMutualFollows(nodes, "user");
    // Map remains empty after processing
    expect(nodes.size).toBe(0);
  });
});
