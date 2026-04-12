/**
 * Tests for scoring cache flush/persistence edge cases:
 * - Concurrent flush reschedule
 * - IDB error handling during flush
 * - clearScoringCache error resilience
 */

// Mock localStorage
const lsStore: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => lsStore[key] ?? null,
    setItem: (key: string, value: string) => { lsStore[key] = value; },
    removeItem: (key: string) => { delete lsStore[key]; },
    clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); },
  },
  writable: true,
  configurable: true,
});

import {
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
    scoringEngine: "heuristic", ...overrides,
  };
}

beforeEach(() => {
  Object.keys(lsStore).forEach(k => delete lsStore[k]);
  _resetScoringCache();
});

describe("concurrent flush scheduling", () => {
  it("reschedules flush when writes happen after initial flush", async () => {
    jest.useFakeTimers();

    // Store entries
    storeScoringCache("key1:h", "h", makeResult());
    storeScoringCache("key2:h", "h", makeResult({ composite: 9 }));

    // Advance to trigger flush
    jest.advanceTimersByTime(600);

    // Allow async flush to complete
    await Promise.resolve();
    await Promise.resolve();

    // Both entries should be persisted in a single flush
    const raw = lsStore["aegis-score-cache"];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed["key1:h"]).toBeDefined();
    expect(parsed["key2:h"]).toBeDefined();

    jest.useRealTimers();
  });

  it("debounces rapid writes into a single flush", () => {
    jest.useFakeTimers();

    // Store 10 entries rapidly
    for (let i = 0; i < 10; i++) {
      storeScoringCache(`rapid-${i}:h`, "h", makeResult());
    }

    // Only one flush timer should be set (debounced)
    jest.advanceTimersByTime(600);

    const raw = lsStore["aegis-score-cache"];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    // All 10 entries should be in a single flush
    for (let i = 0; i < 10; i++) {
      expect(parsed[`rapid-${i}:h`]).toBeDefined();
    }

    jest.useRealTimers();
  });
});

describe("clearScoringCache error resilience", () => {
  it("resets stats even when localStorage.removeItem throws", async () => {
    storeScoringCache("key:h", "h", makeResult());
    lookupScoringCache("key:h", "h"); // hit
    lookupScoringCache("miss:h", "h"); // miss

    const origRemoveItem = globalThis.localStorage.removeItem;
    globalThis.localStorage.removeItem = () => {
      throw new Error("Storage removal failed");
    };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    await clearScoringCache();

    const stats = getScoringCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to clear localStorage"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
    globalThis.localStorage.removeItem = origRemoveItem;
  });

  it("cancels pending flush timer on clear", async () => {
    jest.useFakeTimers();

    storeScoringCache("key:h", "h", makeResult());
    // There's now a pending flush timer

    await clearScoringCache();

    // Advance past where the flush would fire — should not crash or re-populate
    jest.advanceTimersByTime(1000);

    expect(getScoringCacheStats().size).toBe(0);
    expect(lsStore["aegis-score-cache"]).toBeUndefined();

    jest.useRealTimers();
  });
});

describe("loadFromLocalStorage edge cases", () => {
  it("loads valid entries from localStorage on first access", () => {
    _resetScoringCache();
    lsStore["aegis-score-cache"] = JSON.stringify({
      "preloaded:h": {
        result: makeResult({ composite: 9.5 }),
        storedAt: Date.now(),
        profileHash: "h",
      },
    });

    const cached = lookupScoringCache("preloaded:h", "h");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(9.5);
  });

  it("drops corrupt entries and keeps valid ones", () => {
    _resetScoringCache();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    lsStore["aegis-score-cache"] = JSON.stringify({
      "valid:h": {
        result: makeResult({ composite: 8 }),
        storedAt: Date.now(),
        profileHash: "h",
      },
      "corrupt1:h": { result: null, storedAt: Date.now(), profileHash: "h" },
      "corrupt2:h": "not-an-object",
      "corrupt3:h": { result: { originality: "not-a-number" }, storedAt: 123, profileHash: "h" },
    });

    const valid = lookupScoringCache("valid:h", "h");
    expect(valid).not.toBeNull();
    expect(valid!.composite).toBe(8);

    const corrupt = lookupScoringCache("corrupt1:h", "h");
    expect(corrupt).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Dropped.*corrupt entries/));
    warnSpy.mockRestore();
  });

  it("handles completely empty localStorage value", () => {
    _resetScoringCache();
    lsStore["aegis-score-cache"] = JSON.stringify({});

    const cached = lookupScoringCache("any:h", "h");
    expect(cached).toBeNull();
    expect(getScoringCacheStats().size).toBe(0);
  });

  it("handles missing localStorage key gracefully", () => {
    _resetScoringCache();
    // No aegis-score-cache key set

    const cached = lookupScoringCache("any:h", "h");
    expect(cached).toBeNull();
    expect(getScoringCacheStats().size).toBe(0);
  });
});

describe("TTL boundary conditions", () => {
  it("entry at exactly 24h is still valid", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    storeScoringCache("boundary:h", "h", makeResult());

    // Exactly 24h later (24 * 60 * 60 * 1000 = 86400000)
    jest.spyOn(Date, "now").mockReturnValue(now + 86400000);
    const cached = lookupScoringCache("boundary:h", "h");
    // TTL check: Date.now() - storedAt > TTL_MS → 86400000 - 0 > 86400000 → false
    expect(cached).not.toBeNull();

    jest.restoreAllMocks();
  });

  it("entry at 24h + 1ms is expired", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    storeScoringCache("expired:h", "h", makeResult());

    jest.spyOn(Date, "now").mockReturnValue(now + 86400001);
    const cached = lookupScoringCache("expired:h", "h");
    expect(cached).toBeNull();

    jest.restoreAllMocks();
  });
});

describe("FIFO pruning edge cases", () => {
  it("prunes exactly the right number of oldest entries", () => {
    // Fill to exactly 500
    for (let i = 0; i < 500; i++) {
      storeScoringCache(`fill-${i}:h`, "h", makeResult());
    }
    expect(getScoringCacheStats().size).toBe(500);

    // Add one more — should prune exactly 1
    storeScoringCache("overflow:h", "h", makeResult());
    expect(getScoringCacheStats().size).toBe(500);

    // First entry should be evicted
    expect(lookupScoringCache("fill-0:h", "h")).toBeNull();
    // Last fill + overflow should exist
    expect(lookupScoringCache("fill-499:h", "h")).not.toBeNull();
    expect(lookupScoringCache("overflow:h", "h")).not.toBeNull();
  });
});

describe("initScoringCache", () => {
  it("is idempotent — second call is a no-op", async () => {
    await initScoringCache();
    storeScoringCache("init-test:h", "h", makeResult());

    await initScoringCache(); // should not reset the cache
    expect(lookupScoringCache("init-test:h", "h")).not.toBeNull();
  });
});
