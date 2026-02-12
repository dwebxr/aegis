import type { D2ABriefingItem, D2ABriefingResponse } from "@/lib/d2a/types";

describe("D2ABriefingItem type", () => {
  it("accepts valid item with all fields", () => {
    const item: D2ABriefingItem = {
      title: "Test Article",
      content: "Full content here",
      source: "rss",
      sourceUrl: "https://example.com",
      scores: {
        originality: 7,
        insight: 8,
        credibility: 6,
        composite: 7.5,
        vSignal: 8.0,
        cContext: 6.5,
        lSlop: 1.2,
      },
      verdict: "quality",
      reason: "Good analysis",
      topics: ["tech", "ai"],
      briefingScore: 85,
    };
    expect(item.title).toBe("Test Article");
    expect(item.scores.vSignal).toBe(8.0);
  });

  it("accepts item with optional V/C/L scores omitted", () => {
    const item: D2ABriefingItem = {
      title: "Test",
      content: "Content",
      source: "manual",
      sourceUrl: "",
      scores: {
        originality: 5,
        insight: 5,
        credibility: 5,
        composite: 5,
      },
      verdict: "slop",
      reason: "Low quality",
      topics: [],
      briefingScore: 20,
    };
    expect(item.scores.vSignal).toBeUndefined();
    expect(item.scores.cContext).toBeUndefined();
    expect(item.scores.lSlop).toBeUndefined();
  });

  it("enforces verdict as 'quality' or 'slop'", () => {
    const quality: D2ABriefingItem["verdict"] = "quality";
    const slop: D2ABriefingItem["verdict"] = "slop";
    expect(quality).toBe("quality");
    expect(slop).toBe("slop");
  });

  it("allows empty topics array", () => {
    const item: D2ABriefingItem = {
      title: "T",
      content: "C",
      source: "url",
      sourceUrl: "https://x.com",
      scores: { originality: 1, insight: 1, credibility: 1, composite: 1 },
      verdict: "slop",
      reason: "R",
      topics: [],
      briefingScore: 0,
    };
    expect(item.topics).toEqual([]);
  });

  it("allows zero scores", () => {
    const item: D2ABriefingItem = {
      title: "T",
      content: "C",
      source: "nostr",
      sourceUrl: "",
      scores: { originality: 0, insight: 0, credibility: 0, composite: 0, vSignal: 0, cContext: 0, lSlop: 0 },
      verdict: "slop",
      reason: "R",
      topics: [],
      briefingScore: 0,
    };
    expect(item.scores.composite).toBe(0);
    expect(item.scores.vSignal).toBe(0);
  });

  it("allows max scores (10)", () => {
    const item: D2ABriefingItem = {
      title: "T",
      content: "C",
      source: "twitter",
      sourceUrl: "",
      scores: { originality: 10, insight: 10, credibility: 10, composite: 10, vSignal: 10, cContext: 10, lSlop: 10 },
      verdict: "quality",
      reason: "R",
      topics: ["all"],
      briefingScore: 100,
    };
    expect(item.scores.originality).toBe(10);
  });
});

describe("D2ABriefingResponse type", () => {
  it("accepts valid response with all fields", () => {
    const response: D2ABriefingResponse = {
      version: "1.0",
      generatedAt: "2025-01-01T00:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 50, totalBurned: 10, qualityRate: 0.8 },
      items: [],
      serendipityPick: null,
      meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: [] },
    };
    expect(response.version).toBe("1.0");
    expect(response.source).toBe("aegis");
  });

  it("version is literal '1.0'", () => {
    const v: D2ABriefingResponse["version"] = "1.0";
    expect(v).toBe("1.0");
  });

  it("source is literal 'aegis'", () => {
    const s: D2ABriefingResponse["source"] = "aegis";
    expect(s).toBe("aegis");
  });

  it("sourceUrl is literal aegis URL", () => {
    const u: D2ABriefingResponse["sourceUrl"] = "https://aegis.dwebxr.xyz";
    expect(u).toBe("https://aegis.dwebxr.xyz");
  });

  it("accepts serendipityPick as null", () => {
    const response: D2ABriefingResponse = {
      version: "1.0",
      generatedAt: "2025-01-01T00:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 0, totalBurned: 0, qualityRate: 0 },
      items: [],
      serendipityPick: null,
      meta: { scoringModel: "test", nostrPubkey: null, topics: [] },
    };
    expect(response.serendipityPick).toBeNull();
  });

  it("accepts serendipityPick as D2ABriefingItem", () => {
    const pick: D2ABriefingItem = {
      title: "Surprise",
      content: "Unexpected find",
      source: "nostr",
      sourceUrl: "",
      scores: { originality: 9, insight: 7, credibility: 8, composite: 8 },
      verdict: "quality",
      reason: "Novel perspective",
      topics: ["discovery"],
      briefingScore: 65,
    };
    const response: D2ABriefingResponse = {
      version: "1.0",
      generatedAt: "2025-01-01T00:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 10, totalBurned: 0, qualityRate: 1.0 },
      items: [],
      serendipityPick: pick,
      meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: "npub1abc", topics: ["discovery"] },
    };
    expect(response.serendipityPick!.title).toBe("Surprise");
  });

  it("meta.nostrPubkey can be string or null", () => {
    const withPubkey: D2ABriefingResponse["meta"] = {
      scoringModel: "test",
      nostrPubkey: "npub1xyz",
      topics: [],
    };
    const withoutPubkey: D2ABriefingResponse["meta"] = {
      scoringModel: "test",
      nostrPubkey: null,
      topics: [],
    };
    expect(withPubkey.nostrPubkey).toBe("npub1xyz");
    expect(withoutPubkey.nostrPubkey).toBeNull();
  });

  it("is JSON-serializable and round-trips correctly", () => {
    const response: D2ABriefingResponse = {
      version: "1.0",
      generatedAt: "2025-06-01T00:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 100, totalBurned: 20, qualityRate: 0.8 },
      items: [{
        title: "Article",
        content: "Content",
        source: "rss",
        sourceUrl: "https://example.com",
        scores: { originality: 7, insight: 8, credibility: 6, composite: 7, vSignal: 8.5, cContext: 6.2, lSlop: 1.1 },
        verdict: "quality",
        reason: "Good",
        topics: ["tech"],
        briefingScore: 85,
      }],
      serendipityPick: null,
      meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: "npub1test", topics: ["tech"] },
    };
    const json = JSON.stringify(response);
    const parsed = JSON.parse(json) as D2ABriefingResponse;
    expect(parsed).toEqual(response);
  });
});
