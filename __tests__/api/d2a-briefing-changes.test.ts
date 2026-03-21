/**
 * Tests for GET /api/d2a/briefing/changes endpoint.
 * Covers: validation, filtering by since, response shape, error handling,
 * CORS, rate limiting, and edge cases with malformed data.
 */
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { itemHash } from "@/lib/d2a/filterItems";

jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
  getRawGlobalBriefings: jest.fn(),
}));
jest.mock("@/lib/d2a/x402Server", () => ({
  X402_RECEIVER: "",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  resourceServer: {},
}));

import { GET, OPTIONS } from "@/app/api/d2a/briefing/changes/route";
import { getRawGlobalBriefings } from "@/lib/d2a/briefingProvider";
import type { RawBriefingEntry } from "@/lib/d2a/briefingProvider";

const mockGetRawGlobalBriefings = getRawGlobalBriefings as jest.MockedFunction<typeof getRawGlobalBriefings>;

function makeRequest(params: Record<string, string> = {}, origin?: string): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing/changes");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makeEntry(itemsOverride?: Array<Record<string, unknown>>, generatedAtMs = 1711000000000): RawBriefingEntry {
  return {
    briefing: {
      version: "1.0",
      generatedAt: new Date(generatedAtMs).toISOString(),
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
      items: (itemsOverride ?? [
        {
          title: "Test Article",
          content: "Full content",
          source: "rss",
          sourceUrl: "https://example.com/1",
          scores: { originality: 7, insight: 8, credibility: 6, composite: 7.5 },
          verdict: "quality",
          reason: "Good",
          topics: ["AI"],
          briefingScore: 85,
        },
      ]) as any,
      serendipityPick: null,
      meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI"] },
    },
    generatedAtMs,
  };
}

beforeEach(() => {
  _resetRateLimits();
  mockGetRawGlobalBriefings.mockReset();
});

describe("GET /api/d2a/briefing/changes — validation", () => {
  it("returns 400 when since param is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing required parameter: since");
  });

  it("returns 400 for invalid since date", async () => {
    const res = await GET(makeRequest({ since: "not-a-date" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid since parameter");
  });

  it("returns 400 for empty since param", async () => {
    const res = await GET(makeRequest({ since: "" }));
    expect(res.status).toBe(400);
  });

  it("accepts valid ISO 8601 since param", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    expect(res.status).toBe(200);
  });

  it("accepts date-only since param", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    const res = await GET(makeRequest({ since: "2026-03-20" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/d2a/briefing/changes — response structure", () => {
  it("returns correct response shape with no changes", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.since).toBe("2026-03-20T00:00:00.000Z");
    expect(data.checkedAt).toBeDefined();
    const checkedAtMs = new Date(data.checkedAt).getTime();
    expect(checkedAtMs).not.toBeNaN();
    // checkedAt should be within 5 seconds of now (not a hardcoded value)
    expect(Math.abs(Date.now() - checkedAtMs)).toBeLessThan(5000);
    expect(data.changes).toEqual([]);
  });

  it("returns changes with correct item structure", async () => {
    const entry = makeEntry();
    mockGetRawGlobalBriefings.mockResolvedValue([entry]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.changes).toHaveLength(1);

    const change = data.changes[0];
    expect(change.action).toBe("added");
    expect(change.itemHash).toMatch(/^[a-f0-9]{64}$/);
    expect(change.title).toBe("Test Article");
    expect(change.sourceUrl).toBe("https://example.com/1");
    expect(change.composite).toBe(7.5);
    expect(change.generatedAt).toBeDefined();
  });

  it("itemHash matches direct itemHash computation", async () => {
    const entry = makeEntry();
    mockGetRawGlobalBriefings.mockResolvedValue([entry]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    const expected = itemHash("Test Article", "https://example.com/1");
    expect(data.changes[0].itemHash).toBe(expected);
  });
});

describe("GET /api/d2a/briefing/changes — multiple entries", () => {
  it("returns changes from multiple briefing entries", async () => {
    const entry1 = makeEntry([
      { title: "A1", sourceUrl: "https://a.com/1", scores: { composite: 7 }, content: "x", source: "rss", verdict: "quality", reason: "g", topics: ["AI"], briefingScore: 80 },
      { title: "A2", sourceUrl: "https://a.com/2", scores: { composite: 8 }, content: "x", source: "rss", verdict: "quality", reason: "g", topics: ["AI"], briefingScore: 85 },
    ], 1711000001000);
    const entry2 = makeEntry([
      { title: "B1", sourceUrl: "https://b.com/1", scores: { composite: 9 }, content: "x", source: "nostr", verdict: "quality", reason: "g", topics: ["DeFi"], briefingScore: 90 },
    ], 1711000002000);
    mockGetRawGlobalBriefings.mockResolvedValue([entry1, entry2]);

    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.changes).toHaveLength(3);
    expect(data.changes.map((c: any) => c.title)).toEqual(["A1", "A2", "B1"]);
  });

  it("each change has unique itemHash for different items", async () => {
    const entry = makeEntry([
      { title: "X", sourceUrl: "https://x.com/1", scores: { composite: 5 }, content: "x", source: "rss", verdict: "quality", reason: "g", topics: [], briefingScore: 50 },
      { title: "Y", sourceUrl: "https://y.com/1", scores: { composite: 6 }, content: "y", source: "rss", verdict: "quality", reason: "g", topics: [], briefingScore: 60 },
    ]);
    mockGetRawGlobalBriefings.mockResolvedValue([entry]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.changes[0].itemHash).not.toBe(data.changes[1].itemHash);
  });
});

describe("GET /api/d2a/briefing/changes — edge cases", () => {
  it("handles entry with zero items", async () => {
    const entry = makeEntry([]);
    mockGetRawGlobalBriefings.mockResolvedValue([entry]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.changes).toEqual([]);
  });

  it("handles item with missing scores (composite defaults to 0)", async () => {
    const entry = makeEntry([
      { title: "No Scores", sourceUrl: "https://example.com", content: "x", source: "rss", verdict: "quality", reason: "g", topics: [], briefingScore: 0 },
    ]);
    mockGetRawGlobalBriefings.mockResolvedValue([entry]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const data = await res.json();
    expect(data.changes[0].composite).toBe(0);
  });

  it("passes sinceMs to getRawGlobalBriefings", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    const sinceMs = new Date("2026-03-20T00:00:00Z").getTime();
    expect(mockGetRawGlobalBriefings).toHaveBeenCalledWith(sinceMs);
  });
});

describe("GET /api/d2a/briefing/changes — error handling", () => {
  it("returns 500 when provider throws", async () => {
    mockGetRawGlobalBriefings.mockRejectedValue(new Error("IC timeout"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to fetch changes");
    consoleSpy.mockRestore();
  });
});

describe("GET /api/d2a/briefing/changes — CORS", () => {
  it("applies CORS headers for allowed origin", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }, "https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("omits CORS for unknown origin", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }, "https://evil.com"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("CORS on 400 error response", async () => {
    const res = await GET(makeRequest({}, "https://aegis.dwebxr.xyz"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });
});

describe("OPTIONS /api/d2a/briefing/changes", () => {
  it("returns 204 preflight", async () => {
    const req = new NextRequest("http://localhost/api/d2a/briefing/changes", { method: "OPTIONS" });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
  });
});

describe("GET /api/d2a/briefing/changes — rate limiting", () => {
  it("enforces rate limit", async () => {
    mockGetRawGlobalBriefings.mockResolvedValue([]);
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    }
    const res = await GET(makeRequest({ since: "2026-03-20T00:00:00Z" }));
    expect(res.status).toBe(429);
  });
});
