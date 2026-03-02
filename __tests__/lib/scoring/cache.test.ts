// Mock localStorage (node test env)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
  configurable: true,
});

import {
  computeProfileHash,
  computeScoringCacheKey,
  lookupScoringCache,
  storeScoringCache,
  clearScoringCache,
  getScoringCacheStats,
} from "@/lib/scoring/cache";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";

const STORAGE_KEY = "aegis-score-cache";

function makeResult(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    originality: 7,
    insight: 7,
    credibility: 7,
    composite: 7,
    verdict: "quality",
    reason: "test",
    topics: ["test"],
    scoringEngine: "heuristic",
    ...overrides,
  };
}

function makeUserContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    highAffinityTopics: ["ai", "ml"],
    lowAffinityTopics: ["spam"],
    trustedAuthors: ["alice"],
    recentTopics: ["transformers"],
    ...overrides,
  };
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  clearScoringCache();
});

describe("computeProfileHash", () => {
  it("returns 'none' for null userContext", () => {
    expect(computeProfileHash(null)).toBe("none");
  });

  it("returns 'none' for undefined userContext", () => {
    expect(computeProfileHash(undefined)).toBe("none");
  });

  it("produces consistent hash for same context", () => {
    const ctx = makeUserContext();
    expect(computeProfileHash(ctx)).toBe(computeProfileHash(ctx));
  });

  it("produces different hashes for different topic arrays", () => {
    const ctx1 = makeUserContext({ highAffinityTopics: ["ai"] });
    const ctx2 = makeUserContext({ highAffinityTopics: ["crypto"] });
    expect(computeProfileHash(ctx1)).not.toBe(computeProfileHash(ctx2));
  });

  it("is order-insensitive (topics are sorted before hashing)", () => {
    const ctx1 = makeUserContext({ highAffinityTopics: ["ai", "ml"] });
    const ctx2 = makeUserContext({ highAffinityTopics: ["ml", "ai"] });
    expect(computeProfileHash(ctx1)).toBe(computeProfileHash(ctx2));
  });

  it("handles empty arrays", () => {
    const ctx = makeUserContext({
      highAffinityTopics: [],
      lowAffinityTopics: [],
      trustedAuthors: [],
      recentTopics: [],
    });
    const hash = computeProfileHash(ctx);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).not.toBe("none");
  });
});

describe("computeScoringCacheKey", () => {
  it("combines content fingerprint and profile hash", () => {
    const key = computeScoringCacheKey("Hello world", makeUserContext());
    expect(key).toContain(":");
    const [fingerprint, profileHash] = key.split(":");
    expect(fingerprint.length).toBeGreaterThan(0);
    expect(profileHash.length).toBeGreaterThan(0);
  });

  it("same text + same context = same key", () => {
    const ctx = makeUserContext();
    const k1 = computeScoringCacheKey("Same content", ctx);
    const k2 = computeScoringCacheKey("Same content", ctx);
    expect(k1).toBe(k2);
  });

  it("different text = different key", () => {
    const ctx = makeUserContext();
    const k1 = computeScoringCacheKey("Content A", ctx);
    const k2 = computeScoringCacheKey("Content B", ctx);
    expect(k1).not.toBe(k2);
  });

  it("same text + different context = different key", () => {
    const k1 = computeScoringCacheKey("Same content", makeUserContext({ highAffinityTopics: ["ai"] }));
    const k2 = computeScoringCacheKey("Same content", makeUserContext({ highAffinityTopics: ["crypto"] }));
    expect(k1).not.toBe(k2);
  });

  it("uses precomputedHash when provided (skips re-hashing)", () => {
    const ctx = makeUserContext();
    const normalKey = computeScoringCacheKey("text", ctx);
    const precomputed = "custom-hash-123";
    const customKey = computeScoringCacheKey("text", ctx, precomputed);
    // Custom key should use the precomputed hash, not the ctx hash
    expect(customKey).toContain(precomputed);
    expect(normalKey).not.toBe(customKey);
  });

  it("normalizes text (case, punctuation, whitespace) for fingerprint", () => {
    const k1 = computeScoringCacheKey("Hello, World!", null);
    const k2 = computeScoringCacheKey("hello  world", null);
    expect(k1).toBe(k2);
  });

  it("truncates text to 500 chars for fingerprint", () => {
    const longText = "a".repeat(1000);
    const truncatedText = "a".repeat(500);
    // Both should produce same fingerprint since only first 500 chars matter
    const k1 = computeScoringCacheKey(longText, null);
    const k2 = computeScoringCacheKey(truncatedText, null);
    expect(k1).toBe(k2);
  });
});

describe("lookupScoringCache / storeScoringCache", () => {
  it("returns cached result for matching key + profileHash", () => {
    const key = "test-key:hash";
    const profileHash = "hash";
    const result = makeResult();

    storeScoringCache(key, profileHash, result);
    const cached = lookupScoringCache(key, profileHash);

    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(7);
    expect(cached!.verdict).toBe("quality");
  });

  it("returns null when profileHash mismatches", () => {
    const key = "test-key:hash1";
    storeScoringCache(key, "hash1", makeResult());

    const cached = lookupScoringCache(key, "hash2");
    expect(cached).toBeNull();
  });

  it("returns null for non-existent key", () => {
    const cached = lookupScoringCache("nonexistent:key", "any");
    expect(cached).toBeNull();
  });

  it("returns null and deletes entry when TTL (24h) expired", () => {
    const key = "expired:hash";
    storeScoringCache(key, "hash", makeResult());

    // Simulate 25 hours passing
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000);

    const cached = lookupScoringCache(key, "hash");
    expect(cached).toBeNull();

    // Entry should be deleted — restore time and verify
    jest.spyOn(Date, "now").mockReturnValue(now);
    const rechecked = lookupScoringCache(key, "hash");
    expect(rechecked).toBeNull(); // entry was deleted, not just expired

    jest.restoreAllMocks();
  });

  it("preserves all AnalyzeResponse fields through cache round-trip", () => {
    const result = makeResult({
      originality: 8,
      insight: 6,
      credibility: 9,
      composite: 7.5,
      verdict: "quality",
      reason: "Detailed analysis",
      vSignal: 8.2,
      cContext: 3.1,
      lSlop: 1.5,
      topics: ["ai", "ml"],
      scoringEngine: "claude-server",
    });

    const key = "full-result:hash";
    storeScoringCache(key, "hash", result);
    const cached = lookupScoringCache(key, "hash")!;

    expect(cached.originality).toBe(8);
    expect(cached.insight).toBe(6);
    expect(cached.credibility).toBe(9);
    expect(cached.composite).toBe(7.5);
    expect(cached.vSignal).toBe(8.2);
    expect(cached.cContext).toBe(3.1);
    expect(cached.lSlop).toBe(1.5);
    expect(cached.topics).toEqual(["ai", "ml"]);
    expect(cached.scoringEngine).toBe("claude-server");
  });
});

describe("FIFO pruning", () => {
  it("prunes oldest entries when exceeding MAX_ENTRIES (500)", () => {
    // Store 501 entries with staggered timestamps
    const baseTime = Date.now();
    for (let i = 0; i < 501; i++) {
      jest.spyOn(Date, "now").mockReturnValue(baseTime + i);
      storeScoringCache(`key-${i}:hash`, "hash", makeResult({ composite: i }));
    }
    jest.restoreAllMocks();

    const stats = getScoringCacheStats();
    expect(stats.size).toBe(500);

    // Oldest entry (key-0) should be evicted
    const oldest = lookupScoringCache("key-0:hash", "hash");
    expect(oldest).toBeNull();

    // Newest entry (key-500) should still exist
    const newest = lookupScoringCache("key-500:hash", "hash");
    expect(newest).not.toBeNull();
    expect(newest!.composite).toBe(500);
  });
});

describe("getScoringCacheStats", () => {
  it("returns correct hits, misses, size", () => {
    storeScoringCache("key1:h", "h", makeResult());
    storeScoringCache("key2:h", "h", makeResult());

    // 2 hits
    lookupScoringCache("key1:h", "h");
    lookupScoringCache("key2:h", "h");
    // 1 miss
    lookupScoringCache("nonexistent:h", "h");

    const stats = getScoringCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });
});

describe("clearScoringCache", () => {
  it("empties memory + localStorage + resets counters", () => {
    storeScoringCache("key:h", "h", makeResult());
    lookupScoringCache("key:h", "h"); // hit
    lookupScoringCache("miss:h", "h"); // miss

    clearScoringCache();

    const stats = getScoringCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);

    expect(store[STORAGE_KEY]).toBeUndefined();
  });
});

describe("localStorage integration", () => {
  it("persists cache to localStorage via flushCache", () => {
    jest.useFakeTimers();
    storeScoringCache("persist:h", "h", makeResult());
    jest.advanceTimersByTime(600); // debounce is 500ms

    const raw = store[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed["persist:h"]).toBeDefined();
    expect(parsed["persist:h"].profileHash).toBe("h");
    jest.useRealTimers();
  });

  it("handles corrupted localStorage gracefully (returns empty cache)", () => {
    store[STORAGE_KEY] = "not-valid-json{{{";

    // Should not throw — falls back to empty cache
    const cached = lookupScoringCache("any:key", "key");
    expect(cached).toBeNull();
  });

  it("handles QuotaExceededError during save — logs warning, does not throw", () => {
    jest.useFakeTimers();
    const originalSetItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    expect(() => storeScoringCache("quota:h", "h", makeResult())).not.toThrow();
    jest.advanceTimersByTime(600); // trigger debounced flush
    expect(warnSpy).toHaveBeenCalledWith(
      "[scoring-cache] localStorage flush failed (quota?):",
      expect.any(DOMException),
    );

    warnSpy.mockRestore();
    globalThis.localStorage.setItem = originalSetItem;
    jest.useRealTimers();
  });

  it("in-memory cache avoids repeated JSON.parse (second call uses _memCache)", () => {
    storeScoringCache("mem:h", "h", makeResult());

    // First lookup loads from localStorage into memory
    const spy = jest.spyOn(JSON, "parse");
    lookupScoringCache("mem:h", "h");
    const parseCallsBefore = spy.mock.calls.length;

    // Second lookup should use in-memory cache (no additional JSON.parse)
    lookupScoringCache("mem:h", "h");
    const parseCallsAfter = spy.mock.calls.length;

    expect(parseCallsAfter).toBe(parseCallsBefore);
    spy.mockRestore();
  });
});

describe("end-to-end: computeKey → store → lookup", () => {
  it("full round-trip with real text and user context", () => {
    const text = "Breakthrough in quantum computing achieves 1000 logical qubits";
    const ctx = makeUserContext({ highAffinityTopics: ["quantum", "computing"] });
    const profileHash = computeProfileHash(ctx);
    const key = computeScoringCacheKey(text, ctx, profileHash);
    const result = makeResult({ composite: 8.5, topics: ["quantum"] });

    storeScoringCache(key, profileHash, result);

    // Same text + same context → cache hit
    const key2 = computeScoringCacheKey(text, ctx, profileHash);
    const cached = lookupScoringCache(key2, profileHash);
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(8.5);
  });

  it("profile change invalidates cache (different profileHash)", () => {
    const text = "Same content text";
    const ctx1 = makeUserContext({ highAffinityTopics: ["ai"] });
    const ctx2 = makeUserContext({ highAffinityTopics: ["crypto"] });
    const hash1 = computeProfileHash(ctx1);
    const hash2 = computeProfileHash(ctx2);

    const key = computeScoringCacheKey(text, ctx1, hash1);
    storeScoringCache(key, hash1, makeResult());

    // Same text but different profile → cache miss
    const key2 = computeScoringCacheKey(text, ctx2, hash2);
    const cached = lookupScoringCache(key2, hash2);
    expect(cached).toBeNull();
  });
});
