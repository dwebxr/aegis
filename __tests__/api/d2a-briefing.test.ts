import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock briefingProvider before importing route
jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
}));

// Mock x402 — when X402_RECEIVER is empty, route uses handleGet directly
jest.mock("@/lib/d2a/x402Server", () => ({
  X402_RECEIVER: "",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  resourceServer: {},
}));

import { GET, OPTIONS } from "@/app/api/d2a/briefing/route";
import { getLatestBriefing, getGlobalBriefingSummaries } from "@/lib/d2a/briefingProvider";

const mockGetLatestBriefing = getLatestBriefing as jest.MockedFunction<typeof getLatestBriefing>;
const mockGetGlobalBriefingSummaries = getGlobalBriefingSummaries as jest.MockedFunction<typeof getGlobalBriefingSummaries>;

function makeRequest(params?: Record<string, string>, origin?: string): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing");
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new NextRequest(url.toString(), { method: "GET", headers });
}

const sampleBriefing = {
  version: "1.0" as const,
  generatedAt: "2025-01-01T00:00:00.000Z",
  source: "aegis" as const,
  sourceUrl: "https://aegis.dwebxr.xyz" as const,
  summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
  items: [{
    title: "Test Article",
    content: "Full content of test article",
    source: "rss",
    sourceUrl: "https://example.com",
    scores: { originality: 7, insight: 8, credibility: 6, composite: 7 },
    verdict: "quality" as const,
    reason: "Good",
    topics: ["tech"],
    briefingScore: 85,
  }],
  serendipityPick: null,
  meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: ["tech"] },
};

const sampleGlobalBriefing = {
  version: "1.0" as const,
  type: "global" as const,
  generatedAt: "2025-01-01T00:00:00.000Z",
  pagination: { offset: 0, limit: 5, total: 2 },
  contributors: [{
    principal: "rrkah-fqaaa-aaaaa-aaaaq-cai",
    generatedAt: "2025-01-01T00:00:00.000Z",
    summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
    topItems: [
      { title: "Test Article", topics: ["tech"], briefingScore: 85, verdict: "quality" as const },
    ],
  }],
  aggregatedTopics: ["tech"],
  totalEvaluated: 10,
  totalQualityRate: 0.8,
};

describe("GET /api/d2a/briefing — individual path", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockGetLatestBriefing.mockReset();
    mockGetGlobalBriefingSummaries.mockReset();
  });

  it("returns 404 when principal has no data", async () => {
    mockGetLatestBriefing.mockResolvedValue(null);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.hint).toContain("no briefing data");
  });

  it("returns 200 with briefing when data exists", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBe("1.0");
    expect(data.items).toHaveLength(1);
  });

  it("passes principal to getLatestBriefing", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    await GET(makeRequest({ principal: "rrkah-fqaaa-aaaaa-aaaaq-cai" }));
    expect(mockGetLatestBriefing).toHaveBeenCalledWith("rrkah-fqaaa-aaaaa-aaaaq-cai");
  });

  it("returns 500 when getLatestBriefing throws", async () => {
    mockGetLatestBriefing.mockRejectedValue(new Error("IC network error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to fetch");
    consoleSpy.mockRestore();
  });

  it("omits CORS allow-origin for unknown origin on success", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("reflects known origin on success", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }, "https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("returns full briefing structure with items and meta", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    const data = await res.json();
    expect(data.source).toBe("aegis");
    expect(data.meta.scoringModel).toBe("aegis-vcl-v1");
    expect(data.summary.totalEvaluated).toBe(10);
    expect(data.items[0].scores.originality).toBe(7);
  });
});

describe("GET /api/d2a/briefing — global path", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockGetLatestBriefing.mockReset();
    mockGetGlobalBriefingSummaries.mockReset();
  });

  it("calls getGlobalBriefingSummaries when no principal param", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(null);
    await GET(makeRequest());
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(0, 5);
    expect(mockGetLatestBriefing).not.toHaveBeenCalled();
  });

  it("returns global briefings when data exists", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("global");
    expect(data.contributors).toHaveLength(1);
    expect(data.pagination.total).toBe(2);
  });

  it("returns 404 when no global briefings available", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.hint).toContain("No users have opted into D2A");
  });

  it("passes offset and limit query params", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    await GET(makeRequest({ offset: "10", limit: "3" }));
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(10, 3);
  });

  it("clamps limit to max 10", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    await GET(makeRequest({ limit: "50" }));
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(0, 10);
  });

  it("defaults offset=0 limit=5 when params absent", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    await GET(makeRequest());
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(0, 5);
  });

  it("returns 500 when getGlobalBriefingSummaries throws", async () => {
    mockGetGlobalBriefingSummaries.mockRejectedValue(new Error("IC error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it("includes aggregatedTopics and totalEvaluated in response", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.aggregatedTopics).toContain("tech");
    expect(data.totalEvaluated).toBe(10);
    expect(data.totalQualityRate).toBe(0.8);
  });

  it("includes pagination metadata", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.pagination).toEqual({ offset: 0, limit: 5, total: 2 });
  });

  it("applies CORS for allowed origins", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(sampleGlobalBriefing);
    const res = await GET(makeRequest({}, "https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("omits CORS for unknown origins on 404", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /api/d2a/briefing — rate limiting", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockGetLatestBriefing.mockReset();
    mockGetGlobalBriefingSummaries.mockReset();
  });

  it("enforces rate limit of 30 per minute", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest());
    }
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });
});

describe("OPTIONS /api/d2a/briefing", () => {
  it("returns 204 preflight", async () => {
    const req = new NextRequest("http://localhost/api/d2a/briefing", { method: "OPTIONS" });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
  });

  it("exposes x402 payment headers", async () => {
    const req = new NextRequest("http://localhost/api/d2a/briefing", {
      method: "OPTIONS",
      headers: { origin: "https://aegis.dwebxr.xyz" },
    });
    const res = await OPTIONS(req);
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("PAYMENT-REQUIRED");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-PAYMENT");
  });
});
