/**
 * Tests for /api/d2a/briefing pagination, filtering, and preview features.
 * Exercises the actual route handler with mocked IC provider.
 */
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
}));
jest.mock("@/lib/d2a/x402Server", () => ({
  X402_RECEIVER: "",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  resourceServer: {},
}));

import { GET } from "@/app/api/d2a/briefing/route";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import type { D2ABriefingResponse } from "@/lib/d2a/types";

const mockGetLatestBriefing = getLatestBriefing as jest.MockedFunction<typeof getLatestBriefing>;

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
}

const items = Array.from({ length: 8 }, (_, i) => ({
  title: `Article ${i}`,
  content: "X".repeat(300) + ` content-${i}`,
  source: "rss",
  sourceUrl: `https://example.com/${i}`,
  scores: { originality: 7, insight: 8, credibility: 6, composite: 7 + (i % 3) },
  verdict: "quality" as const,
  reason: "Good",
  topics: i < 4 ? ["AI", "Tech"] : ["DeFi", "Crypto"],
  briefingScore: 80 + i,
}));

const sampleBriefing: D2ABriefingResponse = {
  version: "1.0",
  generatedAt: "2026-03-20T12:00:00.000Z",
  source: "aegis",
  sourceUrl: "https://aegis.dwebxr.xyz",
  summary: { totalEvaluated: 20, totalBurned: 4, qualityRate: 0.8 },
  items,
  serendipityPick: {
    title: "Serendipity",
    content: "S".repeat(300),
    source: "nostr",
    sourceUrl: "https://example.com/serendipity",
    scores: { originality: 9, insight: 9, credibility: 8, composite: 9 },
    verdict: "quality",
    reason: "Novel",
    topics: ["Novel"],
    briefingScore: 95,
  },
  meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI", "DeFi"] },
};

beforeEach(() => {
  _resetRateLimits();
  mockGetLatestBriefing.mockReset();
});

describe("GET /api/d2a/briefing — pagination", () => {
  it("returns pagination field in response", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    const data = await res.json();
    expect(data.pagination).toBeDefined();
    expect(data.pagination.offset).toBe(0);
    expect(data.pagination.limit).toBe(50);
    expect(data.pagination.total).toBe(8);
    expect(data.pagination.hasMore).toBe(false);
  });

  it("respects custom limit", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", limit: "3" }));
    const data = await res.json();
    expect(data.items).toHaveLength(3);
    expect(data.pagination.limit).toBe(3);
    expect(data.pagination.hasMore).toBe(true);
  });

  it("respects custom offset", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", offset: "5", limit: "10" }));
    const data = await res.json();
    expect(data.items).toHaveLength(3); // 8 - 5 = 3
    expect(data.items[0].title).toBe("Article 5");
    expect(data.pagination.offset).toBe(5);
    expect(data.pagination.hasMore).toBe(false);
  });

  it("returns empty items when offset exceeds total", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", offset: "100" }));
    const data = await res.json();
    expect(data.items).toHaveLength(0);
    expect(data.pagination.total).toBe(8);
  });

  it("clamps limit to max 100", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", limit: "500" }));
    const data = await res.json();
    expect(data.pagination.limit).toBe(100);
  });
});

describe("GET /api/d2a/briefing — topic filtering", () => {
  it("filters items by single topic", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", topics: "AI" }));
    const data = await res.json();
    expect(data.items).toHaveLength(4); // items 0-3 have AI
    expect(data.pagination.total).toBe(4);
    for (const item of data.items) {
      expect(item.topics.map((t: string) => t.toLowerCase())).toContain("ai");
    }
  });

  it("filters by multiple topics (OR logic)", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", topics: "AI,DeFi" }));
    const data = await res.json();
    expect(data.items).toHaveLength(8); // all items match
  });

  it("topic filter is case-insensitive", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", topics: "ai" }));
    const data = await res.json();
    expect(data.items).toHaveLength(4);
  });

  it("returns empty for non-matching topic", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", topics: "Gaming" }));
    const data = await res.json();
    expect(data.items).toHaveLength(0);
    expect(data.pagination.total).toBe(0);
  });

  it("combines topic filter with pagination", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", topics: "AI", limit: "2", offset: "1" }));
    const data = await res.json();
    expect(data.items).toHaveLength(2);
    expect(data.pagination.total).toBe(4);
    expect(data.pagination.hasMore).toBe(true);
  });
});

describe("GET /api/d2a/briefing — since filter", () => {
  it("returns all items when since is before briefing generatedAt", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", since: "2026-03-19T00:00:00Z" }));
    const data = await res.json();
    expect(data.items).toHaveLength(8);
  });

  it("returns empty when since is after briefing generatedAt", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", since: "2026-03-21T00:00:00Z" }));
    const data = await res.json();
    expect(data.items).toHaveLength(0);
  });

  it("ignores invalid since parameter (returns all items)", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", since: "not-a-date" }));
    const data = await res.json();
    // Invalid since is ignored → all items returned
    expect(data.items).toHaveLength(8);
  });

  it("combines since + topics + pagination", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({
      principal: "aaaaa-aa",
      since: "2026-03-19T00:00:00Z",
      topics: "DeFi",
      limit: "2",
      offset: "0",
    }));
    const data = await res.json();
    expect(data.items).toHaveLength(2);
    expect(data.pagination.total).toBe(4);
    expect(data.pagination.hasMore).toBe(true);
  });
});

describe("GET /api/d2a/briefing — preview mode (free tier disabled)", () => {
  // X402_FREE_TIER_ENABLED is not set, so preview should be ignored
  it("does not truncate content even when preview=true (free tier disabled)", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa", preview: "true" }));
    const data = await res.json();
    // Content should NOT be truncated because X402_FREE_TIER_ENABLED is not "true"
    expect(data.items[0].content.length).toBeGreaterThan(200);
  });
});

describe("GET /api/d2a/briefing — response structure validation", () => {
  it("includes all required fields in paginated response", async () => {
    mockGetLatestBriefing.mockResolvedValue(sampleBriefing);
    const res = await GET(makeRequest({ principal: "aaaaa-aa" }));
    const data = await res.json();

    // Top-level fields
    expect(data.version).toBe("1.0");
    expect(data.generatedAt).toBe("2026-03-20T12:00:00.000Z");
    expect(data.source).toBe("aegis");
    expect(data.sourceUrl).toBe("https://aegis.dwebxr.xyz");
    expect(data.summary).toEqual({ totalEvaluated: 20, totalBurned: 4, qualityRate: 0.8 });
    expect(data.meta).toEqual({ scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI", "DeFi"] });

    // Pagination
    expect(data.pagination).toEqual({
      offset: 0,
      limit: 50,
      total: 8,
      hasMore: false,
    });

    // Serendipity pick preserved
    expect(data.serendipityPick).not.toBeNull();
    expect(data.serendipityPick.title).toBe("Serendipity");

    // Items have full structure
    const item = data.items[0];
    expect(item.title).toBeDefined();
    expect(item.content).toBeDefined();
    expect(item.scores.composite).toBeDefined();
    expect(Array.isArray(item.topics)).toBe(true);
  });
});
