import { createEmptyProfile } from "@/lib/preferences/types";

const mockQuerySync = jest.fn();
const mockPublish = jest.fn();
const mockDestroy = jest.fn();

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: mockQuerySync,
    publish: mockPublish,
    destroy: mockDestroy,
  })),
}));

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn().mockReturnValue({
    id: "mock-event-id",
    pubkey: "mock-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags: [],
    content: "",
    sig: "mock-sig",
  }),
  getPublicKey: jest.fn().mockReturnValue("mock-derived-pubkey"),
}));

import { discoverPeers, broadcastPresence } from "@/lib/agent/discovery";

describe("discoverPeers — relay failure", () => {
  const prefs = { ...createEmptyProfile("test"), topicAffinities: { ai: 0.8 } };
  const relays = ["wss://relay.example.com"];

  beforeEach(() => {
    mockQuerySync.mockReset();
    mockDestroy.mockReset();
  });

  it("returns empty array when relay query throws", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await discoverPeers("my-pubkey", prefs, relays);

    expect(result).toEqual([]);
  });

  it("calls pool.destroy() even when relay query throws", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("Timeout"));

    await discoverPeers("my-pubkey", prefs, relays);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("returns peers on successful relay query", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-pubkey-abc",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", "aegis-agent-profile"],
          ["interest", "ai"],
          ["capacity", "5"],
        ],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);

    expect(result.length).toBe(1);
    expect(result[0].nostrPubkey).toBe("peer-pubkey-abc");
    expect(result[0].interests).toContain("ai");
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("clamps capacity to valid range (ignores negative)", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-neg",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "-5"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].capacity).toBe(5); // default, not -5
  });

  it("clamps capacity to valid range (ignores too large)", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-big",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "99999"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].capacity).toBe(5); // default, not 99999
  });

  it("defaults capacity on non-numeric string", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-nan",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "abc"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].capacity).toBe(5); // default
  });

  it("accepts valid capacity within range", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-valid",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "42"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].capacity).toBe(42);
  });

  it("filters out self from results", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "my-pubkey",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);

    expect(result).toEqual([]);
  });
});

describe("broadcastPresence — relay failure", () => {
  const sk = new Uint8Array(32).fill(1);

  beforeEach(() => {
    mockPublish.mockReset();
    mockDestroy.mockReset();
  });

  it("completes without throwing when relays fail", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("Relay down"))]);

    await expect(
      broadcastPresence(sk, ["ai", "ml"], 5, ["wss://failing.relay"])
    ).resolves.toBeUndefined();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("calls pool.destroy() after publish", async () => {
    mockPublish.mockReturnValue([Promise.resolve()]);

    await broadcastPresence(sk, ["ai"], 3, ["wss://relay.example.com"]);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("includes principalId tag when provided", async () => {
    const { finalizeEvent } = require("nostr-tools/pure");
    mockPublish.mockReturnValue([Promise.resolve()]);

    await broadcastPresence(sk, ["ai"], 5, ["wss://relay.example.com"], "abc-principal-123");

    expect(finalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([["principal", "abc-principal-123"]]),
      }),
      sk,
    );
  });

  it("omits principalId tag when not provided", async () => {
    const { finalizeEvent } = require("nostr-tools/pure");
    mockPublish.mockReturnValue([Promise.resolve()]);

    await broadcastPresence(sk, ["ai"], 5, ["wss://relay.example.com"]);

    const callTags = finalizeEvent.mock.calls[finalizeEvent.mock.calls.length - 1][0].tags;
    expect(callTags.find((t: string[]) => t[0] === "principal")).toBeUndefined();
  });
});

describe("discoverPeers — principalId and deduplication", () => {
  const prefs = { ...createEmptyProfile("test"), topicAffinities: { ai: 0.8 } };
  const relays = ["wss://relay.example.com"];

  beforeEach(() => {
    mockQuerySync.mockReset();
    mockDestroy.mockReset();
  });

  it("extracts principalId from event tags", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-with-principal",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", "aegis-agent-profile"],
          ["interest", "ai"],
          ["capacity", "5"],
          ["principal", "abc-def-123"],
        ],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].principalId).toBe("abc-def-123");
  });

  it("principalId is undefined when tag is absent", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-no-principal",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", "aegis-agent-profile"],
          ["interest", "ai"],
        ],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].principalId).toBeUndefined();
  });

  it("deduplicates by pubkey, keeping the latest event", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "dup-peer",
        created_at: 1700000000, // older
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "3"]],
      },
      {
        pubkey: "dup-peer",
        created_at: 1700000100, // newer
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["capacity", "10"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(1);
    expect(result[0].capacity).toBe(10); // from newer event
  });

  it("filters out peers below RESONANCE_THRESHOLD", async () => {
    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "low-resonance-peer",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "crypto"], ["interest", "defi"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", prefs, relays);
    expect(result.length).toBe(0);
  });

  it("sorts peers by resonance descending", async () => {
    const highResonancePrefs = {
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0.8, ml: 0.8, crypto: 0.5 },
    };

    mockQuerySync.mockResolvedValueOnce([
      {
        pubkey: "peer-partial",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"]],
      },
      {
        pubkey: "peer-full",
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "aegis-agent-profile"], ["interest", "ai"], ["interest", "ml"], ["interest", "crypto"]],
      },
    ]);

    const result = await discoverPeers("my-pubkey", highResonancePrefs, relays);
    expect(result.length).toBe(2);
    expect(result[0].nostrPubkey).toBe("peer-full");
    expect(result[0].resonance!).toBeGreaterThan(result[1].resonance!);
  });
});
