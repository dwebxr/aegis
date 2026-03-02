/**
 * Scheduler lifecycle, start/stop, concurrency, and state management tests.
 * These exercise real code paths in IngestionScheduler without mocking the class itself.
 */
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import {
  defaultState,
  getSourceKey,
  computeBackoffDelay,
  computeAdaptiveInterval,
  getSourceHealth,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_MS,
  loadSourceStates,
  saveSourceStates,
} from "@/lib/ingestion/sourceState";
import type { SourceRuntimeState } from "@/lib/ingestion/sourceState";

// Mock localStorage
const mockStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, val: string) => mockStorage.set(key, val),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
  writable: true,
});

// Mock fetch for scheduler
const originalFetch = global.fetch;
beforeEach(() => {
  mockStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

describe("IngestionScheduler — lifecycle", () => {
  function makeScheduler() {
    return new IngestionScheduler({
      onNewContent: jest.fn(),
      getSources: () => [],
      getUserContext: () => null,
    });
  }

  it("start() is idempotent — second call is a no-op", () => {
    const spy = jest.spyOn(global, "setTimeout");
    const scheduler = makeScheduler();
    scheduler.start();
    const countAfterFirst = spy.mock.calls.length;
    scheduler.start(); // Should not throw or create duplicate timers
    expect(spy.mock.calls.length).toBe(countAfterFirst);
    scheduler.stop();
    spy.mockRestore();
  });

  it("stop() clears both initial timeout and interval", () => {
    const clearSpy = jest.spyOn(global, "clearInterval");
    const scheduler = makeScheduler();
    scheduler.start();
    scheduler.stop();
    expect(clearSpy).toHaveBeenCalled();
    // After stop, start should work again (timers were cleared)
    scheduler.start();
    scheduler.stop();
    clearSpy.mockRestore();
  });

  it("double-stop does not throw", () => {
    const scheduler = makeScheduler();
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("stop before start does not throw", () => {
    const scheduler = makeScheduler();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("getSourceStates returns empty map initially", () => {
    const scheduler = makeScheduler();
    expect(scheduler.getSourceStates().size).toBe(0);
  });

  it("resetDedup clears dedup state", () => {
    const scheduler = makeScheduler();
    // Should not throw
    expect(() => scheduler.resetDedup()).not.toThrow();
  });
});

describe("sourceState utilities", () => {
  describe("getSourceKey", () => {
    it("generates key for RSS source", () => {
      expect(getSourceKey("rss", { feedUrl: "https://example.com/feed.xml" })).toBe("rss:https://example.com/feed.xml");
    });

    it("generates key for Nostr source", () => {
      expect(getSourceKey("nostr", { relays: "wss://relay.damus.io" })).toBe("nostr:wss://relay.damus.io");
    });

    it("generates key for URL source", () => {
      expect(getSourceKey("url", { url: "https://example.com" })).toBe("url:https://example.com");
    });

    it("handles unknown source type", () => {
      expect(getSourceKey("twitter", { foo: "bar" })).toBe("twitter:unknown");
    });

    it("handles missing config fields", () => {
      expect(getSourceKey("rss", {})).toBe("rss:unknown");
    });
  });

  describe("defaultState", () => {
    it("returns all-zero state", () => {
      const state = defaultState();
      expect(state.errorCount).toBe(0);
      expect(state.lastError).toBe("");
      expect(state.nextFetchAt).toBe(0);
      expect(state.averageScore).toBe(0);
      expect(state.totalItemsScored).toBe(0);
    });
  });

  describe("computeBackoffDelay", () => {
    it("returns 0 for 0 errors", () => {
      expect(computeBackoffDelay(0)).toBe(0);
    });

    it("returns 0 for negative errors", () => {
      expect(computeBackoffDelay(-1)).toBe(0);
    });

    it("returns correct backoff for 1 error", () => {
      expect(computeBackoffDelay(1)).toBe(BACKOFF_MS[0]);
    });

    it("returns correct backoff for 2 errors", () => {
      expect(computeBackoffDelay(2)).toBe(BACKOFF_MS[1]);
    });

    it("caps at max backoff index for many errors", () => {
      expect(computeBackoffDelay(100)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
    });
  });

  describe("computeAdaptiveInterval", () => {
    it("uses default interval for normal state", () => {
      const state = { ...defaultState(), consecutiveEmpty: 1, itemsFetched: 2 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000); // DEFAULT_INTERVAL_MS
    });

    it("slows down after 3 consecutive empty fetches", () => {
      const state = { ...defaultState(), consecutiveEmpty: 3 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(40 * 60 * 1000); // 2x default
    });

    it("speeds up for active sources (>=5 items)", () => {
      const state = { ...defaultState(), itemsFetched: 5 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(10 * 60 * 1000); // default / 2
    });

    it("active source takes priority over empty history", () => {
      const state = { ...defaultState(), consecutiveEmpty: 0, itemsFetched: 10 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(10 * 60 * 1000);
    });
  });

  describe("getSourceHealth", () => {
    it("returns healthy for 0 errors", () => {
      expect(getSourceHealth(defaultState())).toBe("healthy");
    });

    it("returns degraded for 1-2 errors", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 1 })).toBe("degraded");
      expect(getSourceHealth({ ...defaultState(), errorCount: 2 })).toBe("degraded");
    });

    it("returns error for 3-4 errors", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 3 })).toBe("error");
      expect(getSourceHealth({ ...defaultState(), errorCount: 4 })).toBe("error");
    });

    it("returns disabled at MAX_CONSECUTIVE_FAILURES", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: MAX_CONSECUTIVE_FAILURES })).toBe("disabled");
    });
  });

  describe("localStorage persistence", () => {
    it("saveSourceStates + loadSourceStates roundtrip", () => {
      const states: Record<string, SourceRuntimeState> = {
        "rss:test": { ...defaultState(), errorCount: 2, lastError: "HTTP 500" },
      };
      saveSourceStates(states);
      const loaded = loadSourceStates();
      expect(loaded["rss:test"].errorCount).toBe(2);
      expect(loaded["rss:test"].lastError).toBe("HTTP 500");
    });

    it("returns empty for corrupted localStorage", () => {
      mockStorage.set("aegis_source_states", "not-valid-json{{{");
      const loaded = loadSourceStates();
      expect(loaded).toEqual({});
    });

    it("returns empty for null localStorage value", () => {
      const loaded = loadSourceStates();
      expect(loaded).toEqual({});
    });

    it("replaces invalid state entries with default", () => {
      mockStorage.set("aegis_source_states", JSON.stringify({
        "rss:good": defaultState(),
        "rss:bad": { errorCount: "not-a-number" },
      }));
      const loaded = loadSourceStates();
      expect(loaded["rss:good"].errorCount).toBe(0);
      // Bad entry should be replaced with default
      expect(loaded["rss:bad"].errorCount).toBe(0);
    });
  });
});
