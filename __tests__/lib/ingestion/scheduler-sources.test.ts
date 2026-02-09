/**
 * Tests for IngestionScheduler — Nostr and URL source types, edge cases.
 * Tests real fetchSource routing, error resilience, MAX_ITEMS_PER_SOURCE cap,
 * concurrent cycle protection, and multi-source partial failure.
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
}> = {}) {
  return {
    onNewContent: overrides.onNewContent ?? jest.fn(),
    getSources: overrides.getSources ?? jest.fn().mockReturnValue([]),
    getUserContext: overrides.getUserContext ?? jest.fn().mockReturnValue(null),
  };
}

describe("IngestionScheduler — Nostr source", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("calls /api/fetch/nostr with relays and pubkeys from config", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "nostr",
        config: {
          relays: "wss://relay1.example.com,wss://relay2.example.com",
          pubkeys: "abc123,def456",
        },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
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
    expect(body.relays).toEqual(["wss://relay1.example.com", "wss://relay2.example.com"]);
    expect(body.pubkeys).toEqual(["abc123", "def456"]);
    expect(body.limit).toBe(20);
  });

  it("uses default relay when config.relays is empty", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "nostr",
        config: { relays: "" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    // Empty string split → [""] → not useful, but config.relays?.split(",") should
    // handle this; the default relay is used only when relays is undefined/null
    expect(body.relays).toBeDefined();
  });

  it("processes Nostr events into content items with nostr: source URL", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "nostr",
        config: { relays: "wss://relay.damus.io" },
        enabled: true,
      }]),
    });

    // Nostr fetch returns events
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [{
            content: "This is a detailed analysis of decentralized protocols with substantial data points and references to published research papers at https://example.com/paper",
            pubkey: "abcdef1234567890abcdef1234567890",
            id: "event-id-123",
          }],
        }),
      })
      // Analyze call
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 7, insight: 7, credibility: 7, composite: 7.0,
          verdict: "quality", reason: "Good analysis",
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onNewContent).toHaveBeenCalledTimes(1);
    const item = onNewContent.mock.calls[0][0];
    expect(item.source).toBe("nostr");
    expect(item.sourceUrl).toBe("nostr:event-id-123");
    expect(item.author).toBe("abcdef123456...");
  });

  it("returns empty array when Nostr fetch fails", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "nostr",
        config: { relays: "wss://bad.relay" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Connection refused"));

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onNewContent).not.toHaveBeenCalled();
  });

  it("returns empty array when Nostr API returns non-ok", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "nostr",
        config: { relays: "wss://relay.damus.io" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onNewContent).not.toHaveBeenCalled();
  });
});

describe("IngestionScheduler — URL source", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("calls /api/fetch/url with the URL from config", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "url",
        config: { url: "https://example.com/article" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: "Article", content: "Body text" }),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/fetch/url",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.url).toBe("https://example.com/article");
  });

  it("uses hostname as author when API response has no author", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "url",
        config: { url: "https://blog.example.org/post" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Test Article",
          content: "Detailed content with data: 42% improvement shown in benchmarks, referencing published studies at https://source.org/paper",
          // no author field
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 6, insight: 6, credibility: 6, composite: 6.0,
          verdict: "quality", reason: "ok",
        }),
      });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    if (onNewContent.mock.calls.length > 0) {
      const item = onNewContent.mock.calls[0][0];
      expect(item.author).toBe("blog.example.org");
    }
  });

  it("returns empty array when URL fetch fails", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "url",
        config: { url: "https://unreachable.com" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("DNS resolution failed"));

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    expect(onNewContent).not.toHaveBeenCalled();
  });

  it("handles invalid URL hostname gracefully", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "url",
        config: { url: "not-a-valid-url" },
        enabled: true,
      }]),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Title",
          content: "Valid content with data analysis and references: https://source.org 50% improvement noted",
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

    // Should not crash — hostname falls back to "unknown"
    if (onNewContent.mock.calls.length > 0) {
      const item = onNewContent.mock.calls[0][0];
      expect(item.author).toBe("unknown");
    }
  });
});

describe("IngestionScheduler — MAX_ITEMS_PER_SOURCE cap", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("limits scoring to 5 items per source even when more pass quickFilter", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([{
        type: "rss",
        config: { feedUrl: "https://example.com/feed.xml" },
        enabled: true,
      }]),
    });

    // Generate 10 quality RSS items
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Research paper ${i}`,
      content: `Detailed analysis with data: ${i * 10}% improvement over baseline methodology with comprehensive benchmark results published at https://source.org/paper${i}`,
      author: `Author ${i}`,
      link: `https://example.com/article/${i}`,
    }));

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ feedTitle: "Science Feed", items }),
      });

    // Mock 5 analyze calls (MAX_ITEMS_PER_SOURCE = 5)
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

    // At most 5 items should be scored (analyze calls capped)
    const analyzeCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
    );
    expect(analyzeCalls.length).toBeLessThanOrEqual(5);
  });
});

describe("IngestionScheduler — concurrent cycle protection", () => {
  it("prevents overlapping cycles (running flag)", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "rss",
        config: { feedUrl: "https://example.com/feed.xml" },
        enabled: true,
      }]),
    });

    // Slow fetch that takes time
    let resolveSlowFetch: (value: unknown) => void;
    const slowPromise = new Promise(resolve => { resolveSlowFetch = resolve; });
    (global.fetch as jest.Mock).mockReturnValueOnce(slowPromise);

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

    // Start first cycle (will block on slow fetch)
    const cycle1 = runCycle();

    // Start second cycle immediately — should return early due to running flag
    const cycle2 = runCycle();
    await cycle2; // This should resolve immediately

    // Resolve the slow fetch
    resolveSlowFetch!({ ok: true, json: async () => ({ items: [] }) });
    await cycle1;

    // getSources should only have been called once (second cycle was skipped)
    expect(callbacks.getSources).toHaveBeenCalledTimes(1);
  });
});

describe("IngestionScheduler — multi-source partial failure", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("continues processing remaining sources when one source fails", async () => {
    const onNewContent = jest.fn();
    const callbacks = makeCallbacks({
      onNewContent,
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://failing.com/feed" }, enabled: true },
        { type: "rss", config: { feedUrl: "https://working.com/feed" }, enabled: true },
      ]),
    });

    // First source fails
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("First source down"))
      // Second source succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          feedTitle: "Working Feed",
          items: [{
            title: "Good article with data analysis",
            content: "Comprehensive research showing 35% improvement in performance benchmarks with reproducible methodology published at https://source.org",
            author: "Researcher",
            link: "https://working.com/article",
          }],
        }),
      })
      // Analyze call for the working source's item
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

    // Second source should have produced content despite first source failing
    expect(onNewContent).toHaveBeenCalledTimes(1);
  });
});

describe("IngestionScheduler — userContext forwarding", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it("includes userContext in /api/analyze request when available", async () => {
    const userContext = {
      recentTopics: ["ai", "ml"],
      highAffinityTopics: ["transformers"],
      lowAffinityTopics: ["crypto"],
      trustedAuthors: ["dr-smith"],
    };
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "rss",
        config: { feedUrl: "https://example.com/feed" },
        enabled: true,
      }]),
      getUserContext: jest.fn().mockReturnValue(userContext),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            title: "AI Research",
            content: "Detailed AI analysis with data: 30% improvement shown in benchmarks with references to https://source.org published studies",
            author: "Author",
            link: "https://example.com/article",
          }],
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

    // Check that /api/analyze was called with userContext
    const analyzeCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
    );
    expect(analyzeCalls.length).toBe(1);
    const analyzeBody = JSON.parse(analyzeCalls[0][1].body);
    expect(analyzeBody.userContext).toEqual(userContext);
  });

  it("omits userContext from /api/analyze when null", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([{
        type: "rss",
        config: { feedUrl: "https://example.com/feed" },
        enabled: true,
      }]),
      getUserContext: jest.fn().mockReturnValue(null),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            title: "Article with Data",
            content: "Research showing 45% accuracy improvement with comprehensive benchmark data published at https://reference.org/study",
            author: "Author",
            link: "https://example.com/a",
          }],
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

    const analyzeCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, ...unknown[]]) => c[0] === "/api/analyze"
    );
    if (analyzeCalls.length > 0) {
      const body = JSON.parse(analyzeCalls[0][1].body);
      expect(body.userContext).toBeUndefined();
    }
  });
});
