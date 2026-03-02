/**
 * @jest-environment jsdom
 */
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import { _resetDB, idbClear, idbGet, idbPut, STORE_SCORE_CACHE } from "@/lib/storage/idb";

// Use isolateModules to get fresh cache state for each test
function getFreshCache() {
  let mod: typeof import("@/lib/scoring/cache");
  jest.isolateModules(() => {
    mod = require("@/lib/scoring/cache");
  });
  return mod!;
}

function makeResult(composite = 7): import("@/lib/types/api").AnalyzeResponse {
  return {
    originality: 7, insight: 7, credibility: 7, composite,
    verdict: "quality", reason: "test", topics: ["test"],
    scoringEngine: "heuristic",
  };
}

beforeEach(async () => {
  _resetDB();
  await idbClear(STORE_SCORE_CACHE);
  localStorage.clear();
});

describe("initScoringCache — IDB path", () => {
  it("loads cache from IDB when data exists", async () => {
    // Pre-seed IDB
    const data = {
      "key1:h": { result: makeResult(8), storedAt: Date.now(), profileHash: "h" },
    };
    await idbPut(STORE_SCORE_CACHE, "data", data);

    const cache = getFreshCache();
    await cache.initScoringCache();

    const result = cache.lookupScoringCache("key1:h", "h");
    expect(result).not.toBeNull();
    expect(result!.composite).toBe(8);
  });

  it("is idempotent — second init is no-op", async () => {
    const data = { "k:h": { result: makeResult(5), storedAt: Date.now(), profileHash: "h" } };
    await idbPut(STORE_SCORE_CACHE, "data", data);

    const cache = getFreshCache();
    await cache.initScoringCache();
    expect(cache.getScoringCacheStats().size).toBe(1);

    // Modify IDB — should not affect already-initialized cache
    await idbPut(STORE_SCORE_CACHE, "data", {
      ...data,
      "k2:h": { result: makeResult(9), storedAt: Date.now(), profileHash: "h" },
    });

    await cache.initScoringCache();
    expect(cache.getScoringCacheStats().size).toBe(1); // still 1
  });

  it("falls back to localStorage when IDB has no data", async () => {
    // Seed localStorage only
    const lsData = {
      "ls-key:h": { result: makeResult(3), storedAt: Date.now(), profileHash: "h" },
    };
    localStorage.setItem("aegis-score-cache", JSON.stringify(lsData));

    const cache = getFreshCache();
    await cache.initScoringCache();

    const result = cache.lookupScoringCache("ls-key:h", "h");
    expect(result).not.toBeNull();
    expect(result!.composite).toBe(3);
  });

  it("creates empty cache when both IDB and localStorage are empty", async () => {
    const cache = getFreshCache();
    await cache.initScoringCache();

    expect(cache.getScoringCacheStats().size).toBe(0);
    expect(cache.lookupScoringCache("any:key", "key")).toBeNull();
  });

  it("validates entries on IDB load (drops corrupt entries)", async () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const data = {
      "good:h": { result: makeResult(7), storedAt: Date.now(), profileHash: "h" },
      "bad1:h": "not an object",
      "bad2:h": { storedAt: "not-a-number", profileHash: "h", result: {} },
      "bad3:h": null,
    };
    await idbPut(STORE_SCORE_CACHE, "data", data);

    const cache = getFreshCache();
    await cache.initScoringCache();

    expect(cache.lookupScoringCache("good:h", "h")).not.toBeNull();
    expect(cache.getScoringCacheStats().size).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Dropped 3 corrupt"));
    spy.mockRestore();
  });
});

describe("scoring cache — IDB flush (debounced)", () => {
  it("flushes to IDB after debounce when initialized from IDB", async () => {
    jest.useFakeTimers();
    // Seed IDB so cache enters IDB mode
    await idbPut(STORE_SCORE_CACHE, "data", {});

    const cache = getFreshCache();
    await cache.initScoringCache();

    cache.storeScoringCache("new:h", "h", makeResult(9));

    // Advance past debounce (500ms)
    jest.advanceTimersByTime(600);

    // Need to wait for the async IDB put
    jest.useRealTimers();
    await new Promise(r => setTimeout(r, 50));

    const stored = await idbGet<Record<string, unknown>>(STORE_SCORE_CACHE, "data");
    expect(stored).toBeDefined();
    expect(stored!["new:h"]).toBeDefined();
    // Verify the stored entry has correct structure
    const entry = stored!["new:h"] as { result: { composite: number }; profileHash: string; storedAt: number };
    expect(entry.profileHash).toBe("h");
    expect(entry.result.composite).toBe(9);
    expect(typeof entry.storedAt).toBe("number");
  });
});

describe("clearScoringCache — IDB path", () => {
  it("clears IDB data and resets stats", async () => {
    await idbPut(STORE_SCORE_CACHE, "data", {
      "k:h": { result: makeResult(5), storedAt: Date.now(), profileHash: "h" },
    });

    const cache = getFreshCache();
    await cache.initScoringCache();
    expect(cache.getScoringCacheStats().size).toBe(1);

    cache.clearScoringCache();

    // Wait for async IDB clear
    await new Promise(r => setTimeout(r, 50));

    expect(cache.getScoringCacheStats().size).toBe(0);

    // IDB should be cleared too
    const stored = await idbGet<Record<string, unknown>>(STORE_SCORE_CACHE, "data");
    expect(stored).toBeDefined();
    expect(Object.keys(stored!)).toHaveLength(0);
  });
});

describe("getCache() — synchronous fallback", () => {
  it("reads from localStorage synchronously when _memCache is null", () => {
    const data = {
      "sync:h": { result: makeResult(4), storedAt: Date.now(), profileHash: "h" },
    };
    localStorage.setItem("aegis-score-cache", JSON.stringify(data));

    // Fresh module with no init call — getCache() triggered via lookupScoringCache
    const cache = getFreshCache();
    const result = cache.lookupScoringCache("sync:h", "h");
    expect(result).not.toBeNull();
    expect(result!.composite).toBe(4);
  });

  it("returns empty map when localStorage is empty and no init", () => {
    const cache = getFreshCache();
    expect(cache.lookupScoringCache("any:h", "h")).toBeNull();
    expect(cache.getScoringCacheStats().size).toBe(0);
  });
});
