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
  verdict: "quality", reason: "Mock score", topics: ["test"],
  scoringEngine: "heuristic",
});

function makeCallbacks(overrides: Partial<{
  onNewContent: jest.Mock;
  getSources: jest.Mock;
  getUserContext: jest.Mock;
  scoreFn: jest.Mock;
  onSourceError: jest.Mock;
  onSourceAutoDisabled: jest.Mock;
}> = {}) {
  return {
    onNewContent: overrides.onNewContent ?? jest.fn(),
    getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
    getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
    scoreFn: overrides.scoreFn ?? defaultScoreFn,
    onSourceError: overrides.onSourceError ?? jest.fn(),
    onSourceAutoDisabled: overrides.onSourceAutoDisabled ?? jest.fn(),
  };
}

describe("IngestionScheduler — edge cases", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  describe("concurrent cycle protection", () => {
    it("prevents overlapping runCycle executions", async () => {
      jest.useRealTimers();

      let fetchCallCount = 0;
      let resolveFirstFetch: () => void;
      const firstFetchPromise = new Promise<void>((resolve) => {
        resolveFirstFetch = resolve;
      });

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First fetch blocks until we resolve
          await firstFetchPromise;
        }
        return { ok: true, json: async () => ({ items: [] }) };
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Start two cycles concurrently
      const cycle1 = runCycle();
      const cycle2 = runCycle(); // Should be blocked by running flag

      // Resolve the blocking fetch
      resolveFirstFetch!();
      await cycle1;
      await cycle2;

      // Only one cycle should have fetched (the other was blocked)
      expect(fetchCallCount).toBe(1);
    });
  });

  describe("backoff and auto-disable", () => {
    it("calls onSourceError on fetch failure", async () => {
      jest.useRealTimers();

      const onSourceError = jest.fn();
      const callbacks = makeCallbacks({
        onSourceError,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://fail.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      expect(onSourceError).toHaveBeenCalledWith(
        "rss:https://fail.example.com/feed",
        "HTTP 500",
      );
    });

    it("calls onSourceAutoDisabled after MAX_CONSECUTIVE_FAILURES", async () => {
      jest.useRealTimers();

      const onSourceAutoDisabled = jest.fn();
      const callbacks = makeCallbacks({
        onSourceAutoDisabled,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://fail.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Service Unavailable" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Fail 5 times (MAX_CONSECUTIVE_FAILURES)
      for (let i = 0; i < 5; i++) {
        // Reset time to allow fetch (bypass backoff)
        const states = scheduler.getSourceStates();
        const state = states.get("rss:https://fail.example.com/feed");
        if (state) state.nextFetchAt = 0;
        await runCycle();
      }

      expect(onSourceAutoDisabled).toHaveBeenCalledTimes(1);
      expect(onSourceAutoDisabled).toHaveBeenCalledWith(
        "rss:https://fail.example.com/feed",
        "HTTP 503",
      );
    });

    it("skips auto-disabled sources", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://disabled.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Error" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Fail 5 times to auto-disable
      for (let i = 0; i < 5; i++) {
        const states = scheduler.getSourceStates();
        const state = states.get("rss:https://disabled.example.com/feed");
        if (state) state.nextFetchAt = 0;
        await runCycle();
      }

      (global.fetch as jest.Mock).mockClear();

      // Next cycle should skip the disabled source
      await runCycle();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("source state management", () => {
    it("getSourceStates returns source state after a cycle", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ feedTitle: "Test", items: [] }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      const states = scheduler.getSourceStates();
      const state = states.get("rss:https://example.com/feed.xml");
      expect(state).toBeDefined();
      expect(state!.errorCount).toBe(0);
      expect(state!.lastSuccessAt).toBeGreaterThan(0);
      expect(state!.consecutiveEmpty).toBe(1); // 0 items = empty
    });

    it("tracks consecutive empty fetches", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://empty.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ feedTitle: "Empty", items: [] }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Run 3 cycles with empty results
      for (let i = 0; i < 3; i++) {
        const states = scheduler.getSourceStates();
        const state = states.get("rss:https://empty.example.com/feed");
        if (state) state.nextFetchAt = 0;
        await runCycle();
      }

      const state = scheduler.getSourceStates().get("rss:https://empty.example.com/feed");
      expect(state!.consecutiveEmpty).toBe(3);
    });
  });

  describe("resetDedup", () => {
    it("clears dedup state allowing previously seen items to be processed", async () => {
      jest.useRealTimers();

      const onNewContent = jest.fn();
      const callbacks = makeCallbacks({
        onNewContent,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      const longContent = "Novel research on transformer attention mechanisms demonstrates significant improvements in benchmark performance. The methodology introduces a sliding window approach combined with global token selection for long-context tasks. Researchers conducted extensive experiments across multiple datasets including GLUE, SuperGLUE, and SQuAD benchmarks. Results show 23% improvement over baseline. The paper provides reproducible code and comprehensive ablation studies demonstrating the relative contribution of each architectural component.";

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            feedTitle: "Test",
            items: [{ title: "Test Article", content: longContent, author: "Author", link: "https://example.com/1" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ composite: 7, verdict: "quality", originality: 7, insight: 7, credibility: 7, reason: "Good", topics: ["test"], vSignal: 7, cContext: 5, lSlop: 2 }),
        });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      expect(onNewContent).toHaveBeenCalledTimes(1);

      // Second cycle with same content — should be deduped
      onNewContent.mockClear();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          feedTitle: "Test",
          items: [{ title: "Test Article", content: longContent, author: "Author", link: "https://example.com/1" }],
        }),
      });

      // Reset nextFetchAt to allow fetch
      const states = scheduler.getSourceStates();
      const state = states.get("rss:https://example.com/feed.xml");
      if (state) state.nextFetchAt = 0;
      await runCycle();

      expect(onNewContent).not.toHaveBeenCalled(); // Deduped

      // After resetDedup, same content should be processed again
      scheduler.resetDedup();
      onNewContent.mockClear();
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            feedTitle: "Test",
            items: [{ title: "Test Article", content: longContent, author: "Author", link: "https://example.com/1" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ composite: 7, verdict: "quality", originality: 7, insight: 7, credibility: 7, reason: "Good", topics: ["test"], vSignal: 7, cContext: 5, lSlop: 2 }),
        });

      if (state) state.nextFetchAt = 0;
      await runCycle();

      expect(onNewContent).toHaveBeenCalledTimes(1);
    });
  });

  describe("URL source type", () => {
    it("fetches single URL sources correctly", async () => {
      jest.useRealTimers();

      const onNewContent = jest.fn();
      const callbacks = makeCallbacks({
        onNewContent,
        getSources: jest.fn().mockReturnValue([
          { type: "url", config: { url: "https://example.com/article" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            title: "Test Article",
            content: "This is a detailed analysis with more than one hundred words of content to avoid enrichment. " +
              "The research methodology demonstrates significant improvements across multiple benchmarks. " +
              "Results indicate a 42% improvement over baseline approaches. The comprehensive evaluation " +
              "spans five datasets and three model architectures providing strong evidence for the claims.",
            author: "Test Author",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ composite: 6, verdict: "quality", originality: 6, insight: 6, credibility: 6, reason: "OK", topics: ["test"], vSignal: 6, cContext: 5, lSlop: 2 }),
        });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      expect(onNewContent).toHaveBeenCalledTimes(1);
      const item = onNewContent.mock.calls[0][0];
      expect(item.author).toBe("Test Author");
      expect(item.sourceUrl).toBe("https://example.com/article");
    });
  });

  describe("Nostr source type", () => {
    it("fetches Nostr sources with comma-separated relays", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "nostr", config: { relays: "wss://relay.damus.io,wss://nos.lol", pubkeys: "abc123" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/fetch/nostr",
        expect.objectContaining({ method: "POST" }),
      );

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.relays).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
      expect(body.pubkeys).toEqual(["abc123"]);
    });
  });

  describe("auto-recovery after AUTO_RECOVERY_MS (6h)", () => {
    it("recovers auto-disabled source after 6 hours", async () => {
      jest.useRealTimers();

      const onNewContent = jest.fn();
      const onSourceAutoDisabled = jest.fn();
      const callbacks = makeCallbacks({
        onNewContent,
        onSourceAutoDisabled,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://recover.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Unavailable" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Fail 5 times to auto-disable
      for (let i = 0; i < 5; i++) {
        const states = scheduler.getSourceStates();
        const state = states.get("rss:https://recover.example.com/feed");
        if (state) state.nextFetchAt = 0;
        await runCycle();
      }

      expect(onSourceAutoDisabled).toHaveBeenCalledTimes(1);

      // Source should be disabled now
      const disabledState = scheduler.getSourceStates().get("rss:https://recover.example.com/feed")!;
      expect(disabledState.errorCount).toBe(5);

      // Simulate 6+ hours passing by setting lastErrorAt to 7 hours ago
      disabledState.lastErrorAt = Date.now() - 7 * 60 * 60 * 1000;
      disabledState.nextFetchAt = 0;

      // Now the feed returns successfully
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ feedTitle: "Recovered", items: [] }),
      });

      await runCycle();

      // errorCount should have been reduced to MAX_CONSECUTIVE_FAILURES - 1 = 4
      // and then the successful fetch brings it to 0
      const recoveredState = scheduler.getSourceStates().get("rss:https://recover.example.com/feed")!;
      expect(recoveredState.errorCount).toBe(0);
      expect(recoveredState.lastSuccessAt).toBeGreaterThan(0);
    });

    it("does NOT recover if less than 6 hours have passed", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://no-recover.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Unavailable" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

      // Fail 5 times to auto-disable
      for (let i = 0; i < 5; i++) {
        const states = scheduler.getSourceStates();
        const state = states.get("rss:https://no-recover.example.com/feed");
        if (state) state.nextFetchAt = 0;
        await runCycle();
      }

      const state = scheduler.getSourceStates().get("rss:https://no-recover.example.com/feed")!;
      // Only 1 hour ago — too soon for auto-recovery
      state.lastErrorAt = Date.now() - 1 * 60 * 60 * 1000;

      (global.fetch as jest.Mock).mockClear();
      await runCycle();

      // Source should still be disabled — no fetch attempted
      expect(global.fetch).not.toHaveBeenCalled();
      expect(state.errorCount).toBe(5);
    });
  });

  describe("resetSourceState", () => {
    it("clears error state for an in-memory source key", async () => {
      jest.useRealTimers();

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://reset.example.com/feed" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Error" }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      const state = scheduler.getSourceStates().get("rss:https://reset.example.com/feed")!;
      expect(state.errorCount).toBe(1);

      scheduler.resetSourceState("rss:https://reset.example.com/feed");

      expect(state.errorCount).toBe(0);
      expect(state.lastError).toBe("");
      expect(state.nextFetchAt).toBe(0);
    });

    it("handles unknown key without crash", () => {
      const callbacks = makeCallbacks();
      const scheduler = new IngestionScheduler(callbacks);
      expect(() => scheduler.resetSourceState("unknown:key")).not.toThrow();
    });
  });

  describe("stale httpCacheHeaders purge", () => {
    it("purges headers for removed sources", async () => {
      jest.useRealTimers();

      let sources = [
        { type: "rss" as const, config: { feedUrl: "https://a.com/feed" }, enabled: true },
        { type: "rss" as const, config: { feedUrl: "https://b.com/feed" }, enabled: true },
      ];

      const callbacks = makeCallbacks({
        getSources: jest.fn().mockImplementation(() => sources),
      });

      // First fetch returns ETag headers for both sources
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [], etag: '"etag-a"' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [], etag: '"etag-b"' }),
        });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      // Remove source B
      sources = [{ type: "rss" as const, config: { feedUrl: "https://a.com/feed" }, enabled: true }];

      // Allow next fetch
      const stateA = scheduler.getSourceStates().get("rss:https://a.com/feed");
      if (stateA) stateA.nextFetchAt = 0;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      await runCycle();

      // After cycle, the ETag for removed source B should be purged
      // We can verify by re-adding source B and checking no ETag is sent
      sources = [
        { type: "rss" as const, config: { feedUrl: "https://a.com/feed" }, enabled: true },
        { type: "rss" as const, config: { feedUrl: "https://b.com/feed" }, enabled: true },
      ];

      if (stateA) stateA.nextFetchAt = 0;
      const stateB = scheduler.getSourceStates().get("rss:https://b.com/feed");
      if (stateB) stateB.nextFetchAt = 0;

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        });

      await runCycle();

      // Find the fetch call for source B
      const bCalls = (global.fetch as jest.Mock).mock.calls.filter(
        (c: [string, { body: string }]) => {
          if (c[0] !== "/api/fetch/rss") return false;
          const body = JSON.parse(c[1].body);
          return body.feedUrl === "https://b.com/feed";
        }
      );
      // Source B should NOT have ETag (it was purged)
      if (bCalls.length > 0) {
        const body = JSON.parse(bCalls[bCalls.length - 1][1].body);
        expect(body.etag).toBeUndefined();
      }
    });
  });
});
