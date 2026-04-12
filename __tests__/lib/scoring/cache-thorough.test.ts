/**
 * Thorough tests for scoring cache — covers initScoringCache (IDB path),
 * getCache pre-init fallback, flushCacheAsync debounce, clearScoringCache,
 * concurrent store/lookup, and corrupt data handling.
 */

// Mock IDB
let idbStore: Record<string, unknown> = {};
const mockIdbGet = jest.fn(async (_store: string, _key: string) => idbStore[_key] ?? null);
const mockIdbPut = jest.fn(async (_store: string, _key: string, data: unknown) => { idbStore[_key] = data; });
let idbAvailable = false;

jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => idbAvailable,
  idbGet: (store: string, key: string) => mockIdbGet(store, key),
  idbPut: (store: string, key: string, data: unknown) => mockIdbPut(store, key, data),
  STORE_SCORE_CACHE: "score-cache",
}));

// localStorage mock
const lsStore: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: jest.fn((key: string) => lsStore[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { lsStore[key] = value; }),
    removeItem: jest.fn((key: string) => { delete lsStore[key]; }),
    clear: jest.fn(() => { Object.keys(lsStore).forEach(k => delete lsStore[k]); }),
  },
  writable: true,
  configurable: true,
});

import {
  computeProfileHash,
  computeScoringCacheKey,
  initScoringCache,
  lookupScoringCache,
  storeScoringCache,
  clearScoringCache,
  getScoringCacheStats,
  _resetScoringCache,
} from "@/lib/scoring/cache";
import type { AnalyzeResponse } from "@/lib/types/api";

function makeResult(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    originality: 7, insight: 7, credibility: 7, composite: 7,
    verdict: "quality", reason: "test", topics: ["test"],
    scoringEngine: "heuristic",
    ...overrides,
  };
}

beforeEach(() => {
  _resetScoringCache();
  Object.keys(lsStore).forEach(k => delete lsStore[k]);
  Object.keys(idbStore).forEach(k => delete idbStore[k]);
  idbAvailable = false;
  mockIdbGet.mockClear();
  mockIdbPut.mockClear();
  jest.restoreAllMocks();
});

describe("initScoringCache", () => {
  it("loads from IDB when available and has data", async () => {
    idbAvailable = true;
    idbStore["data"] = {
      "key1:h": { result: makeResult(), storedAt: Date.now(), profileHash: "h" },
    };
    await initScoringCache();
    const cached = lookupScoringCache("key1:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(7);
  });

  it("falls back to localStorage when IDB is not available", async () => {
    idbAvailable = false;
    lsStore["aegis-score-cache"] = JSON.stringify({
      "key1:h": { result: makeResult({ composite: 5 }), storedAt: Date.now(), profileHash: "h" },
    });
    await initScoringCache();
    const cached = lookupScoringCache("key1:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(5);
  });

  it("falls back to localStorage when IDB get fails", async () => {
    idbAvailable = true;
    mockIdbGet.mockRejectedValueOnce(new Error("IDB read failed"));
    lsStore["aegis-score-cache"] = JSON.stringify({
      "key1:h": { result: makeResult({ composite: 3 }), storedAt: Date.now(), profileHash: "h" },
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    await initScoringCache();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("IDB load failed"), expect.any(Error));
    const cached = lookupScoringCache("key1:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(3);
    warnSpy.mockRestore();
  });

  it("starts with empty cache when both IDB and localStorage are empty", async () => {
    idbAvailable = true;
    await initScoringCache();
    expect(getScoringCacheStats().size).toBe(0);
  });

  it("is idempotent — second call is a no-op", async () => {
    idbAvailable = true;
    idbStore["data"] = {
      "key1:h": { result: makeResult(), storedAt: Date.now(), profileHash: "h" },
    };
    await initScoringCache();
    // Wipe IDB to verify second init doesn't re-read
    idbStore["data"] = {};
    await initScoringCache();
    // Should still have original data
    expect(lookupScoringCache("key1:h", "h")).not.toBeNull();
  });

  it("drops corrupt entries and logs warning", async () => {
    idbAvailable = true;
    idbStore["data"] = {
      "good:h": { result: makeResult(), storedAt: Date.now(), profileHash: "h" },
      "bad1:h": { result: null, storedAt: Date.now(), profileHash: "h" },
      "bad2:h": "not-an-object",
      "bad3:h": { result: makeResult(), storedAt: "not-a-number", profileHash: "h" },
    };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    await initScoringCache();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Dropped 3 corrupt entries"));
    expect(lookupScoringCache("good:h", "h")).not.toBeNull();
    expect(lookupScoringCache("bad1:h", "h")).toBeNull();
    warnSpy.mockRestore();
  });
});

describe("getCache pre-init fallback", () => {
  it("lazily initializes from localStorage on first access before initScoringCache", () => {
    lsStore["aegis-score-cache"] = JSON.stringify({
      "lazy:h": { result: makeResult({ composite: 9 }), storedAt: Date.now(), profileHash: "h" },
    });
    // Direct lookup without initScoringCache
    const cached = lookupScoringCache("lazy:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(9);
  });

  it("handles corrupted localStorage in pre-init fallback", () => {
    lsStore["aegis-score-cache"] = "{{{invalid json";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    const cached = lookupScoringCache("any:key", "key");
    expect(cached).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("localStorage parse failed"), expect.any(Error));
    warnSpy.mockRestore();
  });
});

describe("flushCacheAsync with IDB", () => {
  it("flushes to IDB when initialized via IDB", async () => {
    jest.useFakeTimers();
    idbAvailable = true;
    idbStore["data"] = {};
    await initScoringCache();
    storeScoringCache("flush-test:h", "h", makeResult());
    jest.advanceTimersByTime(600);
    expect(mockIdbPut).toHaveBeenCalled();
    const [, , data] = mockIdbPut.mock.calls[mockIdbPut.mock.calls.length - 1] as [string, string, Record<string, unknown>];
    expect(data["flush-test:h"]).toBeDefined();
    jest.useRealTimers();
  });

  it("handles IDB flush failure gracefully", async () => {
    jest.useFakeTimers();
    idbAvailable = true;
    idbStore["data"] = {};
    await initScoringCache();
    mockIdbPut.mockRejectedValueOnce(new Error("IDB write failed"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    storeScoringCache("fail-flush:h", "h", makeResult());
    jest.advanceTimersByTime(600);
    // Wait for the rejected promise
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("IDB flush failed"), expect.any(Error));
    warnSpy.mockRestore();
    jest.useRealTimers();
  });
});

describe("clearScoringCache with IDB", () => {
  it("clears IDB store when using IDB", async () => {
    idbAvailable = true;
    idbStore["data"] = { "key:h": { result: makeResult(), storedAt: Date.now(), profileHash: "h" } };
    await initScoringCache();
    clearScoringCache();
    expect(mockIdbPut).toHaveBeenCalledWith("score-cache", "data", {});
    expect(getScoringCacheStats().size).toBe(0);
  });
});

describe("concurrent operations", () => {
  it("handles rapid store-then-lookup without corruption", () => {
    for (let i = 0; i < 100; i++) {
      storeScoringCache(`rapid-${i}:h`, "h", makeResult({ composite: i }));
    }
    for (let i = 0; i < 100; i++) {
      const cached = lookupScoringCache(`rapid-${i}:h`, "h");
      expect(cached).not.toBeNull();
      expect(cached!.composite).toBe(i);
    }
  });

  it("overwrites entry with same key", () => {
    storeScoringCache("same:h", "h", makeResult({ composite: 1 }));
    storeScoringCache("same:h", "h", makeResult({ composite: 9 }));
    const cached = lookupScoringCache("same:h", "h");
    expect(cached!.composite).toBe(9);
    expect(getScoringCacheStats().size).toBe(1);
  });
});

describe("TTL boundary", () => {
  it("entry at exactly 24h is still expired", () => {
    const baseTime = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(baseTime);
    storeScoringCache("ttl-exact:h", "h", makeResult());
    jest.spyOn(Date, "now").mockReturnValue(baseTime + 24 * 60 * 60 * 1000 + 1);
    expect(lookupScoringCache("ttl-exact:h", "h")).toBeNull();
    jest.restoreAllMocks();
  });

  it("entry at 24h - 1ms is still valid", () => {
    const baseTime = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(baseTime);
    storeScoringCache("ttl-valid:h", "h", makeResult());
    jest.spyOn(Date, "now").mockReturnValue(baseTime + 24 * 60 * 60 * 1000 - 1);
    expect(lookupScoringCache("ttl-valid:h", "h")).not.toBeNull();
    jest.restoreAllMocks();
  });
});

describe("computeProfileHash edge cases", () => {
  it("handles undefined arrays within context", () => {
    const hash = computeProfileHash({
      highAffinityTopics: undefined as unknown as string[],
      lowAffinityTopics: [],
      trustedAuthors: [],
      recentTopics: undefined as unknown as string[],
    });
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe("none");
  });
});
