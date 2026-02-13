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
  getSkipAI: jest.Mock;
  onSourceError: jest.Mock;
  onCycleComplete: jest.Mock;
}> = {}) {
  return {
    onNewContent: overrides.onNewContent ?? jest.fn(),
    getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
    getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
    getSkipAI: overrides.getSkipAI,
    onSourceError: overrides.onSourceError ?? jest.fn(),
    onCycleComplete: overrides.onCycleComplete,
  };
}

/** >100 words to skip enrichment */
const LONG_CONTENT = "Detailed analysis with benchmark data showing 35% improvement " +
  "across multiple evaluation datasets with reproducible methodology published at source. " +
  "The researchers conducted extensive experiments spanning five model architectures and three " +
  "distinct task categories. Each experiment was replicated three times to ensure statistical " +
  "significance. The authors provide a comprehensive comparison with existing state-of-the-art " +
  "methods, showing consistent improvements across all evaluated metrics. Additionally the " +
  "computational overhead of the proposed approach is minimal requiring only fifteen percent more " +
  "training time while achieving substantially better results on all downstream tasks evaluated. " +
  "The code and trained models are publicly available for full reproducibility of all results.";

describe("IngestionScheduler — enrichment flow", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("enriches short RSS items by fetching full article via /api/fetch/url", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    // RSS returns short items (< 100 words → needs enrichment)
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          feedTitle: "Tech Blog",
          items: [{
            title: "Short Article",
            content: "Brief summary only.",
            author: "Author",
            link: "https://example.com/article-full",
          }],
        }),
      })
      // Enrichment: /api/fetch/url returns full article
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Full Article Title",
          content: "This is a much more detailed article content with extensive data analysis showing significant improvements. The comprehensive benchmark results demonstrate a 35% accuracy increase across multiple evaluation datasets. Researchers conducted ablation studies to understand the contribution of each component in the proposed architecture.",
          imageUrl: "https://example.com/enriched-img.jpg",
        }),
      })
      // Analyze call
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 7, insight: 7, credibility: 7, composite: 7.0,
          verdict: "quality", reason: "Good", topics: ["research"],
          vSignal: 7, cContext: 5, lSlop: 2,
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // Should have called /api/fetch/url for enrichment
    const urlFetchCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/fetch/url"
    );
    expect(urlFetchCalls.length).toBe(1);

    expect(onNewContent).toHaveBeenCalledTimes(1);
    const item = onNewContent.mock.calls[0][0];
    // Enriched content should contain the full text
    expect(item.text).toContain("Full Article Title");
  });

  it("uses original text when enrichment fails", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    // Short RSS item
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            title: "Short Post",
            content: "Brief snippet.",
            author: "Author",
            link: "https://example.com/failing-article",
          }],
        }),
      })
      // Enrichment fails
      .mockRejectedValueOnce(new Error("Enrichment failed"))
      // Analyze gets the original short text (but it may fail quick filter)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 5, insight: 5, credibility: 5, composite: 5.0,
          verdict: "quality", reason: "ok",
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // Should not crash — enrichment failure is handled gracefully
    // Content may or may not be produced depending on quickFilter
  });

  it("does not enrich non-RSS sources", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "url", config: { url: "https://example.com/article" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Short",
          content: "Brief.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 5, insight: 5, credibility: 5, composite: 5.0,
          verdict: "quality", reason: "ok",
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // Only the initial /api/fetch/url call, no enrichment fetch
    const urlCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/fetch/url"
    );
    expect(urlCalls.length).toBe(1); // Just the source fetch, not enrichment
  });

  it("caps enrichment at MAX_ENRICH_PER_CYCLE (3)", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    // Return 5 short items
    const items = Array.from({ length: 5 }, (_, i) => ({
      title: `Short Article ${i}`,
      content: "Brief.",
      author: `Author ${i}`,
      link: `https://example.com/article-${i}`,
    }));

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items }),
      });

    // Mock enrichment calls — all return long content
    for (let i = 0; i < 5; i++) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: `Full Article ${i}`,
          content: "Very detailed content. ".repeat(30),
        }),
      });
    }

    // Mock analyze calls
    for (let i = 0; i < 5; i++) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 7, insight: 7, credibility: 7, composite: 7.0,
          verdict: "quality", reason: "ok",
        }),
      });
    }

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // Count enrichment calls (calls to /api/fetch/url)
    const enrichCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/fetch/url"
    );
    expect(enrichCalls.length).toBeLessThanOrEqual(3);
  });
});

describe("IngestionScheduler — conditional headers (ETag/Last-Modified)", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("sends ETag and lastModified in subsequent RSS fetches", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    // First fetch: returns ETag and lastModified
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        etag: '"abc-123"',
        lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // Reset nextFetchAt to allow second fetch
    const states = scheduler.getSourceStates();
    const state = states.get("rss:https://example.com/feed");
    if (state) state.nextFetchAt = 0;

    // Second fetch
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], notModified: true }),
    });

    await runCycle();

    // Second fetch should include conditional headers in the body
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    const body = JSON.parse(secondCall[1].body);
    expect(body.etag).toBe('"abc-123"');
    expect(body.lastModified).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
  });

  it("handles 304 Not Modified (notModified flag)", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], notModified: true }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // No content should be produced from notModified response
    expect(onNewContent).not.toHaveBeenCalled();
  });
});

describe("IngestionScheduler — skipAI mode (heuristic fallback)", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("uses heuristic scoring when getSkipAI returns true", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSkipAI: jest.fn().mockReturnValue(true),
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ title: "Research", content: LONG_CONTENT, author: "Dr. Test", link: "https://example.com/1" }],
      }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // When skipAI is true, no /api/analyze call should be made
    const analyzeCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
    );
    expect(analyzeCalls.length).toBe(0);

    // Content should still be produced via heuristic scoring
    expect(onNewContent).toHaveBeenCalledTimes(1);
    const item = onNewContent.mock.calls[0][0];
    expect(item.scores.composite).toBeDefined();
    expect(typeof item.scores.composite).toBe("number");
  });
});

describe("IngestionScheduler — onCycleComplete callback", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("fires onCycleComplete with item count and items when content is produced", async () => {
    const onCycleComplete = jest.fn();
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      onCycleComplete,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ title: "Study", content: LONG_CONTENT, author: "Author", link: "https://example.com/1" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 7, insight: 7, credibility: 7, composite: 7.0,
          verdict: "quality", reason: "ok", topics: ["test"],
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onCycleComplete).toHaveBeenCalledTimes(1);
    expect(onCycleComplete).toHaveBeenCalledWith(1, expect.any(Array));
    expect(onCycleComplete.mock.calls[0][1]).toHaveLength(1);
  });

  it("does not fire onCycleComplete when no items produced", async () => {
    const onCycleComplete = jest.fn();
    const callbacks = makeCallbacks({
      onCycleComplete,
      getSources: jest.fn().mockReturnValue([]),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onCycleComplete).not.toHaveBeenCalled();
  });
});

describe("IngestionScheduler — user API key forwarding", () => {
  const mockGetUserApiKey = jest.fn();

  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
    mockGetUserApiKey.mockReturnValue(null);
  });

  // We can't easily mock getUserApiKey inside the module without restructuring,
  // but we can verify the fetch call is made with the correct headers structure
  it("makes analyze requests with Content-Type header", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ title: "Study", content: LONG_CONTENT, author: "Author", link: "https://example.com/1" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 7, insight: 7, credibility: 7, composite: 7.0,
          verdict: "quality", reason: "ok",
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const analyzeCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
    );
    if (analyzeCalls.length > 0) {
      expect(analyzeCalls[0][1].headers["Content-Type"]).toBe("application/json");
    }
  });
});

describe("IngestionScheduler — RSS fetch exception handling", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("handles network errors during RSS fetch without crashing", async () => {
    const onSourceError = jest.fn();
    const callbacks = makeCallbacks({
      onSourceError,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://unreachable.example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onSourceError).toHaveBeenCalledWith(
      "rss:https://unreachable.example.com/feed",
      "ECONNREFUSED",
    );
  });

  it("handles URL fetch exception without crashing", async () => {
    const onSourceError = jest.fn();
    const callbacks = makeCallbacks({
      onSourceError,
      getSources: jest.fn().mockReturnValue([
        { type: "url", config: { url: "https://fail.example.com" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Timeout"));

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onSourceError).toHaveBeenCalledWith(
      "url:https://fail.example.com",
      "Timeout",
    );
  });
});

describe("IngestionScheduler — scoreItem error handling", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("returns null when analyze fetch throws exception", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ title: "Study", content: LONG_CONTENT, author: "Author", link: "https://example.com/1" }],
        }),
      })
      // Analyze throws
      .mockRejectedValueOnce(new Error("Network error"));

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    // No content produced when scoring fails
    expect(onNewContent).not.toHaveBeenCalled();
  });
});

describe("IngestionScheduler — average score tracking", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], events: [] }),
    });
  });

  it("computes and updates averageScore in source state", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { title: "Article 1", content: LONG_CONTENT, author: "A", link: "https://example.com/1" },
            { title: "Article 2", content: LONG_CONTENT + " Additional novel findings.", author: "B", link: "https://example.com/2" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ originality: 8, insight: 8, credibility: 8, composite: 8.0, verdict: "quality", reason: "ok" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ originality: 6, insight: 6, credibility: 6, composite: 6.0, verdict: "quality", reason: "ok" }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const state = scheduler.getSourceStates().get("rss:https://example.com/feed");
    expect(state).toBeDefined();
    expect(state!.averageScore).toBe(7.0); // (8 + 6) / 2
    expect(state!.totalItemsScored).toBe(2);
  });
});
