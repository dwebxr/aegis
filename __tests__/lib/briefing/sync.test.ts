import { briefingToD2AResponse, syncBriefingToCanister } from "@/lib/briefing/sync";
import type { BriefingState } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

function makeContentItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1",
    owner: "owner-1",
    author: "Author",
    avatar: "",
    text: "Test content for evaluation",
    source: "rss",
    sourceUrl: "https://example.com/article",
    timestamp: "2025-01-01T00:00:00Z",
    scores: { originality: 7, insight: 8, credibility: 6, composite: 7.5 },
    verdict: "quality",
    reason: "Good analysis",
    createdAt: 1704067200000,
    validated: true,
    flagged: false,
    topics: ["tech", "ai"],
    vSignal: 8.0,
    cContext: 6.5,
    lSlop: 1.2,
    ...overrides,
  };
}

function makeBriefingState(overrides: Partial<BriefingState> = {}): BriefingState {
  return {
    priority: [
      { item: makeContentItem(), briefingScore: 85, isSerendipity: false },
      { item: makeContentItem({ id: "test-2", text: "Second item", topics: ["crypto"] }), briefingScore: 72, isSerendipity: false },
    ],
    serendipity: null,
    filteredOut: [],
    totalItems: 10,
    generatedAt: 1704067200000,
    ...overrides,
  };
}

describe("briefingToD2AResponse", () => {
  it("returns correct version and source fields", () => {
    const result = briefingToD2AResponse(makeBriefingState());
    expect(result.version).toBe("1.0");
    expect(result.source).toBe("aegis");
    expect(result.sourceUrl).toBe("https://aegis.dwebxr.xyz");
  });

  it("converts generatedAt timestamp to ISO string", () => {
    const result = briefingToD2AResponse(makeBriefingState({ generatedAt: 1704067200000 }));
    expect(result.generatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("maps priority items to D2ABriefingItem format", () => {
    const result = briefingToD2AResponse(makeBriefingState());
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("Test content for evaluation");
    expect(result.items[0].source).toBe("rss");
    expect(result.items[0].briefingScore).toBe(85);
  });

  it("truncates title to 80 characters", () => {
    const longText = "A".repeat(200);
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text: longText }), briefingScore: 90, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].title).toHaveLength(80);
    expect(result.items[0].content).toBe(longText);
  });

  it("preserves full content in content field", () => {
    const fullText = "Full article content here with lots of details";
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text: fullText }), briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].content).toBe(fullText);
  });

  it("maps all score fields including V/C/L", () => {
    const result = briefingToD2AResponse(makeBriefingState());
    const scores = result.items[0].scores;
    expect(scores.originality).toBe(7);
    expect(scores.insight).toBe(8);
    expect(scores.credibility).toBe(6);
    expect(scores.composite).toBe(7.5);
    expect(scores.vSignal).toBe(8.0);
    expect(scores.cContext).toBe(6.5);
    expect(scores.lSlop).toBe(1.2);
  });

  it("handles missing V/C/L scores (undefined)", () => {
    const item = makeContentItem({ vSignal: undefined, cContext: undefined, lSlop: undefined });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].scores.vSignal).toBeUndefined();
    expect(result.items[0].scores.cContext).toBeUndefined();
    expect(result.items[0].scores.lSlop).toBeUndefined();
  });

  it("handles missing sourceUrl with empty string fallback", () => {
    const item = makeContentItem({ sourceUrl: undefined });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].sourceUrl).toBe("");
  });

  it("handles missing topics with empty array fallback", () => {
    const item = makeContentItem({ topics: undefined });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].topics).toEqual([]);
  });

  it("returns serendipityPick when present", () => {
    const serendipityItem = makeContentItem({ id: "ser-1", text: "Serendipity find!" });
    const state = makeBriefingState({
      serendipity: { item: serendipityItem, briefingScore: 60, isSerendipity: true },
    });
    const result = briefingToD2AResponse(state);
    expect(result.serendipityPick).not.toBeNull();
    expect(result.serendipityPick!.content).toBe("Serendipity find!");
    expect(result.serendipityPick!.briefingScore).toBe(60);
  });

  it("returns null serendipityPick when absent", () => {
    const result = briefingToD2AResponse(makeBriefingState({ serendipity: null }));
    expect(result.serendipityPick).toBeNull();
  });

  it("calculates totalBurned from filteredOut slop items", () => {
    const slopItem = makeContentItem({ id: "slop-1", verdict: "slop" });
    const qualityItem = makeContentItem({ id: "q-1", verdict: "quality" });
    const state = makeBriefingState({
      filteredOut: [slopItem, slopItem, qualityItem],
      totalItems: 15,
    });
    const result = briefingToD2AResponse(state);
    expect(result.summary.totalBurned).toBe(2);
  });

  it("calculates qualityRate correctly", () => {
    const slopItem = makeContentItem({ verdict: "slop" });
    const state = makeBriefingState({
      filteredOut: [slopItem, slopItem],
      totalItems: 10,
    });
    const result = briefingToD2AResponse(state);
    // (10 - 2) / 10 = 0.8
    expect(result.summary.qualityRate).toBe(0.8);
  });

  it("returns qualityRate 0 when totalItems is 0", () => {
    const state = makeBriefingState({ totalItems: 0, priority: [], filteredOut: [] });
    const result = briefingToD2AResponse(state);
    expect(result.summary.qualityRate).toBe(0);
  });

  it("returns qualityRate 1.0 when no slop items", () => {
    const state = makeBriefingState({ filteredOut: [], totalItems: 5 });
    const result = briefingToD2AResponse(state);
    expect(result.summary.qualityRate).toBe(1.0);
  });

  it("deduplicates topics across items", () => {
    const item1 = makeContentItem({ topics: ["tech", "ai"] });
    const item2 = makeContentItem({ id: "t2", topics: ["ai", "crypto"] });
    const state = makeBriefingState({
      priority: [
        { item: item1, briefingScore: 80, isSerendipity: false },
        { item: item2, briefingScore: 70, isSerendipity: false },
      ],
    });
    const result = briefingToD2AResponse(state);
    const topics = result.meta.topics;
    expect(topics).toContain("tech");
    expect(topics).toContain("ai");
    expect(topics).toContain("crypto");
    expect(topics.filter(t => t === "ai")).toHaveLength(1); // no duplicates
  });

  it("handles items with no topics (undefined)", () => {
    const item = makeContentItem({ topics: undefined });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.meta.topics).toEqual([]);
  });

  it("sets default nostrPubkey to null", () => {
    const result = briefingToD2AResponse(makeBriefingState());
    expect(result.meta.nostrPubkey).toBeNull();
  });

  it("passes custom nostrPubkey", () => {
    const result = briefingToD2AResponse(makeBriefingState(), "npub1abc123");
    expect(result.meta.nostrPubkey).toBe("npub1abc123");
  });

  it("uses aegis-vcl-v1 scoring model", () => {
    const result = briefingToD2AResponse(makeBriefingState());
    expect(result.meta.scoringModel).toBe("aegis-vcl-v1");
  });

  it("handles empty priority array", () => {
    const state = makeBriefingState({ priority: [], totalItems: 0 });
    const result = briefingToD2AResponse(state);
    expect(result.items).toEqual([]);
    expect(result.meta.topics).toEqual([]);
  });

  it("handles large number of items", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      item: makeContentItem({ id: `item-${i}`, topics: [`topic-${i % 10}`] }),
      briefingScore: 50 + (i % 50),
      isSerendipity: false,
    }));
    const state = makeBriefingState({ priority: items, totalItems: 200 });
    const result = briefingToD2AResponse(state);
    expect(result.items).toHaveLength(100);
    expect(result.meta.topics).toHaveLength(10); // 10 unique topics
  });

  it("maps verdict field correctly", () => {
    const qualityItem = makeContentItem({ verdict: "quality" });
    const slopItem = makeContentItem({ id: "s1", verdict: "slop" });
    const state = makeBriefingState({
      priority: [
        { item: qualityItem, briefingScore: 90, isSerendipity: false },
        { item: slopItem, briefingScore: 20, isSerendipity: false },
      ],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].verdict).toBe("quality");
    expect(result.items[1].verdict).toBe("slop");
  });

  it("includes reason field from content item", () => {
    const item = makeContentItem({ reason: "Excellent depth of analysis" });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 95, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].reason).toBe("Excellent depth of analysis");
  });

  it("output is JSON-serializable", () => {
    const state = makeBriefingState();
    const result = briefingToD2AResponse(state, "npub1test");
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized);
    expect(parsed.version).toBe("1.0");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.meta.nostrPubkey).toBe("npub1test");
  });
});

describe("syncBriefingToCanister", () => {
  it("calls actor.saveLatestBriefing with JSON string", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(true) };
    const state = makeBriefingState();
    const result = await syncBriefingToCanister(mockActor as any, state);
    expect(result).toBe(true);
    expect(mockActor.saveLatestBriefing).toHaveBeenCalledTimes(1);
    const jsonArg = mockActor.saveLatestBriefing.mock.calls[0][0];
    expect(typeof jsonArg).toBe("string");
    const parsed = JSON.parse(jsonArg);
    expect(parsed.version).toBe("1.0");
    expect(parsed.items).toHaveLength(2);
  });

  it("returns false when actor throws", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockRejectedValue(new Error("Network error")) };
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const result = await syncBriefingToCanister(mockActor as any, makeBriefingState());
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[briefing/sync] Failed to sync:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("returns false when saveLatestBriefing returns false", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(false) };
    const result = await syncBriefingToCanister(mockActor as any, makeBriefingState());
    expect(result).toBe(false);
  });

  it("passes nostrPubkey through to the briefing response", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(true) };
    await syncBriefingToCanister(mockActor as any, makeBriefingState(), "npub1xyz");
    const parsed = JSON.parse(mockActor.saveLatestBriefing.mock.calls[0][0]);
    expect(parsed.meta.nostrPubkey).toBe("npub1xyz");
  });

  it("defaults nostrPubkey to null", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(true) };
    await syncBriefingToCanister(mockActor as any, makeBriefingState());
    const parsed = JSON.parse(mockActor.saveLatestBriefing.mock.calls[0][0]);
    expect(parsed.meta.nostrPubkey).toBeNull();
  });

  it("handles empty state gracefully", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(true) };
    const emptyState = makeBriefingState({ priority: [], filteredOut: [], totalItems: 0 });
    const result = await syncBriefingToCanister(mockActor as any, emptyState);
    expect(result).toBe(true);
    const parsed = JSON.parse(mockActor.saveLatestBriefing.mock.calls[0][0]);
    expect(parsed.items).toEqual([]);
  });
});
