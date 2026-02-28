/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import {
  getCachedAgentProfile,
  setCachedAgentProfile,
  clearCachedAgentProfile,
  fetchAgentProfile,
} from "@/lib/nostr/profile";
import type { NostrProfileMetadata } from "@/lib/nostr/profile";

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: jest.fn().mockResolvedValue([]),
    destroy: jest.fn(),
  })),
}));

import { SimplePool } from "nostr-tools/pool";

const CACHE_PREFIX = "aegis-agent-profile-";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe("nostrKeys derivation", () => {
  it("returns deterministic keys for same principalText", () => {
    const keys1 = deriveNostrKeypairFromText("test-principal");
    const keys2 = deriveNostrKeypairFromText("test-principal");
    expect(keys1.pk).toBe(keys2.pk);
    expect(keys1.sk).toEqual(keys2.sk);
  });

  it("returns different keys for different principalText", () => {
    const keys1 = deriveNostrKeypairFromText("principal-A");
    const keys2 = deriveNostrKeypairFromText("principal-B");
    expect(keys1.pk).not.toBe(keys2.pk);
  });

  it("returns 32-byte secret key", () => {
    const keys = deriveNostrKeypairFromText("test-principal");
    expect(keys.sk).toBeInstanceOf(Uint8Array);
    expect(keys.sk.length).toBe(32);
  });

  it("returns 64-char hex public key", () => {
    const keys = deriveNostrKeypairFromText("test-principal");
    expect(keys.pk).toHaveLength(64);
    expect(keys.pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty string as input", () => {
    const keys = deriveNostrKeypairFromText("");
    expect(keys.pk).toHaveLength(64);
    expect(keys.sk.length).toBe(32);
  });

  it("handles unicode principalText", () => {
    const keys = deriveNostrKeypairFromText("principal-\u6D4B\u8BD5-unicode");
    expect(keys.pk).toHaveLength(64);
    expect(keys.sk.length).toBe(32);
  });
});

// Tests the cache→fetch→update flow using real profile.ts functions
// (same data-layer operations AgentContext.refreshAgentProfile performs)
describe("profile refresh lifecycle (getCachedAgentProfile → fetchAgentProfile → setCachedAgentProfile)", () => {
  it("both cache and fetch return null when no data exists", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const cached = getCachedAgentProfile("p1");
    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(cached).toBeNull();
    expect(fresh).toBeNull();
  });

  it("cache returns stored profile before relay is queried", async () => {
    const cachedProfile: NostrProfileMetadata = { name: "CachedAgent" };
    setCachedAgentProfile("p1", cachedProfile);

    const cached = getCachedAgentProfile("p1");
    expect(cached).toEqual(cachedProfile);

    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(fresh).toBeNull();
  });

  it("relay profile is stored in cache after fetch", async () => {
    const freshProfile: NostrProfileMetadata = { name: "FreshAgent", about: "Updated bio" };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(freshProfile), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(fresh).toEqual(freshProfile);

    setCachedAgentProfile("p1", fresh!);
    expect(getCachedAgentProfile("p1")).toEqual(freshProfile);
  });

  it("stale cache is replaced when relay returns newer profile", async () => {
    setCachedAgentProfile("p1", { name: "OldAgent" });

    const freshProfile: NostrProfileMetadata = { name: "NewAgent", about: "New bio" };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000100, content: JSON.stringify(freshProfile), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const cached = getCachedAgentProfile("p1");
    expect(cached?.name).toBe("OldAgent");

    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(fresh?.name).toBe("NewAgent");

    setCachedAgentProfile("p1", fresh!);
    expect(getCachedAgentProfile("p1")?.name).toBe("NewAgent");
  });

  it("cache is preserved when relay fetch throws", async () => {
    const cachedProfile: NostrProfileMetadata = { name: "CachedAgent" };
    setCachedAgentProfile("p1", cachedProfile);

    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("relay offline")),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const cached = getCachedAgentProfile("p1");
    expect(cached?.name).toBe("CachedAgent");

    await expect(fetchAgentProfile("a".repeat(64))).rejects.toThrow("relay offline");

    expect(getCachedAgentProfile("p1")?.name).toBe("CachedAgent");
  });

  it("cache is not overwritten when relay returns no profile", async () => {
    setCachedAgentProfile("p1", { name: "Existing" });

    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(fresh).toBeNull();
    // Only update cache when fresh data exists
    if (fresh) setCachedAgentProfile("p1", fresh);

    expect(getCachedAgentProfile("p1")?.name).toBe("Existing");
  });

  it("handles profile with all NIP-01 fields", async () => {
    const full: NostrProfileMetadata = {
      name: "n", display_name: "dn", about: "a",
      picture: "https://img.com/a.jpg", banner: "https://img.com/b.jpg",
      website: "https://example.com", lud16: "x@pay.me", nip05: "x@nostr.com",
    };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(full), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const fresh = await fetchAgentProfile("a".repeat(64));
    expect(fresh).toEqual(full);

    setCachedAgentProfile("p1", fresh!);
    expect(getCachedAgentProfile("p1")).toEqual(full);
  });
});

describe("profile cache isolation", () => {
  it("different principals have independent caches", () => {
    setCachedAgentProfile("alice", { name: "Alice Agent" });
    setCachedAgentProfile("bob", { name: "Bob Agent" });

    expect(getCachedAgentProfile("alice")?.name).toBe("Alice Agent");
    expect(getCachedAgentProfile("bob")?.name).toBe("Bob Agent");

    clearCachedAgentProfile("alice");
    expect(getCachedAgentProfile("alice")).toBeNull();
    expect(getCachedAgentProfile("bob")?.name).toBe("Bob Agent");
  });

  it("clearing one principal does not affect others", () => {
    setCachedAgentProfile("p1", { name: "A" });
    setCachedAgentProfile("p2", { name: "B" });
    setCachedAgentProfile("p3", { name: "C" });

    clearCachedAgentProfile("p2");

    expect(getCachedAgentProfile("p1")?.name).toBe("A");
    expect(getCachedAgentProfile("p2")).toBeNull();
    expect(getCachedAgentProfile("p3")?.name).toBe("C");
  });
});

describe("nostrKeys + profile integration", () => {
  it("derived keys can be used to fetch profile", async () => {
    const keys = deriveNostrKeypairFromText("test-principal");
    const profile: NostrProfileMetadata = { name: "Derived Agent" };

    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, created_at: 1700000000, content: JSON.stringify(profile), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await fetchAgentProfile(keys.pk);
    expect(result?.name).toBe("Derived Agent");
  });

  it("query uses the correct pubkey hex", async () => {
    const keys = deriveNostrKeypairFromText("test-principal");
    const mockQuerySync = jest.fn().mockResolvedValue([]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: mockQuerySync,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await fetchAgentProfile(keys.pk);
    expect(mockQuerySync).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ authors: [keys.pk], kinds: [0] }),
    );
  });
});
