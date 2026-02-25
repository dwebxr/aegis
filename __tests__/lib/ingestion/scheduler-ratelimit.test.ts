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

describe("IngestionScheduler — 429 rate limit handling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sets rateLimitedUntil on 429 response with Retry-After header", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([["Retry-After", "30"]]),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const states = scheduler.getSourceStates();
    const key = "rss:https://example.com/feed.xml";
    const state = states.get(key);
    expect(state).toBeDefined();
    expect(state!.rateLimitedUntil).toBeGreaterThan(Date.now());
    // retryAfterSec=30 → at least 60_000 ms (minimum floor)
    expect(state!.nextFetchAt).toBeGreaterThan(Date.now());
    // 429 should NOT increment errorCount
    expect(state!.errorCount).toBe(0);

    scheduler.stop();
  });

  it("uses 60s default when Retry-After header is missing", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map(),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    const before = Date.now();
    await runCycle();

    const state = scheduler.getSourceStates().get("rss:https://example.com/feed.xml");
    expect(state).toBeDefined();
    // Default 60s → minimum 60_000ms
    expect(state!.rateLimitedUntil).toBeGreaterThanOrEqual(before + 60_000);
    expect(state!.errorCount).toBe(0);

    scheduler.stop();
  });

  it("does not increment errorCount on 429 (no auto-disable)", async () => {
    const onSourceError = jest.fn();
    const onSourceAutoDisabled = jest.fn();
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
      ]),
      onSourceError,
      onSourceAutoDisabled,
    });

    // Simulate 6 consecutive 429 responses
    for (let i = 0; i < 6; i++) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Map([["Retry-After", "10"]]),
      });
    }

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

    for (let i = 0; i < 6; i++) {
      // Reset nextFetchAt to allow cycle to proceed
      const state = scheduler.getSourceStates().get("rss:https://example.com/feed.xml");
      if (state) state.nextFetchAt = 0;
      await runCycle();
    }

    const state = scheduler.getSourceStates().get("rss:https://example.com/feed.xml");
    expect(state!.errorCount).toBe(0);
    expect(onSourceAutoDisabled).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it("records normal error for non-429 HTTP errors", async () => {
    const onSourceError = jest.fn();
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "rss", config: { feedUrl: "https://example.com/feed.xml" }, enabled: true },
      ]),
      onSourceError,
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Map(),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const state = scheduler.getSourceStates().get("rss:https://example.com/feed.xml");
    expect(state!.errorCount).toBe(1);
    expect(state!.lastError).toBe("HTTP 500");
    expect(state!.rateLimitedUntil).toBe(0);
    expect(onSourceError).toHaveBeenCalledWith("rss:https://example.com/feed.xml", "HTTP 500");

    scheduler.stop();
  });

  it("handles 429 for nostr fetch", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "nostr", config: { relays: "wss://relay.test" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([["Retry-After", "45"]]),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const state = scheduler.getSourceStates().get("nostr:wss://relay.test");
    expect(state).toBeDefined();
    expect(state!.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect(state!.errorCount).toBe(0);

    scheduler.stop();
  });

  it("handles 429 for url fetch", async () => {
    const callbacks = makeCallbacks({
      getSources: jest.fn().mockReturnValue([
        { type: "url", config: { url: "https://blog.test/post" }, enabled: true },
      ]),
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([["Retry-After", "120"]]),
    });

    const scheduler = new IngestionScheduler(callbacks);
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();

    const state = scheduler.getSourceStates().get("url:https://blog.test/post");
    expect(state).toBeDefined();
    expect(state!.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect(state!.errorCount).toBe(0);

    scheduler.stop();
  });
});
