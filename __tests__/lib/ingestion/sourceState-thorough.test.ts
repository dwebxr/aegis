/**
 * Thorough tests for sourceState — backoff calculation, adaptive intervals,
 * health classification boundaries, key generation, and persistence.
 */
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
  BASE_CYCLE_MS,
  type SourceRuntimeState,
} from "@/lib/ingestion/sourceState";

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("defaultState", () => {
  it("all numeric fields start at 0", () => {
    const s = defaultState();
    expect(s.errorCount).toBe(0);
    expect(s.lastErrorAt).toBe(0);
    expect(s.lastSuccessAt).toBe(0);
    expect(s.lastFetchedAt).toBe(0);
    expect(s.itemsFetched).toBe(0);
    expect(s.consecutiveEmpty).toBe(0);
    expect(s.nextFetchAt).toBe(0);
    expect(s.averageScore).toBe(0);
    expect(s.totalItemsScored).toBe(0);
  });

  it("lastError is empty string", () => {
    expect(defaultState().lastError).toBe("");
  });
});

describe("getSourceKey", () => {
  it("rss uses feedUrl", () => {
    expect(getSourceKey("rss", { feedUrl: "https://example.com/feed" })).toBe("rss:https://example.com/feed");
  });

  it("nostr uses relays", () => {
    expect(getSourceKey("nostr", { relays: "wss://relay.example.com" })).toBe("nostr:wss://relay.example.com");
  });

  it("url uses url", () => {
    expect(getSourceKey("url", { url: "https://example.com" })).toBe("url:https://example.com");
  });

  it("missing config field → 'unknown'", () => {
    expect(getSourceKey("rss", {})).toBe("rss:unknown");
    expect(getSourceKey("nostr", {})).toBe("nostr:unknown");
    expect(getSourceKey("url", {})).toBe("url:unknown");
  });

  it("unknown type → 'type:unknown'", () => {
    expect(getSourceKey("foobar", { whatever: "x" })).toBe("foobar:unknown");
  });
});

describe("computeBackoffDelay", () => {
  it("errorCount 0 → no delay", () => {
    expect(computeBackoffDelay(0)).toBe(0);
  });

  it("negative errorCount → no delay", () => {
    expect(computeBackoffDelay(-1)).toBe(0);
  });

  it("errorCount 1 → first backoff (60s)", () => {
    expect(computeBackoffDelay(1)).toBe(BACKOFF_MS[0]);
    expect(computeBackoffDelay(1)).toBe(60_000);
  });

  it("errorCount 2 → second backoff (5min)", () => {
    expect(computeBackoffDelay(2)).toBe(BACKOFF_MS[1]);
    expect(computeBackoffDelay(2)).toBe(300_000);
  });

  it("errorCount 3 → third backoff (20min)", () => {
    expect(computeBackoffDelay(3)).toBe(BACKOFF_MS[2]);
    expect(computeBackoffDelay(3)).toBe(1_200_000);
  });

  it("errorCount 4 → fourth backoff (1hr)", () => {
    expect(computeBackoffDelay(4)).toBe(BACKOFF_MS[3]);
    expect(computeBackoffDelay(4)).toBe(3_600_000);
  });

  it("errorCount beyond array → caps at last value", () => {
    expect(computeBackoffDelay(10)).toBe(BACKOFF_MS[3]);
    expect(computeBackoffDelay(100)).toBe(BACKOFF_MS[3]);
  });
});

describe("computeAdaptiveInterval", () => {
  const DEFAULT_MS = 20 * 60 * 1000; // 20min
  const MAX_MS = 2 * 60 * 60 * 1000;   // 2hr
  const MIN_MS = 5 * 60 * 1000;         // 5min

  it("default state → default interval (20min)", () => {
    expect(computeAdaptiveInterval(defaultState())).toBe(DEFAULT_MS);
  });

  it("consecutiveEmpty = 2 → still default", () => {
    const s = { ...defaultState(), consecutiveEmpty: 2 };
    expect(computeAdaptiveInterval(s)).toBe(DEFAULT_MS);
  });

  it("consecutiveEmpty = 3 → slowed down (40min, capped at 2hr)", () => {
    const s = { ...defaultState(), consecutiveEmpty: 3 };
    const interval = computeAdaptiveInterval(s);
    expect(interval).toBe(Math.min(DEFAULT_MS * 2, MAX_MS));
    expect(interval).toBe(40 * 60 * 1000);
  });

  it("consecutiveEmpty = 100 → still 40min (max is 2hr)", () => {
    const s = { ...defaultState(), consecutiveEmpty: 100 };
    expect(computeAdaptiveInterval(s)).toBe(40 * 60 * 1000);
  });

  it("itemsFetched = 4 → default", () => {
    const s = { ...defaultState(), itemsFetched: 4 };
    expect(computeAdaptiveInterval(s)).toBe(DEFAULT_MS);
  });

  it("itemsFetched = 5 → sped up (10min, min is 5min)", () => {
    const s = { ...defaultState(), itemsFetched: 5 };
    const interval = computeAdaptiveInterval(s);
    expect(interval).toBe(Math.max(DEFAULT_MS / 2, MIN_MS));
    expect(interval).toBe(10 * 60 * 1000);
  });

  it("itemsFetched = 1000 → 10min (sped up but respects min)", () => {
    const s = { ...defaultState(), itemsFetched: 1000 };
    expect(computeAdaptiveInterval(s)).toBe(10 * 60 * 1000);
  });

  it("consecutiveEmpty takes priority over itemsFetched", () => {
    // consecutiveEmpty >= 3 is checked first
    const s = { ...defaultState(), consecutiveEmpty: 3, itemsFetched: 10 };
    expect(computeAdaptiveInterval(s)).toBe(40 * 60 * 1000);
  });
});

describe("getSourceHealth — boundary conditions", () => {
  it("0 errors → healthy", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 0 })).toBe("healthy");
  });

  it("1 error → degraded", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 1 })).toBe("degraded");
  });

  it("2 errors → degraded", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 2 })).toBe("degraded");
  });

  it("3 errors → error", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 3 })).toBe("error");
  });

  it("4 errors → error", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 4 })).toBe("error");
  });

  it("5 errors (MAX_CONSECUTIVE_FAILURES) → disabled", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 5 })).toBe("disabled");
    expect(MAX_CONSECUTIVE_FAILURES).toBe(5);
  });

  it("10 errors → disabled", () => {
    expect(getSourceHealth({ ...defaultState(), errorCount: 10 })).toBe("disabled");
  });
});

describe("persistence — loadSourceStates / saveSourceStates", () => {
  it("round-trips valid state", () => {
    const original: Record<string, SourceRuntimeState> = {
      "rss:example": { ...defaultState(), errorCount: 2, lastError: "timeout", averageScore: 7.5, totalItemsScored: 10 },
    };
    saveSourceStates(original);
    const loaded = loadSourceStates();
    expect(loaded["rss:example"].errorCount).toBe(2);
    expect(loaded["rss:example"].lastError).toBe("timeout");
    expect(loaded["rss:example"].averageScore).toBe(7.5);
  });

  it("handles corrupted JSON gracefully", () => {
    store["aegis_source_states"] = "{broken json{{";
    const loaded = loadSourceStates();
    expect(Object.keys(loaded)).toHaveLength(0);
  });

  it("replaces invalid state entries with defaults", () => {
    store["aegis_source_states"] = JSON.stringify({
      "rss:good": { ...defaultState() },
      "rss:bad": { errorCount: "not-a-number" }, // invalid
    });
    const loaded = loadSourceStates();
    expect(loaded["rss:good"].errorCount).toBe(0);
    expect(loaded["rss:bad"].errorCount).toBe(0); // replaced with default
  });

  it("handles null in storage", () => {
    store["aegis_source_states"] = "null";
    const loaded = loadSourceStates();
    expect(Object.keys(loaded)).toHaveLength(0);
  });

  it("handles empty string", () => {
    // empty key → getItem returns null → empty
    const loaded = loadSourceStates();
    expect(Object.keys(loaded)).toHaveLength(0);
  });
});

describe("constants", () => {
  it("BASE_CYCLE_MS is 2 minutes", () => {
    expect(BASE_CYCLE_MS).toBe(2 * 60 * 1000);
  });

  it("BACKOFF_MS has 4 escalating values", () => {
    expect(BACKOFF_MS).toHaveLength(4);
    for (let i = 1; i < BACKOFF_MS.length; i++) {
      expect(BACKOFF_MS[i]).toBeGreaterThan(BACKOFF_MS[i - 1]);
    }
  });
});
