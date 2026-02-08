/**
 * Tests for discoverPeers and broadcastPresence relay failure handling.
 * Uses mocked SimplePool to simulate relay errors.
 */
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
});
