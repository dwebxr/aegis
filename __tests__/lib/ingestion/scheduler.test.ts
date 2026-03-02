import { IngestionScheduler } from "@/lib/ingestion/scheduler";

// Mock fetch globally for scheduler tests
const originalFetch = global.fetch;

beforeAll(() => {
  // Default: all fetches return empty results
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [], events: [] }),
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("IngestionScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
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
  }> = {}) {
    return {
      onNewContent: overrides.onNewContent ?? jest.fn(),
      getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
      getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
      scoreFn: overrides.scoreFn ?? defaultScoreFn,
    };
  }

  describe("start/stop lifecycle", () => {
    it("starts and stops without error", () => {
      const spy = jest.spyOn(global, "setTimeout");
      const before = spy.mock.calls.length;
      const scheduler = new IngestionScheduler(makeCallbacks());
      scheduler.start();
      expect(spy.mock.calls.length).toBeGreaterThan(before);
      scheduler.stop();
      spy.mockRestore();
    });

    it("does not start multiple intervals on repeated start() calls", async () => {
      const callbacks = makeCallbacks();
      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();
      scheduler.start(); // second call should be no-op

      // After 5s delay, first cycle runs (async dedup.init() requires microtask flush)
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(callbacks.getSources).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it("cleans up initial timeout on stop", () => {
      const callbacks = makeCallbacks();
      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();
      scheduler.stop(); // stop before initial 5s timeout fires

      jest.advanceTimersByTime(10000);
      expect(callbacks.getSources).not.toHaveBeenCalled();
    });

    it("runs first cycle after 5 second delay", async () => {
      const callbacks = makeCallbacks();
      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();

      // Before 5s
      jest.advanceTimersByTime(4999);
      await Promise.resolve();
      expect(callbacks.getSources).not.toHaveBeenCalled();

      // At 5s (async dedup.init() requires microtask flush)
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(callbacks.getSources).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });

  describe("source routing", () => {
    it("calls fetch for RSS sources", async () => {
      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // flush microtasks

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/fetch/rss",
        expect.objectContaining({ method: "POST" }),
      );

      scheduler.stop();
    });

    it("skips disabled sources but fetches enabled ones", async () => {
      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://disabled.com/feed.xml" }, enabled: false },
          { type: "rss", config: { feedUrl: "https://enabled.com/feed.xml" }, enabled: true },
        ]),
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Only the enabled source should trigger a fetch
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(fetchBody.feedUrl).toBe("https://enabled.com/feed.xml");

      scheduler.stop();
    });

    it("handles unknown source type gracefully", async () => {
      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([
          { type: "unknown_type" as "rss", config: {}, enabled: true },
        ]),
      });

      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Should not crash, no items produced
      expect(callbacks.onNewContent).not.toHaveBeenCalled();

      scheduler.stop();
    });
  });

  describe("empty sources", () => {
    it("does not fetch when no sources configured", async () => {
      const callbacks = makeCallbacks({
        getSources: jest.fn().mockReturnValue([]),
      });

      const scheduler = new IngestionScheduler(callbacks);
      scheduler.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(callbacks.onNewContent).not.toHaveBeenCalled();

      scheduler.stop();
    });
  });

  describe("data pipeline (RSS items → quickSlopFilter → scoreItem → onNewContent)", () => {
    it("processes RSS items through the full pipeline and calls onNewContent with ContentItem", async () => {
      jest.useRealTimers(); // Use real timers since we need to await async chain

      const onNewContent = jest.fn();
      const scoreFn = jest.fn().mockResolvedValue({
        originality: 8, insight: 7, credibility: 9, composite: 8.1,
        verdict: "quality", reason: "Novel research with data",
        topics: ["transformers", "attention"], vSignal: 8, cContext: 6, lSlop: 1,
        scoringEngine: "claude-server",
      });
      const callbacks = makeCallbacks({
        onNewContent,
        scoreFn,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      // Mock fetch: RSS feed response (>100 words to skip enrichment)
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            feedTitle: "Test Feed",
            items: [{
              title: "New research on transformer attention mechanisms shows improvement",
              content: "Detailed analysis with data: 23% improvement in retrieval benchmarks with reproducible code at https://example.com/paper. The methodology uses sliding window approach combined with global token selection for long-context tasks. The researchers conducted extensive experiments across multiple datasets including GLUE, SuperGLUE, and SQuAD benchmarks. Results demonstrate consistent improvements over the baseline transformer architecture. The sliding window mechanism reduces computational complexity from quadratic to linear while maintaining attention quality. Global tokens serve as information aggregation points, enabling effective long-range dependency modeling. This approach has significant implications for processing lengthy documents and maintaining contextual understanding across large text spans. The paper also includes ablation studies showing the relative contribution of each component.",
              author: "Dr. Research",
              link: "https://example.com/article",
              imageUrl: "https://example.com/thumb.jpg",
            }],
          }),
        });

      // Directly invoke the scheduler's internal runCycle via start + short wait
      const scheduler = new IngestionScheduler(callbacks);
      // Access private runCycle via prototype to test the pipeline directly
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      expect(onNewContent).toHaveBeenCalledTimes(1);
      const item = onNewContent.mock.calls[0][0];
      // Verify it's a real ContentItem with expected structure
      expect(item.id).toBeTruthy();
      expect(item.author).toBe("Dr. Research");
      expect(item.source).toBe("rss");
      expect(item.sourceUrl).toBe("https://example.com/article");
      expect(item.imageUrl).toBe("https://example.com/thumb.jpg");
      expect(item.scores.composite).toBe(8.1);
      expect(item.verdict).toBe("quality");
      expect(item.topics).toEqual(["transformers", "attention"]);
      expect(item.vSignal).toBe(8);
      expect(item.text.length).toBeLessThanOrEqual(300);
    });

    it("filters out slop content via quickSlopFilter before scoring", async () => {
      jest.useRealTimers();

      const onNewContent = jest.fn();
      const callbacks = makeCallbacks({
        onNewContent,
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      // Return a spammy item that should fail quickSlopFilter
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            feedTitle: "Spam Feed",
            items: [{
              title: "AMAZING!!! WOW!!!",
              content: "BUY NOW!!! INCREDIBLE!!! DON'T MISS OUT!!! 🔥🔥🔥🚀🚀🚀 MOON SOON!!! 💰💰💰",
              author: "spammer",
              link: "https://spam.com",
            }],
          }),
        });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      // Spammy content should be filtered by quickSlopFilter — no /api/analyze call needed
      const fetchCalls = (global.fetch as jest.Mock).mock.calls;
      const analyzeCallCount = fetchCalls.filter(
        (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
      ).length;
      expect(analyzeCallCount).toBe(0);
      expect(onNewContent).not.toHaveBeenCalled();
    });

    it("handles failed scoring gracefully without crashing", async () => {
      jest.useRealTimers();

      const onNewContent = jest.fn();
      const callbacks = makeCallbacks({
        onNewContent,
        scoreFn: jest.fn().mockRejectedValue(new Error("Scoring cascade failed")),
        getSources: jest.fn().mockReturnValue([
          { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
        ]),
      });

      // Content must be >100 words to skip the enrichment step
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            feedTitle: "Good Feed",
            items: [{
              title: "Solid research with data",
              content: "Detailed analysis: 42% improvement in benchmarks with reproducible methodology and comprehensive evaluation across multiple datasets. Published at https://example.com/paper with full source code. The study evaluated performance across five different model architectures and three distinct task categories. Each experiment was replicated three times to ensure statistical significance. The authors provide a comprehensive comparison with existing state-of-the-art methods, showing consistent improvements across all evaluated metrics. Additionally, the computational overhead of the proposed approach is minimal, requiring only 15% more training time while achieving substantially better results on downstream tasks. The code and trained models are publicly available for reproducibility.",
              author: "Researcher",
              link: "https://example.com/good",
            }],
          }),
        });

      const scheduler = new IngestionScheduler(callbacks);
      const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
      await runCycle();

      // Scoring failed, so no content should be produced
      expect(onNewContent).not.toHaveBeenCalled();
    });
  });
});
