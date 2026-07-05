/**
 * Tests for /api/d2a/briefing preview mode (X402 free tier).
 * Uses jest.isolateModules to test with X402_FREE_TIER_ENABLED=true.
 */
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import type { D2ABriefingResponse } from "@/lib/d2a/types";

const sampleBriefing: D2ABriefingResponse = {
  version: "1.0",
  generatedAt: "2026-03-20T12:00:00.000Z",
  source: "aegis",
  sourceUrl: "https://aegis.dwebxr.xyz",
  summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
  items: [
    {
      title: "Long Article",
      content: "A".repeat(500),
      source: "rss",
      sourceUrl: "https://example.com/1",
      scores: { originality: 7, insight: 8, credibility: 6, composite: 7 },
      verdict: "quality",
      reason: "Good",
      topics: ["AI"],
      briefingScore: 85,
    },
    {
      title: "Short Article",
      content: "Brief.",
      source: "rss",
      sourceUrl: "https://example.com/2",
      scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      verdict: "quality",
      reason: "OK",
      topics: ["DeFi"],
      briefingScore: 60,
    },
  ],
  serendipityPick: {
    title: "Surprise",
    content: "S".repeat(400),
    source: "nostr",
    sourceUrl: "https://example.com/surprise",
    scores: { originality: 9, insight: 9, credibility: 8, composite: 9 },
    verdict: "quality",
    reason: "Novel",
    topics: ["Novel"],
    briefingScore: 95,
  },
  meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI", "DeFi"] },
};

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
}

describe("GET /api/d2a/briefing — preview mode with free tier enabled", () => {
  const origEnv = process.env;

  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    process.env = origEnv;
    jest.resetModules();
  });

  const sampleGlobal = {
    version: "1.0" as const,
    type: "global" as const,
    generatedAt: "2026-03-20T12:00:00.000Z",
    pagination: { offset: 0, limit: 5, total: 1, hasMore: false },
    contributors: [{
      principal: "contrib-1",
      generatedAt: "2026-03-20T11:00:00.000Z",
      summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
      topItems: [
        { title: "Long Article", sourceUrl: "https://example.com/1", topics: ["AI"], briefingScore: 1, verdict: "quality" as const },
        { title: "Short Article", sourceUrl: "https://example.com/2", topics: ["DeFi"], briefingScore: 0.5, verdict: "quality" as const },
      ],
    }],
    aggregatedTopics: ["AI", "DeFi"],
    totalEvaluated: 10,
    totalQualityRate: 0.8,
  };

  function loadRouteWithFreeTier() {
    let GET: (req: NextRequest) => Promise<Response>;

    process.env = { ...origEnv, X402_FREE_TIER_ENABLED: "true" };

    jest.isolateModules(() => {
      jest.mock("@/lib/d2a/briefingProvider", () => ({
        getLatestBriefing: jest.fn().mockResolvedValue(sampleBriefing),
        getGlobalBriefingSummaries: jest.fn().mockResolvedValue(sampleGlobal),
      }));
      jest.mock("@/lib/d2a/x402Server", () => ({
        X402_RECEIVER: "",
        X402_NETWORK: "eip155:84532",
        X402_PRICE: "$0.01",
        resourceServer: {},
      }));

      const route = require("@/app/api/d2a/briefing/route");
      GET = route.GET;
    });

    return GET!;
  }

  it("truncates item content to 200 chars when preview=true", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "true" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Long article should be truncated
    expect(data.items[0].content.length).toBe(203); // 200 + "..."
    expect(data.items[0].content.endsWith("...")).toBe(true);

    // Short article should NOT be truncated
    expect(data.items[1].content).toBe("Brief.");
  });

  it("truncates serendipityPick content in preview mode", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "true" }));
    const data = await res.json();
    expect(data.serendipityPick.content.length).toBe(203);
    expect(data.serendipityPick.content.endsWith("...")).toBe(true);
  });

  it("does NOT truncate when preview=false with free tier enabled", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "false" }));
    const data = await res.json();
    expect(data.items[0].content.length).toBe(500);
  });

  it("does NOT truncate when preview param is absent", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    const data = await res.json();
    expect(data.items[0].content.length).toBe(500);
  });

  it("redacts global topItems sourceUrl under preview (URLs are paid content)", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ preview: "true" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.contributors[0].topItems.map((t: { sourceUrl: string }) => t.sourceUrl)).toEqual(["", ""]);
    // Titles/scores stay visible — same semantics as /changes preview.
    expect(data.contributors[0].topItems[0].title).toBe("Long Article");
  });

  it("keeps global topItems sourceUrl without preview", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({}));
    const data = await res.json();
    expect(data.contributors[0].topItems.map((t: { sourceUrl: string }) => t.sourceUrl))
      .toEqual(["https://example.com/1", "https://example.com/2"]);
  });

  it("preview preserves all non-content fields", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "true" }));
    const data = await res.json();
    expect(data.items[0].title).toBe("Long Article");
    expect(data.items[0].scores.composite).toBe(7);
    expect(data.items[0].topics).toEqual(["AI"]);
    expect(data.version).toBe("1.0");
    expect(data.pagination).toBeDefined();
  });

  it("preview works combined with topic filter", async () => {
    const GET = loadRouteWithFreeTier();
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "true", topics: "DeFi" }));
    const data = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("Short Article");
    expect(data.items[0].content).toBe("Brief."); // short, not truncated
  });
});
