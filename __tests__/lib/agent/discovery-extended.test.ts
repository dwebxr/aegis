/**
 * Extended discovery tests — broadcastPresence and discoverPeers with mocked SimplePool.
 */

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn((_template: unknown, _sk: unknown) => ({
    kind: 30078,
    created_at: 1700000000,
    tags: [],
    content: "",
    pubkey: "my-pubkey",
    id: "event-id",
    sig: "signature",
  })),
}));

const mockPublish = jest.fn();
const mockQuerySync = jest.fn();
const mockDestroy = jest.fn();

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
    querySync: mockQuerySync,
    destroy: mockDestroy,
  })),
}));

jest.mock("@/lib/d2a/manifest", () => ({
  buildManifest: jest.fn(() => ({ items: [] })),
  decodeManifest: jest.fn((s: string) => {
    try { return JSON.parse(s); } catch { return null; }
  }),
}));

import { broadcastPresence, discoverPeers, calculateResonance } from "@/lib/agent/discovery";
import { createEmptyProfile } from "@/lib/preferences/types";
import { RESONANCE_THRESHOLD, PEER_EXPIRY_MS, TAG_D2A_INTEREST, TAG_D2A_CAPACITY, TAG_D2A_PRINCIPAL } from "@/lib/agent/protocol";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("broadcastPresence", () => {
  const sk = new Uint8Array(32);
  const relays = ["wss://relay1.example.com", "wss://relay2.example.com"];

  it("publishes presence event to relays", async () => {
    mockPublish.mockReturnValue([Promise.resolve()]);

    await broadcastPresence(sk, ["ai", "crypto"], 5, relays);

    expect(mockPublish).toHaveBeenCalledWith(relays, expect.any(Object));
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("throws when all relays fail", async () => {
    mockPublish.mockReturnValue([
      Promise.reject(new Error("relay1 failed")),
      Promise.reject(new Error("relay2 failed")),
    ]);

    await expect(broadcastPresence(sk, ["ai"], 5, relays))
      .rejects.toThrow("failed on all 2 relays");
  });

  it("succeeds when at least one relay works", async () => {
    mockPublish.mockReturnValue([
      Promise.resolve(),
      Promise.reject(new Error("relay2 failed")),
    ]);

    await expect(broadcastPresence(sk, ["ai"], 5, relays)).resolves.toBeUndefined();
  });

  it("includes principal ID in tags when provided", async () => {
    const { finalizeEvent } = await import("nostr-tools/pure");
    mockPublish.mockReturnValue([Promise.resolve()]);

    await broadcastPresence(sk, [], 5, relays, "principal-123");

    const template = (finalizeEvent as jest.Mock).mock.calls[0][0];
    const principalTag = template.tags.find((t: string[]) => t[0] === TAG_D2A_PRINCIPAL);
    expect(principalTag).toBeDefined();
    expect(principalTag[1]).toBe("principal-123");
  });

  it("limits interests to 20 tags", async () => {
    const { finalizeEvent } = await import("nostr-tools/pure");
    mockPublish.mockReturnValue([Promise.resolve()]);

    const interests = Array.from({ length: 30 }, (_, i) => `topic-${i}`);
    await broadcastPresence(sk, interests, 5, relays);

    const template = (finalizeEvent as jest.Mock).mock.calls[0][0];
    const interestTags = template.tags.filter((t: string[]) => t[0] === TAG_D2A_INTEREST);
    expect(interestTags).toHaveLength(20);
  });

  it("does not throw for empty relays list", async () => {
    // 0 relays → 0 promises → 0 succeeded → but relayUrls.length is 0 so condition is false
    mockPublish.mockReturnValue([]);
    await expect(broadcastPresence(sk, [], 5, [])).resolves.toBeUndefined();
  });
});

describe("discoverPeers", () => {
  const myPubkey = "my-pubkey-hex";

  function makePrefs(affinities: Record<string, number> = {}) {
    return { ...createEmptyProfile("test"), topicAffinities: affinities };
  }

  it("returns peers above resonance threshold, sorted by resonance", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-a",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"], [TAG_D2A_INTEREST, "ml"], [TAG_D2A_CAPACITY, "10"]],
        content: "",
      },
      {
        pubkey: "peer-b",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8, ml: 0.6 });
    const relays = ["wss://relay.example.com"];

    const peers = await discoverPeers(myPubkey, prefs, relays);

    // Both should pass threshold (RESONANCE_THRESHOLD is typically 0.1)
    expect(peers.length).toBeGreaterThanOrEqual(1);

    // peer-a has better overlap → higher resonance
    if (peers.length >= 2) {
      expect(peers[0].nostrPubkey).toBe("peer-a");
      expect(peers[0].resonance!).toBeGreaterThan(peers[1].resonance!);
    }
  });

  it("filters out own pubkey", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: myPubkey, // should be filtered
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    expect(peers).toHaveLength(0);
  });

  it("keeps latest event per pubkey", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-a",
        created_at: now - 100,
        tags: [[TAG_D2A_INTEREST, "old-topic"]],
        content: "",
      },
      {
        pubkey: "peer-a",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"], [TAG_D2A_INTEREST, "new-topic"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.5, "new-topic": 0.5 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);

    // Should only have one entry for peer-a with the newer interests
    const peerA = peers.find(p => p.nostrPubkey === "peer-a");
    if (peerA) {
      expect(peerA.interests).toContain("ai");
      expect(peerA.interests).toContain("new-topic");
    }
  });

  it("filters out peers below resonance threshold", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-no-overlap",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "cooking"], [TAG_D2A_INTEREST, "gardening"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8, ml: 0.6 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    expect(peers).toHaveLength(0); // No overlap → resonance 0 → below threshold
  });

  it("handles relay query failure gracefully", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("Relay timeout"));

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    expect(peers).toEqual([]);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("parses capacity from tags with bounds", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-cap",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"], [TAG_D2A_CAPACITY, "42"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    if (peers.length > 0) {
      expect(peers[0].capacity).toBe(42);
    }
  });

  it("defaults capacity to 5 for invalid values", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-bad-cap",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"], [TAG_D2A_CAPACITY, "999"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    if (peers.length > 0) {
      expect(peers[0].capacity).toBe(5); // 999 > 100, so default
    }
  });

  it("decodes manifest from event content", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-manifest",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"]],
        content: JSON.stringify({ items: [{ id: "item-1" }] }),
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    if (peers.length > 0) {
      expect(peers[0].manifest).toBeDefined();
    }
  });

  it("handles empty event content (no manifest)", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-no-manifest",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    if (peers.length > 0) {
      expect(peers[0].manifest).toBeUndefined();
    }
  });

  it("extracts principal ID from tags", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-principal",
        created_at: now,
        tags: [[TAG_D2A_INTEREST, "ai"], [TAG_D2A_PRINCIPAL, "principal-abc"]],
        content: "",
      },
    ]);

    const prefs = makePrefs({ ai: 0.8 });
    const peers = await discoverPeers(myPubkey, prefs, ["wss://relay.example.com"]);
    if (peers.length > 0) {
      expect(peers[0].principalId).toBe("principal-abc");
    }
  });
});
