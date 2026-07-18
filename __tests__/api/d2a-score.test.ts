import { NextRequest, NextResponse } from "next/server";

const mockScoreCache = { get: jest.fn(), set: jest.fn() };
const mockExtractArticle = jest.fn();
const mockScoreOneText = jest.fn();
const mockTryReserveScoreBudget = jest.fn();
const mockGetScoreBudgetRetryAfter = jest.fn();
const mockDistributedRateLimitByKey = jest.fn();
const mockCaptureException = jest.fn();
const mockAddBreadcrumb = jest.fn();
const mockCaptureMessage = jest.fn();
let mockReceiver = "";

jest.mock("@/lib/api/kv/namespace", () => ({ scoreCacheKV: mockScoreCache }));
jest.mock("@/lib/extraction/extractArticle.server", () => ({
  extractArticle: (...args: unknown[]) => mockExtractArticle(...args),
}));
jest.mock("@/lib/scoring/scoreWithClaude.server", () => ({
  scoreOneText: (...args: unknown[]) => mockScoreOneText(...args),
}));
jest.mock("@/lib/api/dailyBudget", () => ({
  tryReserveScoreBudget: (...args: unknown[]) => mockTryReserveScoreBudget(...args),
  getScoreBudgetRetryAfter: (...args: unknown[]) => mockGetScoreBudgetRetryAfter(...args),
}));
jest.mock("@/lib/api/rateLimit", () => ({
  distributedRateLimitByKey: (...args: unknown[]) => mockDistributedRateLimitByKey(...args),
}));
jest.mock("@/lib/d2a/x402Server", () => ({
  get X402_RECEIVER() { return mockReceiver; },
  X402_NETWORK: "eip155:84532",
  X402_SCORE_PRICE: "$0.02",
  resourceServer: {},
}));
jest.mock("@x402/next", () => ({
  withX402: (handler: (request: NextRequest) => Promise<NextResponse>) => handler,
}));
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

type ScoreRoute = typeof import("@/app/api/d2a/score/route");

const originalEnv = { ...process.env };
let route: ScoreRoute;

function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function request(url?: string, origin?: string): NextRequest {
  const target = new URL("http://localhost/api/d2a/score");
  if (url !== undefined) target.searchParams.set("url", url);
  return new NextRequest(target, {
    method: "GET",
    headers: {
      "x-forwarded-for": "203.0.113.10",
      ...(origin ? { origin } : {}),
    },
  });
}

const article = {
  status: 200,
  data: {
    title: "Example",
    author: "Ada",
    content: "A sufficiently long article body for scoring.".repeat(3),
    description: "",
    publishedDate: "2026-01-01",
    source: "example.com",
  },
};

const rawScore = {
  originality: 7,
  insight: 8,
  credibility: 9,
  composite: 1,
  verdict: "slop",
  reason: "Useful",
  topics: ["technology"],
  vSignal: 8,
  cContext: 5,
  lSlop: 1.5,
  tier: "claude",
};

describe("GET /api/d2a/score (free test path)", () => {
  beforeAll(() => {
    setNodeEnv("test");
    process.env.D2A_SCORE_ENABLED = "true";
    process.env.D2A_SCORE_FREE_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockReceiver = "";
    jest.resetModules();
    route = require("@/app/api/d2a/score/route") as ScoreRoute;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.D2A_SCORE_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockScoreCache.get.mockResolvedValue(null);
    mockScoreCache.set.mockResolvedValue("OK");
    mockExtractArticle.mockResolvedValue(article);
    mockScoreOneText.mockResolvedValue(rawScore);
    mockTryReserveScoreBudget.mockResolvedValue(true);
    mockGetScoreBudgetRetryAfter.mockResolvedValue(60);
    mockDistributedRateLimitByKey.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it.each([
    [undefined, "Missing"],
    ["not a url", "Invalid"],
    ["http://127.0.0.1/private", "not allowed"],
    ["https://user:pass@example.com/article", "credentials"],
  ])("returns 400 for invalid URL input %s", async (url, message) => {
    const response = await route.GET(request(url));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.stringContaining(message));
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("returns disabled before running either rate limit or payment wrapper", async () => {
    process.env.D2A_SCORE_ENABLED = "false";
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("disabled");
    expect(mockDistributedRateLimitByKey).not.toHaveBeenCalled();
  });

  it("returns 503 when the Anthropic key is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("scoring_unavailable");
    expect(mockExtractArticle).not.toHaveBeenCalled();
  });

  it("returns budget_exhausted with Retry-After", async () => {
    mockTryReserveScoreBudget.mockResolvedValueOnce(false);
    mockGetScoreBudgetRetryAfter.mockResolvedValueOnce(123);
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("123");
    expect((await response.json()).reason).toBe("budget_exhausted");
    expect(mockScoreOneText).not.toHaveBeenCalled();
  });

  it.each([422, 502])("preserves extraction status %s", async (status) => {
    mockExtractArticle.mockResolvedValueOnce({ status, error: "extract failed" });
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(status);
    expect(mockTryReserveScoreBudget).not.toHaveBeenCalled();
  });

  it("maps scorer failures to a non-settleable 502", async () => {
    mockScoreOneText.mockRejectedValueOnce(new Error("Anthropic 529"));
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(502);
    expect((await response.json()).reason).toBe("scoring_unavailable");
  });

  it("returns the score shape and overwrites model composite/verdict invariants", async () => {
    const response = await route.GET(request("https://example.com/article#fragment"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({
      url: "https://example.com/article",
      title: "Example",
      source: "example.com",
      author: "Ada",
      engine: "claude",
      cached: false,
    }));
    expect(body.score.composite).toBe(10);
    expect(body.score.verdict).toBe("quality");
    expect(mockScoreOneText).toHaveBeenCalledWith(
      article.data.content,
      undefined,
      "test-key",
      { timeoutMs: 30_000, untrustedNotice: true },
    );
  });

  it("returns a cache hit without extracting or calling the LLM", async () => {
    mockScoreCache.get.mockResolvedValueOnce({
      url: "https://example.com/article",
      title: "Cached",
      source: "example.com",
      scoredAt: "2026-01-01T00:00:00.000Z",
      engine: "claude",
      model: "model",
      cached: false,
      score: rawScore,
    });
    const response = await route.GET(request("https://example.com/article"));
    expect(response.status).toBe(200);
    expect((await response.json()).cached).toBe(true);
    expect(mockExtractArticle).not.toHaveBeenCalled();
    expect(mockScoreOneText).not.toHaveBeenCalled();
  });

  it("classifies cache read and marker SET exceptions as 503", async () => {
    mockScoreCache.get.mockRejectedValueOnce(new Error("read down"));
    const readResponse = await route.GET(request("https://example.com/read"));
    expect(readResponse.status).toBe(503);

    mockScoreCache.get.mockResolvedValueOnce(null);
    mockScoreCache.set.mockRejectedValueOnce(new Error("set down"));
    const markerResponse = await route.GET(request("https://example.com/marker"));
    expect(markerResponse.status).toBe(503);
    expect(mockScoreOneText).not.toHaveBeenCalled();
  });

  it("continues with 200 when only the final cache write fails", async () => {
    mockScoreCache.set.mockImplementation(async (key: string) => {
      if (key.startsWith("in-progress:")) return "OK";
      throw new Error("write down");
    });
    const response = await route.GET(request("https://example.com/write"));
    expect(response.status).toBe(200);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ reason: "cache_write_failed" }) }),
    );
  });

  it("double-checks cache on a busy marker, then returns Retry-After 10", async () => {
    mockScoreCache.set.mockResolvedValueOnce(null);
    mockScoreCache.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const response = await route.GET(request("https://example.com/busy"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mockScoreCache.get).toHaveBeenCalledTimes(2);
  });

  it("enforces outer and inner rate-limit axes", async () => {
    mockDistributedRateLimitByKey.mockImplementation(async (key: string) =>
      key.startsWith("score-pre:")
        ? NextResponse.json({ error: "outer" }, { status: 429 })
        : null);
    expect((await route.GET(request("https://example.com/outer"))).status).toBe(429);

    mockDistributedRateLimitByKey.mockImplementation(async (key: string) =>
      key.startsWith("score:")
        ? NextResponse.json({ error: "inner" }, { status: 429 })
        : null);
    expect((await route.GET(request("https://example.com/inner"))).status).toBe(429);
  });

  it("serves CORS preflight and puts CORS + no-store on every response", async () => {
    const response = await route.OPTIONS(request(undefined, "https://aegis.dwebxr.xyz"));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin"))
      .toBe("https://aegis.dwebxr.xyz");
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });
});

describe("score route deployment guards", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    mockReceiver = "";
    jest.resetModules();
  });

  it("returns payments_unconfigured when neither free mode nor receiver is configured", async () => {
    setNodeEnv("test");
    process.env.D2A_SCORE_ENABLED = "true";
    delete process.env.D2A_SCORE_FREE_ENABLED;
    mockReceiver = "";
    jest.resetModules();
    const isolated = require("@/app/api/d2a/score/route") as ScoreRoute;
    const response = await isolated.GET(request("https://example.com/article"));
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("payments_unconfigured");
  });

  it("fails closed when production KV is unconfigured", async () => {
    setNodeEnv("production");
    process.env.D2A_SCORE_ENABLED = "true";
    delete process.env.D2A_SCORE_FREE_ENABLED;
    delete process.env.KV_REST_API_URL;
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockReceiver = "0x0000000000000000000000000000000000000001";
    mockDistributedRateLimitByKey.mockResolvedValue(null);
    mockScoreCache.get.mockResolvedValue(null);
    mockScoreCache.set.mockResolvedValue("OK");
    jest.resetModules();
    const isolated = require("@/app/api/d2a/score/route") as ScoreRoute;
    const response = await isolated.GET(request("https://example.com/article"));
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("kv_unconfigured");
  });

  it("throws at module load when production free mode is enabled", () => {
    setNodeEnv("production");
    process.env.D2A_SCORE_FREE_ENABLED = "true";
    jest.resetModules();
    expect(() => require("@/app/api/d2a/score/route"))
      .toThrow("must not be enabled in production");
  });
});
