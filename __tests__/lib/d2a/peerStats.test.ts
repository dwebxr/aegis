import { computePeerStats, sortPeerStats } from "@/lib/d2a/peerStats";
import type { ContentItem } from "@/lib/types/content";
import type { PeerReputation } from "@/lib/d2a/reputation";
import type { WoTGraph } from "@/lib/wot/types";

// Mock npubEncode
jest.mock("nostr-tools/nip19", () => ({
  npubEncode: (hex: string) => "npub1" + hex.slice(0, 20) + "rest",
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

function makeWoTGraph(nodes: Array<{ pubkey: string; hopDistance: number; mutualFollows: number }>): WoTGraph {
  const map = new Map<string, { pubkey: string; follows: string[]; hopDistance: number; mutualFollows: number }>();
  for (const n of nodes) {
    map.set(n.pubkey, { pubkey: n.pubkey, follows: [], hopDistance: n.hopDistance, mutualFollows: n.mutualFollows });
  }
  return { userPubkey: "self", nodes: map, maxHops: 3, builtAt: Date.now() };
}

const PK_A = "aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd";
const PK_B = "1122334455667788990011223344556677889900112233445566778899001122";

describe("computePeerStats", () => {
  it("groups D2A content by nostrPubkey", () => {
    const items = [
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabbccdd" }),
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabbccdd" }),
      makeItem({ nostrPubkey: PK_B, reason: "Received via D2A from 11223344" }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats).toHaveLength(2);
    const a = stats.find(s => s.pubkey === PK_A)!;
    const b = stats.find(s => s.pubkey === PK_B)!;
    expect(a.itemsReceived).toBe(2);
    expect(b.itemsReceived).toBe(1);
  });

  it("excludes non-D2A content", () => {
    const items = [
      makeItem({ reason: "Received via D2A from aabbccdd", nostrPubkey: PK_A }),
      makeItem({ reason: "RSS feed", nostrPubkey: PK_B }),
      makeItem({ reason: "Manual entry" }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats).toHaveLength(1);
    expect(stats[0].pubkey).toBe(PK_A);
  });

  it("counts validated and flagged items", () => {
    const items = [
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: true, flagged: false }),
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: true, flagged: false }),
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: false, flagged: true }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].validated).toBe(2);
    expect(stats[0].flagged).toBe(1);
  });

  it("calculates qualityRate correctly", () => {
    const items = [
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: true }),
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: false, flagged: true }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].qualityRate).toBe(0.5); // 1 validated / (1 validated + 1 flagged)
  });

  it("returns qualityRate 0 when no items judged", () => {
    const items = [
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb", validated: false, flagged: false }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].qualityRate).toBe(0);
  });

  it("uses reputation data when available", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const reps = new Map<string, PeerReputation>([
      [PK_A, { pubkey: PK_A, useful: 10, slop: 1, score: 7, blocked: false, updatedAt: Date.now() }],
    ]);
    const stats = computePeerStats(items, reps, null);
    expect(stats[0].reputation.useful).toBe(10);
    expect(stats[0].reputation.score).toBe(7);
  });

  it("uses default reputation when peer not in map", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].reputation.useful).toBe(0);
    expect(stats[0].reputation.slop).toBe(0);
  });

  it("integrates WoT score when graph available", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const graph = makeWoTGraph([{ pubkey: PK_A, hopDistance: 1, mutualFollows: 5 }]);
    const stats = computePeerStats(items, new Map(), graph);
    expect(stats[0].wotScore).toBeGreaterThan(0);
    expect(stats[0].trustTier).toBeDefined();
  });

  it("returns wotScore 0 when graph is null", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].wotScore).toBe(0);
  });

  it("handles items with nostrPubkey undefined as 'unknown'", () => {
    const items = [
      makeItem({ nostrPubkey: undefined, reason: "Received via D2A from deadbeef" }),
    ];
    const stats = computePeerStats(items, new Map(), null);
    expect(stats[0].pubkey).toBe("unknown");
    expect(stats[0].displayName).toBe("Unknown Peer");
  });

  it("returns empty array for empty content", () => {
    const stats = computePeerStats([], new Map(), null);
    expect(stats).toEqual([]);
  });

  it("calculates effectiveTrust combining WoT and rep", () => {
    const items = [makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" })];
    const reps = new Map<string, PeerReputation>([
      [PK_A, { pubkey: PK_A, useful: 10, slop: 0, score: 10, blocked: false, updatedAt: Date.now() }],
    ]);
    const graph = makeWoTGraph([{ pubkey: PK_A, hopDistance: 1, mutualFollows: 3 }]);
    const stats = computePeerStats(items, reps, graph);
    // effectiveTrust = wotScore * 0.6 + normalizeRepScore(10) * 0.4
    // wotScore > 0, normalizeRepScore(10) = 1.0
    expect(stats[0].effectiveTrust).toBeGreaterThan(0.4);
  });

  it("assigns correct trust tier based on effectiveTrust", () => {
    const items = [
      makeItem({ nostrPubkey: PK_A, reason: "Received via D2A from aabb" }),
      makeItem({ nostrPubkey: PK_B, reason: "Received via D2A from 1122" }),
    ];
    const reps = new Map<string, PeerReputation>([
      [PK_A, { pubkey: PK_A, useful: 20, slop: 0, score: 20, blocked: false, updatedAt: Date.now() }],
      [PK_B, { pubkey: PK_B, useful: 0, slop: 0, score: 0, blocked: false, updatedAt: Date.now() }],
    ]);
    const graph = makeWoTGraph([
      { pubkey: PK_A, hopDistance: 1, mutualFollows: 5 },
    ]);
    const stats = computePeerStats(items, reps, graph);
    const a = stats.find(s => s.pubkey === PK_A)!;
    const b = stats.find(s => s.pubkey === PK_B)!;
    expect(["trusted", "known"]).toContain(a.trustTier);
    expect(b.trustTier).toBe("unknown"); // no WoT, no rep
  });
});

describe("sortPeerStats", () => {
  const stats = [
    { pubkey: "a", displayName: "A", itemsReceived: 5, validated: 3, flagged: 1, qualityRate: 0.75, reputation: { pubkey: "a", useful: 3, slop: 1, score: 0, blocked: false, updatedAt: 0 }, trustTier: "known" as const, wotScore: 0.5, effectiveTrust: 0.5 },
    { pubkey: "b", displayName: "B", itemsReceived: 10, validated: 8, flagged: 0, qualityRate: 1.0, reputation: { pubkey: "b", useful: 8, slop: 0, score: 8, blocked: false, updatedAt: 0 }, trustTier: "trusted" as const, wotScore: 0.9, effectiveTrust: 0.9 },
    { pubkey: "c", displayName: "C", itemsReceived: 2, validated: 0, flagged: 2, qualityRate: 0.0, reputation: { pubkey: "c", useful: 0, slop: 2, score: -6, blocked: true, updatedAt: 0 }, trustTier: "restricted" as const, wotScore: 0.0, effectiveTrust: 0.0 },
  ];

  it("sorts by effectiveTrust descending", () => {
    const sorted = sortPeerStats(stats, "effectiveTrust");
    expect(sorted.map(s => s.pubkey)).toEqual(["b", "a", "c"]);
  });

  it("sorts by itemsReceived descending", () => {
    const sorted = sortPeerStats(stats, "itemsReceived");
    expect(sorted.map(s => s.pubkey)).toEqual(["b", "a", "c"]);
  });

  it("sorts by qualityRate descending", () => {
    const sorted = sortPeerStats(stats, "qualityRate");
    expect(sorted.map(s => s.pubkey)).toEqual(["b", "a", "c"]);
  });

  it("sorts by reputation score descending", () => {
    const sorted = sortPeerStats(stats, "reputation");
    expect(sorted.map(s => s.pubkey)).toEqual(["b", "a", "c"]);
  });

  it("sorts ascending when desc=false", () => {
    const sorted = sortPeerStats(stats, "effectiveTrust", false);
    expect(sorted.map(s => s.pubkey)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate original array", () => {
    const original = [...stats];
    sortPeerStats(stats, "itemsReceived");
    expect(stats.map(s => s.pubkey)).toEqual(original.map(s => s.pubkey));
  });
});
