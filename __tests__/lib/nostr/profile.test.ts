/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn().mockImplementation((event) => ({
    ...event,
    id: "mock-event-id-profile",
    sig: "mock-sig",
    pubkey: "mock-pubkey",
  })),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: jest.fn().mockResolvedValue([]),
    publish: jest.fn().mockReturnValue([Promise.resolve()]),
    destroy: jest.fn(),
  })),
}));

import {
  getCachedAgentProfile,
  setCachedAgentProfile,
  clearCachedAgentProfile,
  fetchAgentProfile,
  publishAgentProfile,
} from "@/lib/nostr/profile";
import type { NostrProfileMetadata } from "@/lib/nostr/profile";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { DEFAULT_RELAYS } from "@/lib/nostr/types";

const FAKE_HEX = "a".repeat(64);
const CACHE_PREFIX = "aegis-agent-profile-";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe("getCachedAgentProfile", () => {
  it("returns null when nothing stored", () => {
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("returns parsed profile from localStorage", () => {
    const profile = { name: "Agent", about: "Test agent" };
    localStorage.setItem(CACHE_PREFIX + "principal-1", JSON.stringify(profile));
    const result = getCachedAgentProfile("principal-1");
    expect(result).toEqual(profile);
  });

  it("returns null on malformed JSON", () => {
    localStorage.setItem(CACHE_PREFIX + "principal-1", "not json{{{");
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("returns null when stored value is not an object (string)", () => {
    localStorage.setItem(CACHE_PREFIX + "principal-1", JSON.stringify("hello"));
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("returns null when stored value is null", () => {
    localStorage.setItem(CACHE_PREFIX + "principal-1", "null");
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("returns null when stored value is a number", () => {
    localStorage.setItem(CACHE_PREFIX + "principal-1", "42");
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("returns null when stored value is an array", () => {
    localStorage.setItem(CACHE_PREFIX + "principal-1", JSON.stringify([1, 2, 3]));
    expect(getCachedAgentProfile("principal-1")).toBeNull();
  });

  it("handles profile with index signature fields", () => {
    const profile = { name: "Agent", lud16: "agent@lnurl.pay", custom_field: "custom" };
    localStorage.setItem(CACHE_PREFIX + "p1", JSON.stringify(profile));
    const result = getCachedAgentProfile("p1");
    expect(result?.lud16).toBe("agent@lnurl.pay");
    expect((result as Record<string, unknown>)?.custom_field).toBe("custom");
  });

  it("uses correct key prefix for different principals", () => {
    const p1 = { name: "Alice" };
    const p2 = { name: "Bob" };
    localStorage.setItem(CACHE_PREFIX + "principal-A", JSON.stringify(p1));
    localStorage.setItem(CACHE_PREFIX + "principal-B", JSON.stringify(p2));
    expect(getCachedAgentProfile("principal-A")?.name).toBe("Alice");
    expect(getCachedAgentProfile("principal-B")?.name).toBe("Bob");
  });
});

describe("setCachedAgentProfile", () => {
  it("stores profile in localStorage", () => {
    const profile: NostrProfileMetadata = { name: "Agent", about: "Test" };
    setCachedAgentProfile("principal-1", profile);
    const raw = localStorage.getItem(CACHE_PREFIX + "principal-1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(profile);
  });

  it("overwrites existing cached profile", () => {
    setCachedAgentProfile("p1", { name: "Old" });
    setCachedAgentProfile("p1", { name: "New" });
    expect(getCachedAgentProfile("p1")?.name).toBe("New");
  });

  it("handles storage quota errors gracefully", () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => setCachedAgentProfile("p1", { name: "x" })).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("serializes all known fields correctly", () => {
    const full: NostrProfileMetadata = {
      name: "n", display_name: "dn", about: "a",
      picture: "https://img.com/a.jpg", banner: "https://img.com/b.jpg",
      website: "https://example.com", lud16: "x@ln.pay", nip05: "x@nostr.com",
    };
    setCachedAgentProfile("p1", full);
    const restored = getCachedAgentProfile("p1");
    expect(restored).toEqual(full);
  });
});

describe("clearCachedAgentProfile", () => {
  it("removes cached profile from localStorage", () => {
    setCachedAgentProfile("p1", { name: "Agent" });
    clearCachedAgentProfile("p1");
    expect(getCachedAgentProfile("p1")).toBeNull();
  });

  it("does not throw when no profile is cached", () => {
    expect(() => clearCachedAgentProfile("nonexistent")).not.toThrow();
  });

  it("only removes the targeted principal's cache", () => {
    setCachedAgentProfile("p1", { name: "A" });
    setCachedAgentProfile("p2", { name: "B" });
    clearCachedAgentProfile("p1");
    expect(getCachedAgentProfile("p1")).toBeNull();
    expect(getCachedAgentProfile("p2")?.name).toBe("B");
  });
});

describe("cache round-trip", () => {
  it("set → get → clear → get returns null", () => {
    const profile: NostrProfileMetadata = { name: "Test", display_name: "Test Agent" };
    setCachedAgentProfile("p1", profile);
    expect(getCachedAgentProfile("p1")).toEqual(profile);
    clearCachedAgentProfile("p1");
    expect(getCachedAgentProfile("p1")).toBeNull();
  });
});

describe("cache SSR guard (no localStorage)", () => {
  let origLS: Storage;

  beforeEach(() => {
    origLS = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: origLS, configurable: true });
  });

  it("getCachedAgentProfile returns null when localStorage is undefined", () => {
    expect(getCachedAgentProfile("p1")).toBeNull();
  });

  it("setCachedAgentProfile is a no-op when localStorage is undefined", () => {
    expect(() => setCachedAgentProfile("p1", { name: "Agent" })).not.toThrow();
  });

  it("clearCachedAgentProfile is a no-op when localStorage is undefined", () => {
    expect(() => clearCachedAgentProfile("p1")).not.toThrow();
  });
});

describe("fetchAgentProfile", () => {
  it("returns null when no events found", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });

  it("parses Kind 0 JSON content correctly", async () => {
    const meta = { name: "Agent", display_name: "My Agent", about: "Hello", picture: "https://img.com/a.jpg" };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(meta), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toEqual(meta);
  });

  it("picks latest event when multiple Kind 0 events exist", async () => {
    const old = { name: "OldName" };
    const latest = { name: "NewName" };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(old), tags: [] },
        { kind: 0, created_at: 1700000100, content: JSON.stringify(latest), tags: [] },
        { kind: 0, created_at: 1700000050, content: JSON.stringify({ name: "Mid" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result?.name).toBe("NewName");
  });

  it("returns null on malformed Kind 0 JSON", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: "not json{{{", tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });

  it("returns null when Kind 0 content is not an object", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify("just a string"), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });

  it("returns null when Kind 0 content is null", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: "null", tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });

  it("uses DEFAULT_RELAYS when no relayUrls provided", async () => {
    const mockQuerySync = jest.fn().mockResolvedValue([]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: mockQuerySync,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await fetchAgentProfile(FAKE_HEX);
    expect(mockQuerySync).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.objectContaining({
      authors: [FAKE_HEX],
      kinds: [0],
    }));
  });

  it("uses DEFAULT_RELAYS when relayUrls is empty array", async () => {
    const mockQuerySync = jest.fn().mockResolvedValue([]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: mockQuerySync,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await fetchAgentProfile(FAKE_HEX, []);
    expect(mockQuerySync).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
  });

  it("uses custom relayUrls when provided", async () => {
    const customRelays = ["wss://custom.relay"];
    const mockQuerySync = jest.fn().mockResolvedValue([]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: mockQuerySync,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await fetchAgentProfile(FAKE_HEX, customRelays);
    expect(mockQuerySync).toHaveBeenCalledWith(customRelays, expect.anything());
  });

  it("destroys pool after successful fetch", async () => {
    const mockDestroy = jest.fn();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: mockDestroy,
    }) as unknown as SimplePool);

    await fetchAgentProfile(FAKE_HEX);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("destroys pool even when querySync rejects", async () => {
    const mockDestroy = jest.fn();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("relay failure")),
      destroy: mockDestroy,
    }) as unknown as SimplePool);

    await expect(fetchAgentProfile(FAKE_HEX)).rejects.toThrow();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("preserves extra fields from Kind 0 metadata", async () => {
    const meta = { name: "Agent", lud16: "agent@pay.me", custom_field: "value" };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(meta), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result?.lud16).toBe("agent@pay.me");
    expect((result as Record<string, unknown>)?.custom_field).toBe("value");
  });

  it("handles empty content string gracefully", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: "", tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });

  it("returns null when Kind 0 content is an array", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify([1, 2, 3]), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(FAKE_HEX);
    expect(result).toBeNull();
  });
});

describe("publishAgentProfile", () => {
  const fakeSk = new Uint8Array(32).fill(1);

  beforeEach(() => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      publish: jest.fn().mockReturnValue([Promise.resolve()]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);
  });

  it("publishes new profile when no existing profile", async () => {
    const profile: NostrProfileMetadata = { name: "Agent", about: "Test" };
    const result = await publishAgentProfile(profile, fakeSk, FAKE_HEX);

    expect(result.eventId).toBe("mock-event-id-profile");
    expect(result.relaysPublished.length).toBeGreaterThan(0);
    expect(result.mergedProfile).toEqual(profile);
  });

  it("merges with existing profile (preserve existing fields)", async () => {
    const existing = { name: "OldName", lud16: "old@pay.me", nip05: "old@nostr.com" };

    let callCount = 0; // 1st pool = fetch, 2nd = publish
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([
            { kind: 0, created_at: 1700000000, content: JSON.stringify(existing), tags: [] },
          ]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue(DEFAULT_RELAYS.map(() => Promise.resolve())),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const newProfile: NostrProfileMetadata = { name: "NewName", about: "Updated" };
    const result = await publishAgentProfile(newProfile, fakeSk, FAKE_HEX);

    expect(result.mergedProfile.name).toBe("NewName");
    expect(result.mergedProfile.about).toBe("Updated");
    expect(result.mergedProfile.lud16).toBe("old@pay.me");
    expect(result.mergedProfile.nip05).toBe("old@nostr.com");
  });

  it("clears fields when empty string is passed", async () => {
    const existing = { name: "OldName", about: "Old bio" };
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([
            { kind: 0, created_at: 1700000000, content: JSON.stringify(existing), tags: [] },
          ]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue([Promise.resolve()]),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile({ name: "NewName", about: "" }, fakeSk, FAKE_HEX);
    expect(result.mergedProfile.name).toBe("NewName");
    expect(result.mergedProfile.about).toBeUndefined();
  });

  it("does not override with undefined values", async () => {
    const existing = { name: "OldName", about: "Old bio" };
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([
            { kind: 0, created_at: 1700000000, content: JSON.stringify(existing), tags: [] },
          ]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue([Promise.resolve()]),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile({ name: "NewName" }, fakeSk, FAKE_HEX);
    expect(result.mergedProfile.name).toBe("NewName");
    expect(result.mergedProfile.about).toBe("Old bio");
  });

  it("continues with empty merge when fetch fails", async () => {
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockRejectedValue(new Error("relay offline")),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue([Promise.resolve()]),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX);
    expect(result.mergedProfile.name).toBe("Agent");
    expect(result.relaysPublished.length).toBeGreaterThan(0);
  });

  it("passes Kind 0 to finalizeEvent", async () => {
    await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX);
    const mockFinalizeEvent = finalizeEvent as jest.MockedFunction<typeof finalizeEvent>;
    expect(mockFinalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 0,
        tags: [],
      }),
      fakeSk,
    );
  });

  it("serializes merged profile as event content", async () => {
    await publishAgentProfile({ name: "Agent", about: "Bio" }, fakeSk, FAKE_HEX);
    const mockFinalizeEvent = finalizeEvent as jest.MockedFunction<typeof finalizeEvent>;
    const call = mockFinalizeEvent.mock.calls[0][0] as { content: string };
    const parsed = JSON.parse(call.content);
    expect(parsed.name).toBe("Agent");
    expect(parsed.about).toBe("Bio");
  });

  it("partitions relays into published and failed", async () => {
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue([
          Promise.resolve(),
          Promise.reject(new Error("timeout")),
        ]),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile(
      { name: "Agent" }, fakeSk, FAKE_HEX,
      ["wss://ok.relay", "wss://fail.relay"],
    );
    expect(result.relaysPublished).toEqual(["wss://ok.relay"]);
    expect(result.relaysFailed).toEqual(["wss://fail.relay"]);
  });

  it("uses custom relayUrls for both fetch and publish", async () => {
    const customRelays = ["wss://custom.relay"];
    const mockQuerySync = jest.fn().mockResolvedValue([]);
    const mockPublish = jest.fn().mockReturnValue([Promise.resolve()]);

    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: mockQuerySync,
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: mockPublish,
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX, customRelays);
    expect(mockQuerySync).toHaveBeenCalledWith(customRelays, expect.anything());
    expect(mockPublish).toHaveBeenCalledWith(customRelays, expect.anything());
  });

  it("sets created_at to current unix timestamp", async () => {
    const before = Math.floor(Date.now() / 1000);
    await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX);
    const after = Math.floor(Date.now() / 1000);

    const mockFinalizeEvent = finalizeEvent as jest.MockedFunction<typeof finalizeEvent>;
    const call = mockFinalizeEvent.mock.calls[0][0] as { created_at: number };
    expect(call.created_at).toBeGreaterThanOrEqual(before);
    expect(call.created_at).toBeLessThanOrEqual(after);
  });

  it("returns all published relays when all succeed", async () => {
    const relays = ["wss://r1.com", "wss://r2.com", "wss://r3.com"];
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue(relays.map(() => Promise.resolve())),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX, relays);
    expect(result.relaysPublished).toEqual(relays);
    expect(result.relaysFailed).toEqual([]);
  });

  it("returns all failed relays when all fail", async () => {
    const relays = ["wss://r1.com", "wss://r2.com"];
    let callCount = 0;
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          querySync: jest.fn().mockResolvedValue([]),
          destroy: jest.fn(),
        } as unknown as SimplePool;
      }
      return {
        publish: jest.fn().mockReturnValue(relays.map(() => Promise.reject(new Error("fail")))),
        destroy: jest.fn(),
      } as unknown as SimplePool;
    });

    const result = await publishAgentProfile({ name: "Agent" }, fakeSk, FAKE_HEX, relays);
    expect(result.relaysPublished).toEqual([]);
    expect(result.relaysFailed).toEqual(relays);
  });
});
