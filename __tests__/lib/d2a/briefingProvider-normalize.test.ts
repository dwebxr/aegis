/**
 * Read-time briefingScore normalization.
 *
 * On-chain briefingScore = rank score × exp(-λ·age) frozen at publish time —
 * weeks-old content collapses to ~1e-20 (ordering valid, absolute value
 * useless for display/thresholds; reported by the first paying JPYC consumer).
 * The API layer must serve briefing-relative scores: top item = 1, others
 * proportional, applied to briefings ALREADY stored on-chain.
 */
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn() },
  Actor: { createActor: jest.fn() },
}));

jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: jest.fn((t: string) => ({ toText: () => t })) },
}));

import { getLatestBriefing, getGlobalBriefingSummaries } from "@/lib/d2a/briefingProvider";
import { HttpAgent, Actor } from "@dfinity/agent";

function makeItem(briefingScore: number, title = "item") {
  return {
    title,
    content: `${title} content`,
    source: "rss",
    sourceUrl: "https://example.com/a",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "good",
    topics: ["tech"],
    briefingScore,
  };
}

function makeBriefing(scores: number[], serendipityScore: number | null = null) {
  return {
    version: "1.0",
    generatedAt: "2026-07-05T00:00:00.000Z",
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
    items: scores.map((s, i) => makeItem(s, `item-${i}`)),
    serendipityPick: serendipityScore !== null ? makeItem(serendipityScore, "serendipity") : null,
    meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: ["tech"] },
  };
}

const mockActor = {
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (HttpAgent.create as jest.Mock).mockResolvedValue({});
  (Actor.createActor as jest.Mock).mockReturnValue(mockActor);
});

describe("getLatestBriefing — briefingScore normalization", () => {
  it("rescales collapsed decay scores so the top item is 1 and order is preserved", async () => {
    // Real-world shape of the report: e-20-scale values.
    mockActor.getLatestBriefing.mockResolvedValue([
      JSON.stringify(makeBriefing([3e-20, 1.5e-20, 6e-21])),
    ]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).not.toBeNull();
    expect(result!.items.map(i => i.briefingScore)).toEqual([1, 0.5, 0.2]);
  });

  it("leaves serendipityPick untouched (different score scale, no decay factor)", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([
      JSON.stringify(makeBriefing([2e-20, 1e-20], 4.2)),
    ]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result!.items[0].briefingScore).toBe(1);
    // Normalizing serendipity against the decayed item max would explode it
    // (4.2 / 2e-20); it must pass through raw.
    expect(result!.serendipityPick!.briefingScore).toBe(4.2);
  });

  it("is a no-op when no item has a positive finite score", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([
      JSON.stringify(makeBriefing([0, 0])),
    ]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result!.items.map(i => i.briefingScore)).toEqual([0, 0]);
  });

  it("floors tiny-but-positive ratios to 0.0001 — ranked items never serialize as 0", async () => {
    // A fresh top item next to a weeks-older one: ratio 1e-20 rounds to 0 at
    // 4 decimals, but a consumer thresholding on `> 0` must keep the item.
    mockActor.getLatestBriefing.mockResolvedValue([
      JSON.stringify(makeBriefing([5, 1e-20])),
    ]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result!.items.map(i => i.briefingScore)).toEqual([1, 0.0001]);
  });

  it("maps non-finite/negative scores to 0 instead of NaN", async () => {
    const briefing = makeBriefing([2e-20]);
    briefing.items.push({ ...makeItem(0, "bad"), briefingScore: -5 });
    mockActor.getLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result!.items.map(i => i.briefingScore)).toEqual([1, 0]);
  });
});

describe("getGlobalBriefingSummaries — topItems normalization", () => {
  it("normalizes each contributor's topItems within that contributor's briefing", async () => {
    mockActor.getGlobalBriefingSummaries.mockResolvedValue({
      total: 1n,
      items: [[
        { toText: () => "contrib-1" },
        JSON.stringify(makeBriefing([8e-21, 4e-21, 2e-21, 1e-21])),
        1_783_000_000_000_000_000n,
      ]],
    });
    const result = await getGlobalBriefingSummaries(0, 5);
    expect(result).not.toBeNull();
    // Top 3 of 4 items, each relative to the contributor's own max.
    expect(result!.contributors[0].topItems.map(t => t.briefingScore)).toEqual([1, 0.5, 0.25]);
  });

  it("includes each top item's sourceUrl in the index", async () => {
    mockActor.getGlobalBriefingSummaries.mockResolvedValue({
      total: 1n,
      items: [[
        { toText: () => "contrib-1" },
        JSON.stringify(makeBriefing([2e-20, 1e-20])),
        1_783_000_000_000_000_000n,
      ]],
    });
    const result = await getGlobalBriefingSummaries(0, 5);
    expect(result!.contributors[0].topItems.map(t => t.sourceUrl))
      .toEqual(["https://example.com/a", "https://example.com/a"]);
  });

  it("serializes a missing/malformed sourceUrl as empty string", async () => {
    const briefing = makeBriefing([2e-20]);
    delete (briefing.items[0] as Record<string, unknown>).sourceUrl;
    mockActor.getGlobalBriefingSummaries.mockResolvedValue({
      total: 1n,
      items: [[{ toText: () => "contrib-1" }, JSON.stringify(briefing), 1_783_000_000_000_000_000n]],
    });
    const result = await getGlobalBriefingSummaries(0, 5);
    expect(result!.contributors[0].topItems[0].sourceUrl).toBe("");
  });
});
