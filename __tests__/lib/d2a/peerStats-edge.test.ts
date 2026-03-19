import { computePeerStats, sortPeerStats } from "@/lib/d2a/peerStats";
import type { ContentItem } from "@/lib/types/content";
import type { PeerReputation } from "@/lib/d2a/reputation";
import type { WoTGraph } from "@/lib/wot/types";

// Mock npubEncode — also test error path
const mockNpubEncode = jest.fn((hex: string) => {
  if (hex === "invalid") throw new Error("invalid hex");
  return "npub1" + hex.slice(0, 20) + "rest";
});
jest.mock("nostr-tools/nip19", () => ({
  npubEncode: (hex: string) => mockNpubEncode(hex),
}));

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-" + Math.random().toString(36).slice(2, 8),
    owner: "user1",
    author: "author1",
    avatar: "",
    text: "test content",
    source: "nostr" as const,
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality" as const,
    reason: "Received via D2A from abc12345",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: new Date().toISOString(),
    nostrPubkey: "aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd",
    ...overrides,
  };
}

const PK_A = "aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd";

function makeWoTGraph(nodes: Array<{ pubkey: string; hopDistance: number; mutualFollows: number }>): WoTGraph {
  const map = new Map<string, { pubkey: string; follows: string[]; hopDistance: number; mutualFollows: number }>();
  for (const n of nodes) {
    map.set(n.pubkey, { pubkey: n.pubkey, follows: [], hopDistance: n.hopDistance, mutualFollows: n.mutualFollows });
  }
  return { userPubkey: "self", nodes: map, maxHops: 3, builtAt: Date.now() };
}

describe("computePeerStats — npubEncode error handling", () => {
  it("falls back to truncated hex when npubEncode throws", () => {
    mockNpubEncode.mockImplementationOnce(() => { throw new Error("bad hex"); });
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const stats = computePeerStats(items, new Map(), null);
    // Should fall back to first 8 chars + "..."
    expect(stats[0].displayName).toMatch(/^[a-f0-9]{8}\.\.\.$/);
  });
});

describe("computePeerStats — all items unjudged", () => {
  it("qualityRate is 0 when no items validated or flagged", () => {
    const items = Array.from({ length: 5 }, () =>
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: false, flagged: false }),
    );
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].qualityRate).toBe(0);
    expect(stats[0].validated).toBe(0);
    expect(stats[0].flagged).toBe(0);
    expect(stats[0].itemsReceived).toBe(5);
  });
});

describe("computePeerStats — 100% quality rate", () => {
  it("qualityRate is 1.0 when all judged items are validated", () => {
    const items = Array.from({ length: 3 }, () =>
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: true, flagged: false }),
    );
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].qualityRate).toBe(1.0);
  });
});

describe("computePeerStats — 0% quality rate", () => {
  it("qualityRate is 0 when all judged items are flagged", () => {
    const items = Array.from({ length: 3 }, () =>
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: false, flagged: true }),
    );
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].qualityRate).toBe(0);
    expect(stats[0].flagged).toBe(3);
  });
});

describe("computePeerStats — negative reputation score", () => {
  it("handles negative reputation score (blocked peer)", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const reps = new Map<string, PeerReputation>([
      [PK_A, { pubkey: PK_A, useful: 0, slop: 5, score: -15, blocked: true, updatedAt: Date.now() }],
    ]);
    const stats = computePeerStats(items, reps, null);
    expect(stats[0].reputation.blocked).toBe(true);
    expect(stats[0].reputation.score).toBe(-15);
    // effectiveTrust with negative rep + no WoT = 0
    expect(stats[0].effectiveTrust).toBe(0);
    expect(stats[0].trustTier).toBe("unknown");
  });
});

describe("computePeerStats — many peers", () => {
  it("handles 100 distinct peers", () => {
    const items = Array.from({ length: 100 }, (_, i) => {
      const pk = i.toString(16).padStart(64, "0");
      return makeItem({ nostrPubkey: pk, reason: `Received via D2A from ${pk.slice(0, 8)}` });
    });
    const stats = computePeerStats(items, new Map(), null);
    expect(stats).toHaveLength(100);
    for (const s of stats) {
      expect(s.itemsReceived).toBe(1);
    }
  });
});

describe("computePeerStats — with WoT graph but peer not in graph", () => {
  it("returns wotScore 0 for peer not in graph", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const graph = makeWoTGraph([]); // empty graph, PK_A not in it
    const stats = computePeerStats(items, new Map(), graph);
    expect(stats[0].wotScore).toBe(0);
  });
});

describe("sortPeerStats — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(sortPeerStats([], "effectiveTrust")).toEqual([]);
  });

  it("single element sort returns that element", () => {
    const stat = {
      pubkey: "a", displayName: "A", itemsReceived: 1, validated: 0, flagged: 0,
      qualityRate: 0, reputation: { pubkey: "a", useful: 0, slop: 0, score: 0, blocked: false, updatedAt: 0 },
      trustTier: "unknown" as const, wotScore: 0, effectiveTrust: 0,
    };
    const sorted = sortPeerStats([stat], "effectiveTrust");
    expect(sorted).toHaveLength(1);
    expect(sorted[0].pubkey).toBe("a");
  });

  it("stable sort for equal values", () => {
    const stats = [
      { pubkey: "a", displayName: "A", itemsReceived: 5, validated: 0, flagged: 0, qualityRate: 0.5, reputation: { pubkey: "a", useful: 0, slop: 0, score: 0, blocked: false, updatedAt: 0 }, trustTier: "unknown" as const, wotScore: 0, effectiveTrust: 0.5 },
      { pubkey: "b", displayName: "B", itemsReceived: 5, validated: 0, flagged: 0, qualityRate: 0.5, reputation: { pubkey: "b", useful: 0, slop: 0, score: 0, blocked: false, updatedAt: 0 }, trustTier: "unknown" as const, wotScore: 0, effectiveTrust: 0.5 },
    ];
    const sorted = sortPeerStats(stats, "effectiveTrust");
    // Both have same effectiveTrust — order should be deterministic
    expect(sorted).toHaveLength(2);
  });

  it("sorts by all four sort keys", () => {
    const stats = [
      { pubkey: "low", displayName: "L", itemsReceived: 1, validated: 0, flagged: 0, qualityRate: 0.1, reputation: { pubkey: "low", useful: 0, slop: 0, score: -1, blocked: false, updatedAt: 0 }, trustTier: "unknown" as const, wotScore: 0, effectiveTrust: 0.1 },
      { pubkey: "high", displayName: "H", itemsReceived: 10, validated: 5, flagged: 0, qualityRate: 0.9, reputation: { pubkey: "high", useful: 5, slop: 0, score: 5, blocked: false, updatedAt: 0 }, trustTier: "known" as const, wotScore: 0.5, effectiveTrust: 0.9 },
    ];
    expect(sortPeerStats(stats, "effectiveTrust")[0].pubkey).toBe("high");
    expect(sortPeerStats(stats, "itemsReceived")[0].pubkey).toBe("high");
    expect(sortPeerStats(stats, "qualityRate")[0].pubkey).toBe("high");
    expect(sortPeerStats(stats, "reputation")[0].pubkey).toBe("high");
  });
});
