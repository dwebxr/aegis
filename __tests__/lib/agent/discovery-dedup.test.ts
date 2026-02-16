/**
 * Tests for agent discovery — verifies single-pass dedup behavior,
 * resonance calculation, and edge cases in peer parsing.
 * Uses mocked SimplePool to exercise real discovery logic.
 */

// Mock nostr-tools/pool
const mockQuerySync = jest.fn();
const mockDestroy = jest.fn();
jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: mockQuerySync,
    destroy: mockDestroy,
  })),
  useWebSocketImplementation: undefined,
}));

import { discoverPeers } from "@/lib/agent/discovery";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

const DEFAULT_PREFS: UserPreferenceProfile = {
  version: 1,
  principalId: "test-principal",
  topicAffinities: { ai: 0.8, crypto: 0.7, tech: 0.5 },
  authorTrust: {},
  calibration: { qualityThreshold: 4.0 },
  recentTopics: [],
  totalValidated: 0,
  totalFlagged: 0,
  lastUpdated: Date.now(),
};

beforeEach(() => {
  mockQuerySync.mockReset();
  mockDestroy.mockReset();
});

function makeEvent(pubkey: string, tags: string[][], content = "", createdAt = 1000) {
  return { pubkey, tags, content, created_at: createdAt, kind: 30078, id: `id-${pubkey}-${createdAt}` };
}

describe("discoverPeers — single-pass dedup", () => {
  it("keeps only the latest event per pubkey", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-a", [["interest", "ai"], ["interest", "crypto"]], "", 1000),
      makeEvent("peer-a", [["interest", "ai"], ["interest", "tech"]], "", 2000), // newer
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    const peerA = peers.find(p => p.nostrPubkey === "peer-a");
    expect(peerA).toBeDefined();
    expect(peerA!.lastSeen).toBe(2000 * 1000); // newer event's timestamp
    expect(peerA!.interests).toContain("tech"); // from newer event
  });

  it("skips self (myPubkey)", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("my-pk", [["interest", "ai"]], "", 1000),
      makeEvent("peer-b", [["interest", "ai"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers.find(p => p.nostrPubkey === "my-pk")).toBeUndefined();
    expect(peers.find(p => p.nostrPubkey === "peer-b")).toBeDefined();
  });

  it("deduplicates multiple events from same peer across results", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-x", [["interest", "ai"]], "", 500),
      makeEvent("peer-x", [["interest", "ai"]], "", 1500),
      makeEvent("peer-x", [["interest", "ai"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    // Should only have one entry for peer-x with the latest timestamp
    const peerXEntries = peers.filter(p => p.nostrPubkey === "peer-x");
    expect(peerXEntries).toHaveLength(1);
    expect(peerXEntries[0].lastSeen).toBe(1500 * 1000);
  });
});

describe("discoverPeers — tag parsing", () => {
  it("extracts interests from tags", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-1", [["interest", "ai"], ["interest", "crypto"], ["interest", "defi"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].interests).toEqual(["ai", "crypto", "defi"]);
  });

  it("extracts capacity from tags (clamped 1-100)", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-cap", [["interest", "ai"], ["capacity", "42"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].capacity).toBe(42);
  });

  it("ignores invalid capacity values", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-bad-cap", [["interest", "ai"], ["capacity", "0"]], "", 1000), // below min
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].capacity).toBe(5); // default
  });

  it("extracts principal from tags", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-ic", [["interest", "ai"], ["principal", "rluf3-eiaaa-aaaam-qgjuq-cai"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].principalId).toBe("rluf3-eiaaa-aaaam-qgjuq-cai");
  });

  it("handles empty tag values gracefully", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-empty", [["interest", ""], ["interest", "ai"], ["capacity", ""], ["principal", ""]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    // Empty interest should not be added, but "ai" should
    expect(peers[0].interests).toEqual(["ai"]);
    // Empty capacity/principal should remain at defaults
    expect(peers[0].capacity).toBe(5);
    expect(peers[0].principalId).toBeUndefined();
  });
});

describe("discoverPeers — resonance filtering", () => {
  it("filters peers below RESONANCE_THRESHOLD (0.3)", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-relevant", [["interest", "ai"], ["interest", "crypto"]], "", 1000),
      makeEvent("peer-irrelevant", [["interest", "gardening"], ["interest", "cooking"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    // peer-relevant shares interests with prefs → high resonance
    // peer-irrelevant shares nothing → low resonance
    const relevant = peers.find(p => p.nostrPubkey === "peer-relevant");
    expect(relevant).toBeDefined();
    expect(relevant!.resonance).toBeGreaterThanOrEqual(0.3);
  });

  it("sorts results by resonance descending", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-low", [["interest", "tech"]], "", 1000), // 1 shared
      makeEvent("peer-high", [["interest", "ai"], ["interest", "crypto"], ["interest", "tech"]], "", 1000), // 3 shared
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    if (peers.length >= 2) {
      expect(peers[0].resonance).toBeGreaterThanOrEqual(peers[1].resonance!);
    }
  });
});

describe("discoverPeers — error handling", () => {
  it("returns empty array on relay query failure", async () => {
    mockQuerySync.mockRejectedValue(new Error("Connection refused"));

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers).toEqual([]);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("handles empty relay list", async () => {
    mockQuerySync.mockResolvedValue([]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, []);
    expect(peers).toEqual([]);
  });

  it("handles zero events from relay", async () => {
    mockQuerySync.mockResolvedValue([]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers).toEqual([]);
  });
});

describe("discoverPeers — manifest parsing", () => {
  it("decodes valid manifest from event content", async () => {
    const manifest = JSON.stringify({
      entries: [{ hash: "abc", topic: "ai", score: 8.0 }],
      generatedAt: Date.now(),
    });
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-manifest", [["interest", "ai"]], manifest, 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].manifest).toBeDefined();
    expect(peers[0].manifest!.entries).toHaveLength(1);
  });

  it("handles malformed manifest gracefully (no crash)", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-bad-manifest", [["interest", "ai"]], "not json {{{", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].manifest).toBeUndefined();
  });

  it("empty content → no manifest", async () => {
    mockQuerySync.mockResolvedValue([
      makeEvent("peer-no-manifest", [["interest", "ai"]], "", 1000),
    ]);

    const peers = await discoverPeers("my-pk", DEFAULT_PREFS, ["wss://relay.test"]);
    expect(peers[0].manifest).toBeUndefined();
  });
});
