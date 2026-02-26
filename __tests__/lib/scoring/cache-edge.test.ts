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

function makeResult(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    originality: 7, insight: 7, credibility: 7, composite: 7,
    verdict: "quality", reason: "test", topics: ["test"],
    scoringEngine: "heuristic", ...overrides,
  };
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  clearScoringCache();
  jest.restoreAllMocks();
});

describe("scoring cache — eviction boundary conditions", () => {
  it("exactly 500 entries are retained (no eviction)", () => {
    for (let i = 0; i < 500; i++) {
      storeScoringCache(`key-${i}:h`, "h", makeResult({ composite: i }));
    }
    expect(getScoringCacheStats().size).toBe(500);

    // First entry should still exist
    expect(lookupScoringCache("key-0:h", "h")).not.toBeNull();
    // Last entry too
    expect(lookupScoringCache("key-499:h", "h")).not.toBeNull();
  });

  it("evicts exactly 1 entry at 501", () => {
    for (let i = 0; i < 501; i++) {
      storeScoringCache(`key-${i}:h`, "h", makeResult({ composite: i }));
    }
    expect(getScoringCacheStats().size).toBe(500);

    // First entry evicted
    expect(lookupScoringCache("key-0:h", "h")).toBeNull();
    // Second entry still present
    expect(lookupScoringCache("key-1:h", "h")).not.toBeNull();
    // Last entry present
    expect(lookupScoringCache("key-500:h", "h")).not.toBeNull();
  });

  it("evicts multiple entries at bulk insert", () => {
    for (let i = 0; i < 510; i++) {
      storeScoringCache(`key-${i}:h`, "h", makeResult());
    }
    expect(getScoringCacheStats().size).toBe(500);

    // First 10 should be evicted
    for (let i = 0; i < 10; i++) {
      expect(lookupScoringCache(`key-${i}:h`, "h")).toBeNull();
    }
    // Entry 10 should still exist
    expect(lookupScoringCache("key-10:h", "h")).not.toBeNull();
  });

  it("overwriting existing key does not increase size", () => {
    storeScoringCache("same-key:h", "h", makeResult({ composite: 1 }));
    storeScoringCache("same-key:h", "h", makeResult({ composite: 2 }));
    storeScoringCache("same-key:h", "h", makeResult({ composite: 3 }));

    expect(getScoringCacheStats().size).toBe(1);
    const result = lookupScoringCache("same-key:h", "h");
    expect(result!.composite).toBe(3);
  });
});

describe("scoring cache — corrupted localStorage data", () => {
  it("handles null value in localStorage", () => {
    store["aegis-score-cache"] = "null";
    clearScoringCache(); // reset _memCache
    // Re-init by creating fresh cache module state
    // Force re-read by clearing internal cache
    const spy = jest.spyOn(console, "debug").mockImplementation();
    expect(() => storeScoringCache("k:h", "h", makeResult())).not.toThrow();
    spy.mockRestore();
  });

  it("handles array in localStorage instead of object", () => {
    store["aegis-score-cache"] = "[]";
    clearScoringCache();
    expect(() => storeScoringCache("k:h", "h", makeResult())).not.toThrow();
  });

  it("handles number in localStorage", () => {
    store["aegis-score-cache"] = "42";
    clearScoringCache();
    const cached = lookupScoringCache("anything:h", "h");
    expect(cached).toBeNull();
  });
});

describe("scoring cache — TTL edge cases", () => {
  it("entry at exactly TTL boundary is still valid (strict > check)", () => {
    const baseTime = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(baseTime);
    storeScoringCache("ttl:h", "h", makeResult());

    // Exactly 24 hours later — diff === TTL, but code uses strict >, so NOT expired
    const TTL = 24 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(baseTime + TTL);
    const cached = lookupScoringCache("ttl:h", "h");
    expect(cached).not.toBeNull();
  });

  it("entry 1ms before TTL is still valid", () => {
    const baseTime = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(baseTime);
    storeScoringCache("ttl-before:h", "h", makeResult({ composite: 99 }));

    const TTL = 24 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(baseTime + TTL - 1);
    const cached = lookupScoringCache("ttl-before:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(99);
  });
});

describe("scoring cache — profile hash edge cases", () => {
  it("empty topics arrays produce consistent hash", () => {
    const ctx: UserContext = {
      highAffinityTopics: [],
      lowAffinityTopics: [],
      trustedAuthors: [],
      recentTopics: [],
    };
    const h1 = computeProfileHash(ctx);
    const h2 = computeProfileHash(ctx);
    expect(h1).toBe(h2);
    expect(h1).not.toBe("none");
  });

  it("undefined fields in UserContext don't crash", () => {
    const ctx = { highAffinityTopics: undefined, recentTopics: undefined } as unknown as UserContext;
    expect(() => computeProfileHash(ctx)).not.toThrow();
  });

  it("very long topic lists produce stable hash", () => {
    const topics = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
    const ctx: UserContext = {
      highAffinityTopics: topics,
      lowAffinityTopics: [],
      trustedAuthors: [],
      recentTopics: topics.slice(0, 50),
    };
    const h1 = computeProfileHash(ctx);
    const h2 = computeProfileHash(ctx);
    expect(h1).toBe(h2);
  });

  it("cache key with null context uses 'none' as profileHash", () => {
    const key = computeScoringCacheKey("text", null);
    expect(key).toContain(":none");
  });
});

describe("scoring cache — entry-level corruption recovery (cold load)", () => {
  // Tests the isValidEntry() validation added in LARP fix.
  // Uses jest.isolateModules() to get a fresh module with _memCache = null,
  // so getCache() actually reads and validates from localStorage.

  function freshCache(seedData: Record<string, unknown>) {
    store["aegis-score-cache"] = JSON.stringify(seedData);
    let mod: typeof import("@/lib/scoring/cache");
    jest.isolateModules(() => {
      mod = require("@/lib/scoring/cache");
    });
    return mod!;
  }

  it("drops entries missing storedAt field, keeps valid ones", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "good:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 7 } },
      "bad:h": { profileHash: "h", result: { composite: 5 } },
    });

    expect(mod.lookupScoringCache("good:h", "h")).not.toBeNull();
    expect(mod.lookupScoringCache("bad:h", "h")).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 1 corrupt"));
    spy.mockRestore();
  });

  it("drops entries missing profileHash field", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "good:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 7 } },
      "bad:h": { storedAt: Date.now(), result: { composite: 5 } },
    });

    mod.lookupScoringCache("good:h", "h"); // triggers getCache
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 1 corrupt"));
    spy.mockRestore();
  });

  it("drops entries with null result", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "bad:h": { storedAt: Date.now(), profileHash: "h", result: null },
    });

    expect(mod.lookupScoringCache("bad:h", "h")).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 1 corrupt"));
    spy.mockRestore();
  });

  it("drops entries that are plain strings instead of objects", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "good:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 7 } },
      "bad:h": "not an object",
    });

    expect(mod.lookupScoringCache("good:h", "h")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 1 corrupt"));
    spy.mockRestore();
  });

  it("drops multiple corrupt entries in a single load", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "valid-1:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 1 } },
      "corrupt-1:h": { storedAt: "not-a-number", profileHash: "h", result: {} },
      "corrupt-2:h": null,
      "corrupt-3:h": 42,
      "valid-2:h": { storedAt: Date.now(), profileHash: "h", result: { verdict: "ok" } },
    });

    expect(mod.lookupScoringCache("valid-1:h", "h")).not.toBeNull();
    expect(mod.lookupScoringCache("valid-2:h", "h")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 3 corrupt"));
    spy.mockRestore();
  });

  it("keeps all entries when none are corrupt (no warning logged)", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const mod = freshCache({
      "a:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 1 } },
      "b:h": { storedAt: Date.now(), profileHash: "h", result: { composite: 2 } },
    });

    expect(mod.lookupScoringCache("a:h", "h")).not.toBeNull();
    expect(mod.lookupScoringCache("b:h", "h")).not.toBeNull();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("Dropped"));
    expect(mod.getScoringCacheStats().size).toBe(2);
    spy.mockRestore();
  });
});

describe("scoring cache — stats accuracy", () => {
  it("hit/miss counts are accurate after mixed operations", () => {
    storeScoringCache("a:h", "h", makeResult());
    storeScoringCache("b:h", "h", makeResult());

    lookupScoringCache("a:h", "h");    // hit
    lookupScoringCache("a:h", "h");    // hit
    lookupScoringCache("b:h", "h");    // hit
    lookupScoringCache("c:h", "h");    // miss
    lookupScoringCache("d:h", "h");    // miss
    lookupScoringCache("a:h", "wrong"); // miss (wrong profileHash)

    const stats = getScoringCacheStats();
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(3);
    expect(stats.size).toBe(2);
  });

  it("clearScoringCache resets all counters", () => {
    storeScoringCache("x:h", "h", makeResult());
    lookupScoringCache("x:h", "h");
    lookupScoringCache("y:h", "h");

    clearScoringCache();
    const stats = getScoringCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.size).toBe(0);
  });
});
