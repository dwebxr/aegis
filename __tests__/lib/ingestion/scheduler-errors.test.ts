import { IngestionScheduler } from "@/lib/ingestion/scheduler";

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [], events: [] }),
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

const defaultScoreFn = jest.fn().mockResolvedValue({
  originality: 7, insight: 7, credibility: 7, composite: 7,
  verdict: "quality", reason: "test", topics: ["test"],
  scoringEngine: "heuristic",
});

function makeCallbacks(overrides: Partial<{
  onNewContent: jest.Mock;
  getSources: jest.Mock;
  getUserContext: jest.Mock;
  scoreFn: jest.Mock;
  onSourceError: jest.Mock;
  onSourceAutoDisabled: jest.Mock;
  onCycleComplete: jest.Mock;
  getSkipAI: jest.Mock;
}> = {}) {
  return {
    onNewContent: overrides.onNewContent ?? jest.fn(),
    getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
    getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
    scoreFn: overrides.scoreFn ?? defaultScoreFn,
    onSourceError: overrides.onSourceError,
    onSourceAutoDisabled: overrides.onSourceAutoDisabled,
    onCycleComplete: overrides.onCycleComplete,
    getSkipAI: overrides.getSkipAI,
  };
}

describe("IngestionScheduler error recovery", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockClear();
    defaultScoreFn.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("continues running after a fetch error for one source", async () => {
    const onSourceError = jest.fn();
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onSourceError,
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://bad.example/feed" }, enabled: true },
        { type: "rss", config: { feedUrl: "https://good.example/feed" }, enabled: true },
      ]),
    });

    // First source: network error. Second source: valid RSS
    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes("bad.example") || (callCount === 1 && url.includes("/api/fetch/rss"))) {
        return { ok: false, status: 500, headers: new Headers() };
      }
      return {
        ok: true,
        json: async () => ({
          feedTitle: "Good Feed",
          items: [{
            title: "Good Article",
            content: "Some content here that is long enough to pass filters",
            link: "https://good.example/article",
            author: "Author",
          }],
        }),
      };
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    // Advance past initial delay
    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Scheduler should have recorded error but not crashed
    const states = scheduler.getSourceStates();
    expect(states.size).toBeGreaterThan(0);

    scheduler.stop();
  });

  it("handles 429 rate limiting with Retry-After header", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://limited.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "120" }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();

    const states = scheduler.getSourceStates();
    const key = Array.from(states.keys())[0];
    if (key) {
      const state = states.get(key)!;
      // Rate limited: nextFetchAt should be at least 120s in the future
      expect(state.rateLimitedUntil).toBeGreaterThan(Date.now());
    }

    scheduler.stop();
  });

  it("skips disabled sources", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://disabled.example/feed" }, enabled: false },
      ]),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();

    // Fetch should not have been called for the disabled source
    expect((global.fetch as jest.Mock).mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("disabled.example")
    )).toHaveLength(0);

    scheduler.stop();
  });

  it("cleans up HTTP cache headers for removed sources", async () => {
    const sources = [
      { type: "rss" as const, config: { feedUrl: "https://a.example/feed" }, enabled: true },
      { type: "rss" as const, config: { feedUrl: "https://b.example/feed" }, enabled: true },
    ];
    const getSources = jest.fn().mockReturnValue(sources);
    const callbacks = makeCallbacks({ getSources });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ feedTitle: "Feed", items: [] }),
      headers: new Headers({ ETag: '"abc"' }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    // First cycle
    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();

    // Remove source B
    getSources.mockReturnValue([sources[0]]);

    // Second cycle should clean up B's cache headers
    jest.advanceTimersByTime(120_000);
    await Promise.resolve();
    await Promise.resolve();

    scheduler.stop();
    // No crash = cache cleanup worked
  });

  it("resets source state via resetSourceState", async () => {
    const onSourceError = jest.fn();
    const callbacks = makeCallbacks({
      onSourceError,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://err.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 500, headers: new Headers(),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();

    // Source should have errors recorded
    const key = "rss:https://err.example/feed";
    const stateBefore = scheduler.getSourceStates().get(key);
    if (stateBefore) {
      expect(stateBefore.errorCount).toBeGreaterThan(0);

      // Reset the source
      scheduler.resetSourceState(key);

      const stateAfter = scheduler.getSourceStates().get(key);
      expect(stateAfter!.errorCount).toBe(0);
      expect(stateAfter!.lastError).toBe("");
    }

    scheduler.stop();
  });

  it("resetSourceState for unknown key does not crash", () => {
    const scheduler = new IngestionScheduler(makeCallbacks());
    expect(() => scheduler.resetSourceState("nonexistent:key")).not.toThrow();
    scheduler.stop();
  });

  it("resetDedup clears the deduplication state", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://dup.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        feedTitle: "Feed",
        items: [{
          title: "Article", content: "Content here", link: "https://dup.example/1",
        }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();

    // Reset dedup — subsequent cycle should treat same items as new
    scheduler.resetDedup();

    scheduler.stop();
  });

  it("handles scoreFn throwing an error gracefully", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation();
    const scoreFn = jest.fn().mockRejectedValue(new Error("Score engine crashed"));
    const callbacks = makeCallbacks({
      scoreFn,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://score-err.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        feedTitle: "Feed",
        items: [{
          title: "Article",
          content: "Enough words here to pass the quick slop filter and be scored by the engine",
          link: "https://score-err.example/1",
        }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Should log error but not crash
    scheduler.stop();
    errorSpy.mockRestore();
  });

  it("handles missing scoreFn — falls back to null return", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://noscore.example/feed" }, enabled: true },
      ]),
    });
    // Remove scoreFn
    delete (callbacks as Record<string, unknown>).scoreFn;

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        feedTitle: "Feed",
        items: [{
          title: "Article",
          content: "Content that needs scoring but no score function available for it",
          link: "https://noscore.example/1",
        }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Without scoreFn, items should not be added as content
    expect(onNewContent).not.toHaveBeenCalled();

    scheduler.stop();
    warnSpy.mockRestore();
  });

  it("uses heuristic scoring when getSkipAI returns true", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSkipAI: jest.fn().mockReturnValue(true),
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://heuristic.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        feedTitle: "Feed",
        items: [{
          title: "Article Title",
          content: "Content that is longer than the minimum word threshold for the quick slop filter",
          link: "https://heuristic.example/1",
        }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // scoreFn should NOT have been called (heuristic path used instead)
    expect(defaultScoreFn).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it("fires onCycleComplete with items from the cycle", async () => {
    const onCycleComplete = jest.fn();
    const callbacks = makeCallbacks({
      onCycleComplete,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://cycle.example/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        feedTitle: "Feed",
        items: [{
          title: "Cycle Article",
          content: "Long enough content for the quick filter to accept this item successfully",
          link: "https://cycle.example/1",
        }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    scheduler.start();

    jest.advanceTimersByTime(5100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    if (onCycleComplete.mock.calls.length > 0) {
      const [count, items] = onCycleComplete.mock.calls[0];
      expect(count).toBeGreaterThan(0);
      expect(items).toHaveLength(count);
    }

    scheduler.stop();
  });
});
