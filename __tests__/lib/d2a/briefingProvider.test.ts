import { NextRequest } from "next/server";

// Mock @dfinity/agent and @dfinity/principal before importing
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn() },
  Actor: { createActor: jest.fn() },
}));

jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: jest.fn((t: string) => ({ toText: () => t })) },
}));

jest.mock("@/lib/ic/declarations/idlFactory", () => ({
  idlFactory: {},
}));

import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

describe("getLatestBriefing", () => {
  const mockAgent = {};
  const mockActor = { getLatestBriefing: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (HttpAgent.create as jest.Mock).mockResolvedValue(mockAgent);
    (Actor.createActor as jest.Mock).mockReturnValue(mockActor);
  });

  it("returns null when no principal is provided", async () => {
    const result = await getLatestBriefing();
    expect(result).toBeNull();
    expect(HttpAgent.create).not.toHaveBeenCalled();
  });

  it("returns null when principal is undefined", async () => {
    const result = await getLatestBriefing(undefined);
    expect(result).toBeNull();
  });

  it("returns null when principal is empty string", async () => {
    // Empty string is falsy, so it should return null early
    const result = await getLatestBriefing("");
    expect(result).toBeNull();
  });

  it("creates HttpAgent with correct host", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([]);
    await getLatestBriefing("aaaaa-aa");
    expect(HttpAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({ host: expect.any(String) }),
    );
  });

  it("creates Actor with canister ID and agent", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([]);
    await getLatestBriefing("aaaaa-aa");
    expect(Actor.createActor).toHaveBeenCalledWith(
      expect.anything(), // idlFactory
      expect.objectContaining({
        agent: mockAgent,
        canisterId: expect.any(String),
      }),
    );
  });

  it("parses Principal from provided text", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([]);
    await getLatestBriefing("rrkah-fqaaa-aaaaa-aaaaq-cai");
    expect(Principal.fromText).toHaveBeenCalledWith("rrkah-fqaaa-aaaaa-aaaaq-cai");
  });

  it("returns null when canister returns empty array", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns parsed JSON when canister returns data", async () => {
    const briefing = {
      version: "1.0",
      generatedAt: "2025-01-01T00:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
      items: [],
      serendipityPick: null,
      meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: [] },
    };
    mockActor.getLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toEqual(briefing);
  });

  it("returns null when canister returns invalid JSON", async () => {
    mockActor.getLatestBriefing.mockResolvedValue(["not-valid-json{{"]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null when canister returns empty string", async () => {
    mockActor.getLatestBriefing.mockResolvedValue([""]);
    const result = await getLatestBriefing("aaaaa-aa");
    // Empty string "" is valid JSON? No, JSON.parse("") throws
    expect(result).toBeNull();
  });

  it("returns null when canister returns truncated JSON", async () => {
    mockActor.getLatestBriefing.mockResolvedValue(['{"version":"1.0","gen']);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("preserves all fields from valid briefing JSON", async () => {
    const briefing = {
      version: "1.0",
      generatedAt: "2025-06-01T12:00:00.000Z",
      source: "aegis",
      sourceUrl: "https://aegis.dwebxr.xyz",
      summary: { totalEvaluated: 50, totalBurned: 10, qualityRate: 0.8 },
      items: [{
        title: "Test",
        content: "Test content",
        source: "rss",
        sourceUrl: "https://example.com",
        scores: { originality: 7, insight: 8, credibility: 6, composite: 7, vSignal: 8.5, cContext: 6.2, lSlop: 1.1 },
        verdict: "quality",
        reason: "Good",
        topics: ["tech"],
        briefingScore: 85,
      }],
      serendipityPick: null,
      meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: "abc123", topics: ["tech"] },
    };
    mockActor.getLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result!.items[0].scores.vSignal).toBe(8.5);
    expect(result!.meta.nostrPubkey).toBe("abc123");
    expect(result!.summary.totalEvaluated).toBe(50);
  });
});
