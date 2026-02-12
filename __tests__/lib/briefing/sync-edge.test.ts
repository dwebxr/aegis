import { briefingToD2AResponse, syncBriefingToCanister } from "@/lib/briefing/sync";
import type { BriefingState } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

function makeContentItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "edge-1",
    owner: "owner",
    author: "Author",
    avatar: "",
    text: "Content text",
    source: "rss",
    timestamp: "1h ago",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "OK",
    createdAt: 1704067200000,
    validated: true,
    flagged: false,
    ...overrides,
  };
}

function makeBriefingState(overrides: Partial<BriefingState> = {}): BriefingState {
  return {
    priority: [],
    serendipity: null,
    filteredOut: [],
    totalItems: 0,
    generatedAt: 1704067200000,
    ...overrides,
  };
}

describe("briefingToD2AResponse — edge cases", () => {
  it("handles text that is exactly 80 characters (no truncation needed)", () => {
    const text = "A".repeat(80);
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text }), briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].title).toBe(text);
    expect(result.items[0].title).toHaveLength(80);
  });

  it("truncates text at 81 characters", () => {
    const text = "A".repeat(81);
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text }), briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].title).toHaveLength(80);
    expect(result.items[0].content).toHaveLength(81);
  });

  it("handles single-character text", () => {
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text: "X" }), briefingScore: 50, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].title).toBe("X");
    expect(result.items[0].content).toBe("X");
  });

  it("handles empty string text", () => {
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text: "" }), briefingScore: 0, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].title).toBe("");
    expect(result.items[0].content).toBe("");
  });

  it("handles unicode text in title truncation", () => {
    // Emoji is multi-byte but single character
    const text = "🎯".repeat(50); // 50 emoji characters
    const state = makeBriefingState({
      priority: [{ item: makeContentItem({ text }), briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    // slice(0, 80) on emoji string will give 80 emoji chars (each is 1 JS "character" but 2 UTF-16 units)
    expect(result.items[0].title.length).toBeLessThanOrEqual(80);
  });

  it("handles very large filteredOut array for totalBurned", () => {
    const slopItems = Array.from({ length: 1000 }, (_, i) =>
      makeContentItem({ id: `slop-${i}`, verdict: "slop" }),
    );
    const qualityItems = Array.from({ length: 500 }, (_, i) =>
      makeContentItem({ id: `q-${i}`, verdict: "quality" }),
    );
    const state = makeBriefingState({
      filteredOut: [...slopItems, ...qualityItems],
      totalItems: 2000,
    });
    const result = briefingToD2AResponse(state);
    expect(result.summary.totalBurned).toBe(1000);
    expect(result.summary.qualityRate).toBe(0.5);
  });

  it("qualityRate precision with odd numbers", () => {
    const slopItem = makeContentItem({ verdict: "slop" });
    const state = makeBriefingState({
      filteredOut: [slopItem],
      totalItems: 3,
    });
    const result = briefingToD2AResponse(state);
    // (3 - 1) / 3 = 0.666...
    expect(result.summary.qualityRate).toBeCloseTo(0.6667, 3);
  });

  it("handles generatedAt of 0 (epoch)", () => {
    const state = makeBriefingState({ generatedAt: 0 });
    const result = briefingToD2AResponse(state);
    expect(result.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("handles negative generatedAt gracefully", () => {
    const state = makeBriefingState({ generatedAt: -1000 });
    const result = briefingToD2AResponse(state);
    // Should still produce a valid ISO string (1969)
    expect(Date.parse(result.generatedAt)).not.toBeNaN();
  });

  it("topics with special characters", () => {
    const item = makeContentItem({ topics: ["c++", "c#", "node.js", "AI/ML"] });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 80, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.meta.topics).toContain("c++");
    expect(result.meta.topics).toContain("AI/ML");
  });

  it("handles sourceUrl as empty string", () => {
    const item = makeContentItem({ sourceUrl: "" });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 70, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].sourceUrl).toBe("");
  });

  it("all content sources are preserved", () => {
    const sources = ["manual", "rss", "url", "twitter", "nostr"] as const;
    const items = sources.map((s, i) => ({
      item: makeContentItem({ id: `s-${i}`, source: s }),
      briefingScore: 50 + i,
      isSerendipity: false,
    }));
    const state = makeBriefingState({ priority: items, totalItems: 5 });
    const result = briefingToD2AResponse(state);
    const resultSources = result.items.map(i => i.source);
    expect(resultSources).toEqual(["manual", "rss", "url", "twitter", "nostr"]);
  });

  it("V/C/L scores of 0 are preserved (not treated as undefined)", () => {
    const item = makeContentItem({ vSignal: 0, cContext: 0, lSlop: 0 });
    const state = makeBriefingState({
      priority: [{ item, briefingScore: 30, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].scores.vSignal).toBe(0);
    expect(result.items[0].scores.cContext).toBe(0);
    expect(result.items[0].scores.lSlop).toBe(0);
  });

  it("briefingScore of 0 is preserved", () => {
    const state = makeBriefingState({
      priority: [{ item: makeContentItem(), briefingScore: 0, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].briefingScore).toBe(0);
  });

  it("briefingScore of 100 is preserved", () => {
    const state = makeBriefingState({
      priority: [{ item: makeContentItem(), briefingScore: 100, isSerendipity: false }],
    });
    const result = briefingToD2AResponse(state);
    expect(result.items[0].briefingScore).toBe(100);
  });
});

describe("syncBriefingToCanister — edge cases", () => {
  it("handles actor returning rejected promise (not Error)", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockRejectedValue("string error") };
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const result = await syncBriefingToCanister(mockActor as any, makeBriefingState());
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  it("handles actor returning undefined", async () => {
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(undefined) };
    const result = await syncBriefingToCanister(mockActor as any, makeBriefingState());
    // undefined is falsy, same as false
    expect(result).toBeFalsy();
  });

  it("serializes large briefing state without error", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      item: makeContentItem({
        id: `item-${i}`,
        text: "Content ".repeat(100),
        topics: Array.from({ length: 10 }, (_, j) => `topic-${j}`),
      }),
      briefingScore: 50 + (i % 50),
      isSerendipity: false,
    }));
    const state = makeBriefingState({ priority: items, totalItems: 200 });
    const mockActor = { saveLatestBriefing: jest.fn().mockResolvedValue(true) };
    const result = await syncBriefingToCanister(mockActor as any, state);
    expect(result).toBe(true);
    const json = mockActor.saveLatestBriefing.mock.calls[0][0];
    expect(JSON.parse(json).items).toHaveLength(50);
  });

  it("handles concurrent sync calls independently", async () => {
    const mockActor = {
      saveLatestBriefing: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const state1 = makeBriefingState({ generatedAt: 1000 });
    const state2 = makeBriefingState({ generatedAt: 2000 });

    const [r1, r2] = await Promise.all([
      syncBriefingToCanister(mockActor as any, state1),
      syncBriefingToCanister(mockActor as any, state2),
    ]);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(mockActor.saveLatestBriefing).toHaveBeenCalledTimes(2);
  });
});
