import {
  defaultState,
  getSourceKey,
  computeBackoffDelay,
  computeAdaptiveInterval,
  getSourceHealth,
  loadSourceStates,
  saveSourceStates,
  BACKOFF_MS,
  MAX_CONSECUTIVE_FAILURES,
  type SourceRuntimeState,
} from "@/lib/ingestion/sourceState";

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  },
  writable: true,
});

describe("sourceState — edge cases", () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
  });

  describe("computeBackoffDelay boundaries", () => {
    it("returns 0 for errorCount <= 0", () => {
      expect(computeBackoffDelay(0)).toBe(0);
      expect(computeBackoffDelay(-1)).toBe(0);
    });

    it("returns first backoff tier for errorCount = 1", () => {
      expect(computeBackoffDelay(1)).toBe(BACKOFF_MS[0]); // 60_000
    });

    it("returns second backoff tier for errorCount = 2", () => {
      expect(computeBackoffDelay(2)).toBe(BACKOFF_MS[1]); // 300_000
    });

    it("returns third backoff tier for errorCount = 3", () => {
      expect(computeBackoffDelay(3)).toBe(BACKOFF_MS[2]); // 1_200_000
    });

    it("returns max backoff tier for errorCount = 4", () => {
      expect(computeBackoffDelay(4)).toBe(BACKOFF_MS[3]); // 3_600_000
    });

    it("caps at max backoff for errorCount > BACKOFF_MS.length", () => {
      expect(computeBackoffDelay(10)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
      expect(computeBackoffDelay(100)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
    });

    it("backoff tiers are monotonically increasing", () => {
      for (let i = 1; i < BACKOFF_MS.length; i++) {
        expect(BACKOFF_MS[i]).toBeGreaterThan(BACKOFF_MS[i - 1]);
      }
    });
  });

  describe("computeAdaptiveInterval boundaries", () => {
    it("doubles interval when consecutiveEmpty >= 3", () => {
      const state: SourceRuntimeState = { ...defaultState(), consecutiveEmpty: 3 };
      const interval = computeAdaptiveInterval(state);
      // Default 20min doubled = 40min, capped at 2h
      expect(interval).toBe(20 * 60 * 1000 * 2);
    });

    it("does not exceed MAX_INTERVAL for high consecutiveEmpty", () => {
      const state: SourceRuntimeState = { ...defaultState(), consecutiveEmpty: 100 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBeLessThanOrEqual(2 * 60 * 60 * 1000); // 2h
    });

    it("halves interval when itemsFetched >= 5", () => {
      const state: SourceRuntimeState = { ...defaultState(), itemsFetched: 5 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000 / 2); // 10min
    });

    it("does not go below MIN_INTERVAL for high activity", () => {
      const state: SourceRuntimeState = { ...defaultState(), itemsFetched: 1000 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBeGreaterThanOrEqual(5 * 60 * 1000); // 5min
    });

    it("returns default interval for normal activity", () => {
      const state: SourceRuntimeState = { ...defaultState(), itemsFetched: 3, consecutiveEmpty: 1 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000); // 20min
    });

    it("consecutiveEmpty takes priority over itemsFetched", () => {
      // Both conditions met — consecutiveEmpty >= 3 is checked first
      const state: SourceRuntimeState = { ...defaultState(), consecutiveEmpty: 5, itemsFetched: 10 };
      const interval = computeAdaptiveInterval(state);
      // Should slow down (consecutiveEmpty dominates)
      expect(interval).toBeGreaterThan(20 * 60 * 1000);
    });
  });

  describe("getSourceHealth thresholds", () => {
    it("returns 'healthy' for errorCount 0", () => {
      expect(getSourceHealth(defaultState())).toBe("healthy");
    });

    it("returns 'degraded' for errorCount 1", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 1 })).toBe("degraded");
    });

    it("returns 'degraded' for errorCount 2", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 2 })).toBe("degraded");
    });

    it("returns 'error' for errorCount 3", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 3 })).toBe("error");
    });

    it("returns 'error' for errorCount 4", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 4 })).toBe("error");
    });

    it("returns 'disabled' for errorCount = MAX_CONSECUTIVE_FAILURES", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: MAX_CONSECUTIVE_FAILURES })).toBe("disabled");
    });

    it("returns 'disabled' for errorCount > MAX_CONSECUTIVE_FAILURES", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: 100 })).toBe("disabled");
    });
  });

  describe("getSourceKey", () => {
    it("formats RSS source key", () => {
      expect(getSourceKey("rss", { feedUrl: "https://example.com/feed.xml" }))
        .toBe("rss:https://example.com/feed.xml");
    });

    it("formats Nostr source key", () => {
      expect(getSourceKey("nostr", { relays: "wss://relay.damus.io" }))
        .toBe("nostr:wss://relay.damus.io");
    });

    it("formats URL source key", () => {
      expect(getSourceKey("url", { url: "https://example.com/article" }))
        .toBe("url:https://example.com/article");
    });

    it("handles unknown type", () => {
      expect(getSourceKey("unknown", { any: "value" })).toBe("unknown:unknown");
    });

    it("handles missing config fields", () => {
      expect(getSourceKey("rss", {})).toBe("rss:unknown");
      expect(getSourceKey("nostr", {})).toBe("nostr:unknown");
      expect(getSourceKey("url", {})).toBe("url:unknown");
    });
  });

  describe("localStorage roundtrip", () => {
    it("persists and loads complex state", () => {
      const states: Record<string, SourceRuntimeState> = {
        "rss:https://example.com/feed.xml": {
          ...defaultState(),
          errorCount: 2,
          lastError: "HTTP 503",
          lastErrorAt: 1700000000000,
          lastSuccessAt: 1699999000000,
          lastFetchedAt: 1700000000000,
          itemsFetched: 15,
          consecutiveEmpty: 0,
          nextFetchAt: 1700001200000,
          averageScore: 6.5,
          totalItemsScored: 42,
        },
      };

      saveSourceStates(states);
      const loaded = loadSourceStates();

      expect(loaded["rss:https://example.com/feed.xml"]).toEqual(states["rss:https://example.com/feed.xml"]);
    });

    it("returns empty object for corrupted localStorage", () => {
      store["aegis_source_states"] = "not valid json{{{";
      expect(loadSourceStates()).toEqual({});
    });

    it("returns empty object when localStorage is empty", () => {
      expect(loadSourceStates()).toEqual({});
    });
  });

  describe("defaultState", () => {
    it("returns a fresh object each call (not shared reference)", () => {
      const a = defaultState();
      const b = defaultState();
      expect(a).toEqual(b);
      a.errorCount = 999;
      expect(b.errorCount).toBe(0);
    });
  });
});
