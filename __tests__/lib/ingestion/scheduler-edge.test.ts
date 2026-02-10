/**
 * Edge case tests for lib/ingestion/scheduler.ts
 * Tests concurrent cycle protection, backoff integration, dedup boundary,
 * enrichment edge cases, and adaptive interval behavior.
 */
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

function makeCallbacks(overrides: Partial<{
  onNewContent: jest.Mock;
  getSources: jest.Mock;
  getUserContext: jest.Mock;
  onSourceError: jest.Mock;
  onSourceAutoDisabled: jest.Mock;
}> = {}) {
  return {
    onNewContent: overrides.onNewContent ?? jest.fn(),
    getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
    getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
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
});
