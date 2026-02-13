import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock briefingProvider before importing route
jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
}));

// Mock x402 — when X402_RECEIVER is empty, route uses handleGet directly
jest.mock("@/lib/d2a/x402Server", () => ({
  X402_RECEIVER: "",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  resourceServer: {},
}));

import { GET, OPTIONS } from "@/app/api/d2a/briefing/route";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";

const mockGetLatestBriefing = getLatestBriefing as jest.MockedFunction<typeof getLatestBriefing>;

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

describe("GET /api/d2a/briefing (ungated)", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockGetLatestBriefing.mockReset();
  });

  it("returns 404 when no principal provided", async () => {
    mockGetLatestBriefing.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No briefing");
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

  it("passes undefined when no principal param", async () => {
    mockGetLatestBriefing.mockResolvedValue(null);
    await GET(makeRequest());
    expect(mockGetLatestBriefing).toHaveBeenCalledWith(undefined);
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

  it("omits CORS allow-origin for unknown origin on 404", async () => {
    mockGetLatestBriefing.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits CORS allow-origin for unknown origin on 500", async () => {
    mockGetLatestBriefing.mockRejectedValue(new Error("fail"));
    jest.spyOn(console, "error").mockImplementation();
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    jest.restoreAllMocks();
  });

  it("reflects known origin on all responses", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }, "https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("enforces rate limit of 30 per minute", async () => {
    mockGetLatestBriefing.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest());
    }
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
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
