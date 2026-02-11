import {
  defaultState,
  getSourceKey,
  loadSourceStates,
  saveSourceStates,
  computeBackoffDelay,
  computeAdaptiveInterval,
  getSourceHealth,
  BACKOFF_MS,
  MAX_CONSECUTIVE_FAILURES,
  type SourceRuntimeState,
} from "@/lib/ingestion/sourceState";

// Mock localStorage
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { for (const k in store) delete store[k]; },
    },
    writable: true,
  });
});

afterEach(() => {
  for (const k in store) delete store[k];
});

describe("sourceState", () => {
  describe("defaultState", () => {
    it("returns a clean initial state", () => {
      const state = defaultState();
      expect(state.errorCount).toBe(0);
      expect(state.lastError).toBe("");
      expect(state.averageScore).toBe(0);
      expect(state.nextFetchAt).toBe(0);
    });
  });

  describe("getSourceKey", () => {
    it("returns correct key for rss", () => {
      expect(getSourceKey("rss", { feedUrl: "https://ex.com/feed" })).toBe("rss:https://ex.com/feed");
    });

    it("returns correct key for nostr", () => {
      expect(getSourceKey("nostr", { relays: "wss://r1,wss://r2" })).toBe("nostr:wss://r1,wss://r2");
    });

    it("returns correct key for url", () => {
      expect(getSourceKey("url", { url: "https://blog.com" })).toBe("url:https://blog.com");
    });

    it("handles missing config gracefully", () => {
      expect(getSourceKey("rss", {})).toBe("rss:unknown");
    });
  });

  describe("localStorage round-trip", () => {
    it("saves and loads states correctly", () => {
      const states: Record<string, SourceRuntimeState> = {
        "rss:test": { ...defaultState(), errorCount: 3, lastError: "HTTP 500" },
      };
      saveSourceStates(states);
      const loaded = loadSourceStates();
      expect(loaded["rss:test"].errorCount).toBe(3);
      expect(loaded["rss:test"].lastError).toBe("HTTP 500");
    });

    it("returns empty object when no data stored", () => {
      expect(loadSourceStates()).toEqual({});
    });

    it("returns empty object on corrupted data", () => {
      store["aegis_source_states"] = "{broken json";
      expect(loadSourceStates()).toEqual({});
    });

    it("replaces invalid entries with defaultState", () => {
      store["aegis_source_states"] = JSON.stringify({
        "rss:good": { ...defaultState(), errorCount: 2 },
        "rss:bad": { not: "a valid state" },
        "rss:null": null,
      });
      const loaded = loadSourceStates();
      expect(loaded["rss:good"].errorCount).toBe(2);
      expect(loaded["rss:bad"].errorCount).toBe(0); // replaced with default
      expect(loaded["rss:null"].errorCount).toBe(0); // replaced with default
    });

    it("returns empty on non-object JSON", () => {
      store["aegis_source_states"] = '"just a string"';
      expect(loadSourceStates()).toEqual({});
    });
  });

  describe("computeBackoffDelay", () => {
    it("returns 0 for no errors", () => {
      expect(computeBackoffDelay(0)).toBe(0);
    });

    it("returns correct delays for error counts 1-4", () => {
      expect(computeBackoffDelay(1)).toBe(BACKOFF_MS[0]); // 60_000
      expect(computeBackoffDelay(2)).toBe(BACKOFF_MS[1]); // 300_000
      expect(computeBackoffDelay(3)).toBe(BACKOFF_MS[2]); // 1_200_000
      expect(computeBackoffDelay(4)).toBe(BACKOFF_MS[3]); // 3_600_000
    });

    it("caps at max backoff for high error counts", () => {
      expect(computeBackoffDelay(10)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
      expect(computeBackoffDelay(100)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
    });
  });

  describe("computeAdaptiveInterval", () => {
    it("doubles interval for consecutive empty fetches", () => {
      const state = { ...defaultState(), consecutiveEmpty: 3 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000 * 2); // 40 min
    });

    it("halves interval for active sources", () => {
      const state = { ...defaultState(), itemsFetched: 5 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000 / 2); // 10 min
    });

    it("returns default interval for normal sources", () => {
      const state = { ...defaultState(), itemsFetched: 2, consecutiveEmpty: 1 };
      const interval = computeAdaptiveInterval(state);
      expect(interval).toBe(20 * 60 * 1000); // 20 min
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

    it("returns disabled for >= MAX_CONSECUTIVE_FAILURES", () => {
      expect(getSourceHealth({ ...defaultState(), errorCount: MAX_CONSECUTIVE_FAILURES })).toBe("disabled");
      expect(getSourceHealth({ ...defaultState(), errorCount: 10 })).toBe("disabled");
    });
  });
});
