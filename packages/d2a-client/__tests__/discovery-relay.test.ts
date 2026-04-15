/**
 * Tests for broadcastPresence + discoverPeers. SimplePool is mocked;
 * synthetic Nostr events drive the SDK's tag walking, capacity clamping,
 * manifest decoding, and resonance filtering.
 */

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

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { broadcastPresence, discoverPeers } from "../src/discovery";
import {
  TAG_D2A_PROFILE,
  TAG_D2A_INTEREST,
  TAG_D2A_CAPACITY,
  TAG_D2A_PRINCIPAL,
  KIND_AGENT_PROFILE,
} from "../src/protocol";
import type { ResonancePrefs } from "../src/types";

const RELAYS = ["wss://r1", "wss://r2"];

interface SignedEvent { kind: number; tags: string[][]; content: string; pubkey: string; created_at: number; }

beforeEach(() => {
  mockPublish.mockReset();
  mockQuerySync.mockReset();
  mockDestroy.mockReset();
});

describe("broadcastPresence", () => {
  it("publishes a kind 30078 event with d, capacity, and interest tags", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok"), Promise.resolve("ok")]);
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    await broadcastPresence({ sk, interests: ["rust", "ml"], capacity: 5, relayUrls: RELAYS });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [_relays, signed] = mockPublish.mock.calls[0] as [string[], SignedEvent];
    expect(signed.kind).toBe(KIND_AGENT_PROFILE);
    expect(signed.pubkey).toBe(pk);
    expect(signed.tags).toContainEqual(["d", TAG_D2A_PROFILE]);
    expect(signed.tags).toContainEqual([TAG_D2A_CAPACITY, "5"]);
    expect(signed.tags).toContainEqual([TAG_D2A_INTEREST, "rust"]);
    expect(signed.tags).toContainEqual([TAG_D2A_INTEREST, "ml"]);
    expect(signed.tags.find(t => t[0] === TAG_D2A_PRINCIPAL)).toBeUndefined();
    expect(signed.content).toBe(""); // no manifest supplied
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("includes a principal tag when supplied", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    await broadcastPresence({
      sk: generateSecretKey(),
      interests: ["rust"],
      capacity: 5,
      relayUrls: [RELAYS[0]],
      principalId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
    });
    const [, signed] = mockPublish.mock.calls[0] as [string[], SignedEvent];
    expect(signed.tags).toContainEqual([TAG_D2A_PRINCIPAL, "rrkah-fqaaa-aaaaa-aaaaq-cai"]);
  });

  it("serialises a manifest into event content when provided", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const manifest = { entries: [{ hash: "abc", topic: "rust", score: 9 }], generatedAt: 1735689600000 };
    await broadcastPresence({
      sk: generateSecretKey(), interests: ["rust"], capacity: 3, relayUrls: [RELAYS[0]], manifest,
    });
    const [, signed] = mockPublish.mock.calls[0] as [string[], SignedEvent];
    expect(JSON.parse(signed.content)).toEqual(manifest);
  });

  it("caps interests at 20 even when 50 are supplied", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const fifty = Array.from({ length: 50 }, (_, i) => `topic-${i}`);
    await broadcastPresence({
      sk: generateSecretKey(), interests: fifty, capacity: 5, relayUrls: [RELAYS[0]],
    });
    const [, signed] = mockPublish.mock.calls[0] as [string[], SignedEvent];
    const interestTags = signed.tags.filter(t => t[0] === TAG_D2A_INTEREST);
    expect(interestTags).toHaveLength(20);
    // First-N truncation is the documented policy.
    expect(interestTags.map(t => t[1])).toEqual(fifty.slice(0, 20));
  });

  it("throws when every relay rejects publication", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("down")), Promise.reject(new Error("down"))]);
    await expect(
      broadcastPresence({ sk: generateSecretKey(), interests: ["x"], capacity: 1, relayUrls: RELAYS }),
    ).rejects.toThrow(/all 2 relays/);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("succeeds when at least one relay accepts", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("down")), Promise.resolve("ok")]);
    await expect(
      broadcastPresence({ sk: generateSecretKey(), interests: ["x"], capacity: 1, relayUrls: RELAYS }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when relayUrls is empty (degenerate but valid)", async () => {
    mockPublish.mockReturnValue([]);
    await expect(
      broadcastPresence({ sk: generateSecretKey(), interests: ["x"], capacity: 1, relayUrls: [] }),
    ).resolves.toBeUndefined();
  });
});

function fakeNostrEvent(opts: {
  pubkey: string;
  interests: string[];
  capacity?: number | string;
  principal?: string;
  manifestJSON?: string;
  ageMs?: number;
}): { kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; id: string; sig: string } {
  const tags: string[][] = [["d", TAG_D2A_PROFILE]];
  if (opts.capacity !== undefined) tags.push([TAG_D2A_CAPACITY, String(opts.capacity)]);
  if (opts.principal) tags.push([TAG_D2A_PRINCIPAL, opts.principal]);
  for (const i of opts.interests) tags.push([TAG_D2A_INTEREST, i]);
  return {
    kind: KIND_AGENT_PROFILE,
    pubkey: opts.pubkey,
    created_at: Math.floor((Date.now() - (opts.ageMs ?? 0)) / 1000),
    tags,
    content: opts.manifestJSON ?? "",
    id: "00".repeat(32),
    sig: "00".repeat(64),
  };
}

describe("discoverPeers", () => {
  const myPk = "00".repeat(32); // distinct from any test pubkey we synthesize
  const myPrefs: ResonancePrefs = {
    topicAffinities: { rust: 0.9, ml: 0.8, low: 0.05 }, // 'low' under threshold, ignored
  };

  it("returns peers above resonance threshold sorted descending", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust", "ml", "go"] }),       // perfect-ish overlap
      fakeNostrEvent({ pubkey: "bb".repeat(32), interests: ["rust", "haskell"] }),         // partial
      fakeNostrEvent({ pubkey: "cc".repeat(32), interests: ["python", "java"] }),          // disjoint → 0 → dropped
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers).toHaveLength(2);
    expect(peers[0].nostrPubkey).toBe("aa".repeat(32));
    expect(peers[1].nostrPubkey).toBe("bb".repeat(32));
    expect(peers[0].resonance!).toBeGreaterThan(peers[1].resonance!);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("filters out the caller's own pubkey", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({ pubkey: myPk, interests: ["rust", "ml"] }), // self
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust", "ml"] }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers.map(p => p.nostrPubkey)).toEqual(["aa".repeat(32)]);
  });

  it("clamps out-of-range capacity to default 5", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust", "ml"], capacity: 9999 }),
      fakeNostrEvent({ pubkey: "bb".repeat(32), interests: ["rust", "ml"], capacity: 0 }),
      fakeNostrEvent({ pubkey: "cc".repeat(32), interests: ["rust", "ml"], capacity: "not-a-number" }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers.find(p => p.nostrPubkey === "aa".repeat(32))!.capacity).toBe(5);
    expect(peers.find(p => p.nostrPubkey === "bb".repeat(32))!.capacity).toBe(5);
    expect(peers.find(p => p.nostrPubkey === "cc".repeat(32))!.capacity).toBe(5);
  });

  it("accepts in-range capacity values verbatim", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust", "ml"], capacity: 17 }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers[0].capacity).toBe(17);
  });

  it("captures principal binding when present", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({
        pubkey: "aa".repeat(32),
        interests: ["rust", "ml"],
        principal: "rrkah-fqaaa-aaaaa-aaaaq-cai",
      }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers[0].principalId).toBe("rrkah-fqaaa-aaaaa-aaaaq-cai");
  });

  it("decodes a valid manifest from event content", async () => {
    const manifest = { entries: [{ hash: "abc", topic: "rust", score: 9 }], generatedAt: 1 };
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({
        pubkey: "aa".repeat(32),
        interests: ["rust", "ml"],
        manifestJSON: JSON.stringify(manifest),
      }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers[0].manifest).toEqual(manifest);
  });

  it("tolerates an invalid manifest by leaving manifest undefined", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({
        pubkey: "aa".repeat(32),
        interests: ["rust", "ml"],
        manifestJSON: "{not valid json",
      }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers[0].manifest).toBeUndefined();
  });

  it("dedupes by pubkey, keeping the most recent presence event per peer", async () => {
    mockQuerySync.mockResolvedValue([
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust"], ageMs: 600_000 }),
      fakeNostrEvent({ pubkey: "aa".repeat(32), interests: ["rust", "ml"], ageMs: 1_000 }),
    ]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers).toHaveLength(1);
    // The later event has interests ["rust", "ml"] — overlap with myHigh is now 2 not 1.
    expect(peers[0].interests).toEqual(["rust", "ml"]);
  });

  it("returns an empty array when no events come back from relays", async () => {
    mockQuerySync.mockResolvedValue([]);
    const peers = await discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS });
    expect(peers).toEqual([]);
  });

  it("destroys the SimplePool even when querySync throws", async () => {
    mockQuerySync.mockRejectedValue(new Error("relay down"));
    await expect(discoverPeers({ myPubkey: myPk, myPrefs, relayUrls: RELAYS })).rejects.toThrow();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
