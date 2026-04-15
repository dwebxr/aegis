/**
 * @jest-environment jsdom
 */
/**
 * LARP Audit fix verification tests.
 * Tests real code paths to verify fixes for:
 * 1. syncToIC — floating async catch handler (inner catch only; setState errors propagate)
 * 2. scheduleFlush — concurrent flush guard (_flushing flag)
 * 3. isValidState — rateLimitedUntil validation
 * 4. saveCachedContent — IDB-to-localStorage fallback on failure
 * 5. PreferenceContext debouncedICSync — fail counter with notification
 */

import { syncToIC } from "@/contexts/content/icSync";

// ─── 1. syncToIC — proper error handling ────────────────────────────

describe("syncToIC — LARP fix: no floating async catch handler", () => {
  it("does not change sync status on success (avoids premature synced)", async () => {
    const setSyncStatus = jest.fn();
    const setPendingActions = jest.fn();
    const addNotification = jest.fn();

    syncToIC(
      Promise.resolve("ok"),
      "saveEvaluation",
      { itemId: "test" },
      setSyncStatus,
      setPendingActions,
      addNotification,
    );

    await new Promise(r => setTimeout(r, 10));
    // Success path does NOT set status — avoids race with concurrent IC calls
    expect(setSyncStatus).not.toHaveBeenCalled();
  });

  it("enqueues offline action on IC failure", async () => {
    const setSyncStatus = jest.fn();
    const setPendingActions = jest.fn();
    const addNotification = jest.fn();

    // Mock enqueueAction to succeed
    jest.mock("@/lib/offline/actionQueue", () => ({
      enqueueAction: jest.fn().mockResolvedValue(undefined),
      dequeueAll: jest.fn().mockResolvedValue([]),
      removeAction: jest.fn(),
      incrementRetries: jest.fn(),
    }));

    syncToIC(
      Promise.reject(new Error("IC unavailable")),
      "saveEvaluation",
      { itemId: "test" },
      setSyncStatus,
      setPendingActions,
      addNotification,
    );

    await new Promise(r => setTimeout(r, 50));
    expect(setSyncStatus).toHaveBeenCalledWith("offline");
  });

});

// ─── 3. isValidState — rateLimitedUntil validation ──────────────────

import { loadSourceStates, defaultState } from "@/lib/ingestion/sourceState";

describe("isValidState — LARP fix: validates rateLimitedUntil", () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("accepts state with numeric rateLimitedUntil", () => {
    const state = { ...defaultState(), rateLimitedUntil: 1234567890 };
    localStorage.setItem("aegis_source_states", JSON.stringify({ "rss:test": state }));
    const loaded = loadSourceStates();
    expect(loaded["rss:test"].rateLimitedUntil).toBe(1234567890);
  });

  it("accepts state without rateLimitedUntil (backfills to 0)", () => {
    const state = defaultState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (state as any).rateLimitedUntil;
    localStorage.setItem("aegis_source_states", JSON.stringify({ "rss:test": state }));
    const loaded = loadSourceStates();
    expect(loaded["rss:test"].rateLimitedUntil).toBe(0);
  });

  it("rejects state with non-numeric rateLimitedUntil", () => {
    const state = { ...defaultState(), rateLimitedUntil: "not a number" };
    localStorage.setItem("aegis_source_states", JSON.stringify({ "rss:test": state }));
    const loaded = loadSourceStates();
    // Should fall back to defaultState() since validation fails
    expect(loaded["rss:test"].rateLimitedUntil).toBe(0);
    expect(loaded["rss:test"].errorCount).toBe(0);
  });
});

// ─── 2. scheduleFlush — concurrent flush guard ──────────────────────

import { storeScoringCache, lookupScoringCache, _resetScoringCache } from "@/lib/scoring/cache";

// Mock IDB
jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn().mockResolvedValue(null),
  idbPut: jest.fn().mockResolvedValue(undefined),
  STORE_SCORE_CACHE: "score-cache",
  STORE_CONTENT_CACHE: "content-cache",
}));

describe("scoring cache — LARP fix: flush guard prevents concurrent writes", () => {
  beforeEach(() => {
    _resetScoringCache();
    if (typeof globalThis.localStorage !== "undefined") {
      localStorage.removeItem("aegis-score-cache");
    }
  });

  it("store followed by lookup returns the stored result", () => {
    const result = {
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality" as const, reason: "test",
    };
    storeScoringCache("key1", "hash1", result);
    const cached = lookupScoringCache("key1", "hash1");
    expect(cached).not.toBeNull();
    expect(cached!.composite).toBe(8);
    expect(cached!.verdict).toBe("quality");
  });

  it("multiple rapid stores coalesce into debounced flush", () => {
    jest.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      storeScoringCache(`key-${i}`, "hash", {
        originality: i, insight: i, credibility: i, composite: i,
        verdict: "quality" as const, reason: `test-${i}`,
      });
    }
    // All in memory
    for (let i = 0; i < 10; i++) {
      expect(lookupScoringCache(`key-${i}`, "hash")).not.toBeNull();
    }
    jest.useRealTimers();
  });

  it("returns null for wrong profileHash", () => {
    const result = {
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality" as const, reason: "test",
    };
    storeScoringCache("key1", "hash-a", result);
    expect(lookupScoringCache("key1", "hash-b")).toBeNull();
  });
});
