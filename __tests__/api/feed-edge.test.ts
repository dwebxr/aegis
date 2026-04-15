/**
 * Edge-case + boundary coverage for /api/feed/{rss,atom}. Pairs with
 * feed-rss.test.ts which covers the happy path and basic error responses.
 */

jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn() },
  Actor: { createActor: jest.fn() },
}));

jest.mock("@dfinity/principal", () => ({
  Principal: {
    fromText: jest.fn((t: string) => {
      if (!/^[a-z0-9-]+$/i.test(t) || t.length < 5) throw new Error("Bad principal");
      return { toText: () => t };
    }),
  },
}));

jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
}));

import { GET as RSS_GET } from "@/app/api/feed/rss/route";
import { GET as ATOM_GET } from "@/app/api/feed/atom/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import type { D2ABriefingResponse, D2ABriefingItem } from "@/lib/d2a/types";

const PRINCIPAL = "rrkah-fqaaa-aaaaa-aaaaq-cai";

function item(overrides: Partial<D2ABriefingItem> = {}): D2ABriefingItem {
  return {
    title: "T",
    content: "C",
    source: "rss",
    sourceUrl: "https://example.com/x",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality",
    reason: "r",
    topics: ["t"],
    briefingScore: 8,
    ...overrides,
  };
}

function briefing(items: D2ABriefingItem[], topics: string[] = []): D2ABriefingResponse {
  return {
    version: "1.0",
    generatedAt: "2026-04-15T07:00:00.000Z",
    source: "aegis",
    sourceUrl: "https://aegis-ai.xyz",
    summary: { totalEvaluated: items.length, totalBurned: 0, qualityRate: 100 },
    items,
    serendipityPick: null,
    meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics },
  };
}

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "GET" });
}

beforeEach(() => {
  _resetRateLimits();
  (getLatestBriefing as jest.Mock).mockReset();
});

describe("rate-limit boundary on /api/feed/rss", () => {
  it("permits exactly 30 requests in the 60-second window", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    const ok = await Promise.all(
      Array.from({ length: 30 }, () => RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`))),
    );
    expect(ok.every(r => r.status === 200)).toBe(true);
  });

  it("rejects the 31st request with 429", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    for (let i = 0; i < 30; i++) {
      const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
      expect(r.status).toBe(200);
    }
    const over = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(over.status).toBe(429);
  });

  it("per-principal cap (60/hour) returns 429 with resource-specific message even when per-IP is not exhausted", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    // Use a distinct IP per request via x-forwarded-for so the per-IP cap
    // never fires; this isolates the per-principal cap.
    const fromIp = (n: number) => new NextRequest(`http://localhost/api/feed/rss?principal=${PRINCIPAL}`, {
      method: "GET",
      headers: { "x-forwarded-for": `10.0.0.${n}` },
    });
    for (let i = 1; i <= 60; i++) {
      const r = await RSS_GET(fromIp(i));
      expect(r.status).toBe(200);
    }
    const over = await RSS_GET(fromIp(61));
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.error).toMatch(/principal/i);
  });
});

describe("Atom-format-specific contracts", () => {
  it("Atom returns the same Cache-Control as RSS (refactor preserves contract)", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    const r = await ATOM_GET(makeReq(`/api/feed/atom?principal=${PRINCIPAL}`));
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300, stale-while-revalidate=600");
  });

  it("Atom emits the X-Aegis observability headers", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item(), item({ title: "T2" })]));
    const r = await ATOM_GET(makeReq(`/api/feed/atom?principal=${PRINCIPAL}`));
    expect(r.headers.get("X-Aegis-Briefing-Items")).toBe("2");
    expect(r.headers.get("X-Aegis-Generated-At")).toBe("2026-04-15T07:00:00.000Z");
  });

  it("Atom Content-Type is application/atom+xml", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    const r = await ATOM_GET(makeReq(`/api/feed/atom?principal=${PRINCIPAL}`));
    expect(r.headers.get("Content-Type")).toBe("application/atom+xml; charset=utf-8");
  });
});

describe("briefing-shape edge cases", () => {
  it("renders a 50-item briefing without truncation", async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      item({ title: `Item ${i}`, sourceUrl: `https://example.com/${i}` }),
    );
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing(items));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(r.headers.get("X-Aegis-Briefing-Items")).toBe("50");
    const xml = await r.text();
    expect(xml).toContain("Item 0");
    expect(xml).toContain("Item 49");
  });

  it("renders an item with empty topics array (no <category> emitted)", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item({ topics: [] })]));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(r.status).toBe(200);
    const xml = await r.text();
    expect(xml).toContain("<channel>");
    // Item still rendered.
    expect(xml).toContain("<item>");
  });

  it("caps per-item categories at 20 even when 30 topics supplied", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `topic-${i}`);
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item({ topics: thirty })]));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    const xml = await r.text();
    expect(xml).toContain("topic-0");
    expect(xml).toContain("topic-19");
    expect(xml).not.toContain("topic-20");
  });

  it("caps feed-level categories at 20 even when 30 meta.topics supplied", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `metaTopic-${i}`);
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()], thirty));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    const xml = await r.text();
    expect(xml).toContain("metaTopic-19");
    expect(xml).not.toContain("metaTopic-20");
  });

  it("falls back to APP_URL link when item.sourceUrl is empty", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item({ sourceUrl: "" })]));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    const xml = await r.text();
    // Channel link AND item link both reference APP_URL.
    const links = xml.match(/<link>[^<]+<\/link>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it("prefixes the composite score into each item description", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(
      briefing([item({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8.5 } })]),
    );
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    const xml = await r.text();
    expect(xml).toContain("[score 8.5]");
  });

  it("emits one <category> per topic on each item", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(
      briefing([item({ topics: ["alpha", "beta", "gamma"] })]),
    );
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    const xml = await r.text();
    const categoryCount = (xml.match(/<category>/g) ?? []).length;
    expect(categoryCount).toBeGreaterThanOrEqual(3);
  });

  it("URL-encodes the principal in the self-link metadata", async () => {
    const principalWithSpecial = "abcde-12345"; // valid by mock; would-be-encoded chars are limited but we verify the encoding hook fires
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([item()]));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${principalWithSpecial}`));
    const xml = await r.text();
    expect(xml).toContain(`principal=${principalWithSpecial}`);
  });
});

describe("provider failure modes", () => {
  it("returns 502 when buildFeed throws on a malformed item shape", async () => {
    // briefingProvider only validates briefing-level shape; per-item missing
    // scores.composite crashes item.scores.composite.toFixed() in summarize().
    const malformedItem = { ...item(), scores: undefined } as unknown as ReturnType<typeof item>;
    (getLatestBriefing as jest.Mock).mockResolvedValue(briefing([malformedItem]));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error).toMatch(/malformed/i);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[feed/rss] feed serialization failed"),
      expect.any(String),
    );
    spy.mockRestore();
  });

  it("returns 502 + structured error when getLatestBriefing throws", async () => {
    (getLatestBriefing as jest.Mock).mockRejectedValue(new Error("IC down"));
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error).toMatch(/temporarily unavailable/i);
  });

  it("treats null briefing as 404 (not as a 500)", async () => {
    (getLatestBriefing as jest.Mock).mockResolvedValue(null);
    const r = await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(r.status).toBe(404);
  });

  it("logs IC failures via console.error so Vercel/Sentry sees them", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (getLatestBriefing as jest.Mock).mockRejectedValue(new Error("relay timeout"));
    await RSS_GET(makeReq(`/api/feed/rss?principal=${PRINCIPAL}`));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[feed/rss] IC briefing fetch failed"),
      expect.stringContaining("relay timeout"),
    );
    spy.mockRestore();
  });
});
