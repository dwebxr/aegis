jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn() },
  Actor: { createActor: jest.fn() },
}));

jest.mock("@dfinity/principal", () => {
  return {
    Principal: {
      fromText: jest.fn((t: string) => {
        if (!/^[a-z0-9-]+$/i.test(t) || t.length < 5) {
          throw new Error("Bad principal");
        }
        return { toText: () => t };
      }),
    },
  };
});

jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
}));

import { GET as RSS_GET } from "@/app/api/feed/rss/route";
import { GET as ATOM_GET } from "@/app/api/feed/atom/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import type { D2ABriefingResponse } from "@/lib/d2a/types";

const PRINCIPAL = "rrkah-fqaaa-aaaaa-aaaaq-cai";

function makeBriefing(): D2ABriefingResponse {
  return {
    version: "1.0",
    generatedAt: "2026-04-15T07:00:00.000Z",
    source: "aegis",
    sourceUrl: "https://aegis-ai.xyz",
    summary: { totalEvaluated: 10, totalBurned: 3, qualityRate: 70 },
    items: [
      {
        title: "First",
        content: "Body of the first article",
        source: "rss",
        sourceUrl: "https://example.com/1",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 },
        verdict: "quality",
        reason: "good",
        topics: ["tech"],
        briefingScore: 8.0,
      },
    ],
    serendipityPick: null,
    meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: ["tech"] },
  };
}

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "GET" });
}

describe("GET /api/feed/rss", () => {
  beforeEach(() => {
    _resetRateLimits();
    (getLatestBriefing as jest.Mock).mockReset();
  });

  it("returns 400 when principal query param is missing", async () => {
    const res = await RSS_GET(makeReq("/api/feed/rss"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/principal/);
  });

  it("returns 400 when principal is invalid", async () => {
    const res = await RSS_GET(makeReq("/api/feed/rss?principal=!!"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid principal/);
  });

  it("returns 404 when no briefing exists for the principal", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(null);
    const res = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(res.status).toBe(404);
  });

  it("returns 200 RSS XML when briefing exists", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(makeBriefing());
    const res = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toMatch(/<rss[^>]*version="2\.0"/);
    expect(xml).toContain("First");
  });

  it("includes Cache-Control header for edge caching", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(makeBriefing());
    const res = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

  it("emits Aegis observability headers", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(makeBriefing());
    const res = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(res.headers.get("X-Aegis-Briefing-Items")).toBe("1");
    expect(res.headers.get("X-Aegis-Generated-At")).toBe("2026-04-15T07:00:00.000Z");
  });
});

describe("GET /api/feed/atom", () => {
  beforeEach(() => {
    _resetRateLimits();
    (getLatestBriefing as jest.Mock).mockReset();
  });

  it("returns 200 Atom XML when briefing exists", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(makeBriefing());
    const res = await ATOM_GET(makeReq(`/api/feed/atom?principal=${PRINCIPAL}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/atom+xml");
    const xml = await res.text();
    expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
  });

  it("returns 400 when principal missing", async () => {
    const res = await ATOM_GET(makeReq("/api/feed/atom"));
    expect(res.status).toBe(400);
  });
});
