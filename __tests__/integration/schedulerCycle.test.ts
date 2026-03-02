import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import type { ContentItem } from "@/lib/types/content";

// Mock fetch to simulate API responses
const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function makeFetchResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
  } as unknown as Response;
}

type SchedulerOpts = ConstructorParameters<typeof IngestionScheduler>[0];

const defaultScoreFn = jest.fn().mockResolvedValue({
  originality: 7, insight: 8, credibility: 7, composite: 7.3,
  verdict: "quality", reason: "Good analysis", topics: ["tech"],
  scoringEngine: "claude-server",
});

function makeScheduler(overrides: Partial<SchedulerOpts> = {}) {
  const collected: ContentItem[] = [];
  const errors: Array<{ key: string; error: string }> = [];

  const scheduler = new IngestionScheduler({
    onNewContent: (item) => collected.push(item),
    getSources: () => [],
    getUserContext: () => null,
    scoreFn: defaultScoreFn,
    onSourceError: (key, error) => errors.push({ key, error }),
    ...overrides,
  });

  return { scheduler, collected, errors };
}

describe("IngestionScheduler — cycle integration", () => {
  it("processes RSS source and creates content items", async () => {
    // Content must be 100+ words to skip enrichment (which would require an extra fetch mock).
    // It also must pass quickSlopFilter heuristics.
    const longContent = [
      "This is a substantial article with enough content to pass the quality filter.",
      "It contains detailed analysis and evidence supporting the hypothesis.",
      "The methodology includes benchmarking and implementation details.",
      "Researchers found that the new approach significantly outperforms previous baselines.",
      "According to the paper published in the proceedings, the results are statistically significant.",
      "The study was conducted over a period of six months with a sample size of five hundred participants.",
      "Multiple control groups were used to validate the findings across different demographic segments.",
      "The authors acknowledge several limitations including potential selection bias in the initial cohort.",
      "Future work will focus on extending the methodology to additional domains and larger datasets.",
      "The implications of these findings are discussed in context of the broader research literature.",
      "In conclusion, the evidence strongly supports the proposed framework for evaluation.",
    ].join(" ");

    const rssResponse = {
      feedTitle: "Test Feed",
      items: [
        {
          title: "Article 1",
          content: longContent,
          link: "https://example.com/1",
          author: "Author 1",
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(rssResponse)); // RSS fetch (scoring handled by scoreFn)

    const { scheduler, collected } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true }],
    });

    // Manually trigger a cycle (don't use start() which uses timers)
    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();

    expect(collected.length).toBeGreaterThanOrEqual(1);
    expect(collected[0].source).toBe("rss");
    expect(collected[0].verdict).toBe("quality");
    expect(collected[0].scores.composite).toBe(7.3);
  });

  it("records source errors on fetch failure", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ error: "Not found" }, false, 404));

    const { scheduler, errors } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://bad.example.com/feed" }, enabled: true }],
    });

    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();

    expect(errors.length).toBe(1);
    expect(errors[0].error).toContain("404");
  });

  it("skips disabled sources", async () => {
    const { scheduler, collected } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: false }],
    });

    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();

    expect(collected).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates items across cycles", async () => {
    const longContent = [
      "This is the same article content that appears in every cycle.",
      "It has detailed analysis and evidence supporting the main findings.",
      "The methodology is sound with benchmarks and comprehensive implementation details provided.",
      "Researchers validated the approach across multiple experimental conditions and control groups.",
      "The paper also discusses statistical significance and confidence intervals for all measured outcomes.",
      "Multiple reviewers independently confirmed the reproducibility of the reported experimental results.",
      "The dataset used in the study is publicly available for independent verification and future research.",
      "Limitations of the current approach include sample size constraints and potential confounding variables.",
      "Future work will address these limitations through longitudinal studies with larger participant pools.",
      "The authors thank the anonymous reviewers for constructive feedback that improved this manuscript.",
      "Overall the contribution advances our understanding of the field significantly according to peer review.",
    ].join(" ");

    const rssResponse = {
      feedTitle: "Test Feed",
      items: [
        {
          title: "Same Article",
          content: longContent,
          link: "https://example.com/same",
          author: "Author",
        },
      ],
    };

    const analyzeResponse = {
      originality: 7, insight: 7, credibility: 7, composite: 7.0,
      verdict: "quality", reason: "OK", topics: ["tech"],
    };

    // Use URL-based mock to return correct responses regardless of call order
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/fetch/rss")) return makeFetchResponse(rssResponse);
      if (url.includes("/api/analyze")) return makeFetchResponse(analyzeResponse);
      return makeFetchResponse({}, false, 500);
    });

    const { scheduler, collected } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true }],
    });

    // Reset nextFetchAt to allow second cycle
    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);
    await runCycle();
    const firstCount = collected.length;

    // Second cycle should not add duplicate
    // Reset timing to allow re-fetch
    const states = scheduler.getSourceStates();
    states.forEach(s => { (s as { nextFetchAt: number }).nextFetchAt = 0; });

    await runCycle();
    // Second cycle should not add more items (deduplicated)
    expect(collected.length).toBe(firstCount);
  });

  it("does not run concurrent cycles (guards against overlapping)", async () => {
    let cycleRunning = false;
    let overlapDetected = false;

    fetchMock.mockImplementation(() => {
      if (cycleRunning) overlapDetected = true;
      cycleRunning = true;
      return new Promise(resolve => {
        setTimeout(() => {
          cycleRunning = false;
          resolve(makeFetchResponse({ items: [] }));
        }, 10);
      });
    });

    const { scheduler } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true }],
    });

    const runCycle = (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle.bind(scheduler);

    // Start two cycles simultaneously
    await Promise.all([runCycle(), runCycle()]);

    // The second cycle should have been skipped due to the running guard
    expect(overlapDetected).toBe(false);
  });

  it("handles unknown source type gracefully", async () => {
    const { scheduler, collected } = makeScheduler({
      getSources: () => [{ type: "unknown" as "rss", config: {}, enabled: true }],
    });

    // Should not throw
    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();
    expect(collected).toHaveLength(0);
  });
});

describe("IngestionScheduler — start/stop lifecycle", () => {
  it("start() initializes timers", () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const { scheduler } = makeScheduler();
    const before = setTimeoutSpy.mock.calls.length;
    scheduler.start();
    expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(before);
    scheduler.stop();
    setTimeoutSpy.mockRestore();
  });

  it("stop() clears all timers (double stop does not throw)", () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const { scheduler } = makeScheduler();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("start() is idempotent (calling twice doesn't create duplicate timers)", () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const { scheduler } = makeScheduler();
    scheduler.start();
    const countAfterFirst = setTimeoutSpy.mock.calls.length;
    scheduler.start(); // Second call should be no-op
    expect(setTimeoutSpy.mock.calls.length).toBe(countAfterFirst);
    scheduler.stop();
    setTimeoutSpy.mockRestore();
  });

  it("resetDedup() clears the deduplication cache", () => {
    const { scheduler } = makeScheduler();
    scheduler.resetDedup();
    // Should not throw
    expect(scheduler.getSourceStates().size).toBe(0);
  });
});

describe("IngestionScheduler — source state tracking", () => {
  it("tracks source states after successful fetch", async () => {
    fetchMock
      .mockResolvedValueOnce(makeFetchResponse({ items: [], feedTitle: "Test" })); // Empty RSS

    const { scheduler } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: true }],
    });

    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();

    const states = scheduler.getSourceStates();
    expect(states.size).toBe(1);
    const state = Array.from(states.values())[0];
    expect(state.errorCount).toBe(0);
    expect(state.lastSuccessAt).toBeGreaterThan(0);
  });

  it("increments error count on fetch failure", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchResponse({}, false, 500));

    const { scheduler } = makeScheduler({
      getSources: () => [{ type: "rss", config: { feedUrl: "https://bad.example.com/feed" }, enabled: true }],
    });

    await (scheduler as unknown as { runCycle: () => Promise<void> }).runCycle();

    const states = scheduler.getSourceStates();
    const state = Array.from(states.values())[0];
    expect(state.errorCount).toBe(1);
  });
});
