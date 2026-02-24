/**
 * Briefing serialize → parse roundtrip tests.
 * Verifies that serializeBriefing output can be losslessly parsed back
 * by parseBriefingMarkdown, and edge cases in both directions.
 */
import { serializeBriefing, parseBriefingMarkdown } from "@/lib/briefing/serialize";
import type { BriefingState, BriefingItem } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

function makeContentItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Author",
    avatar: "📡",
    text: "Test article about AI research and methodology with benchmark results.",
    source: "rss",
    scores: { originality: 8, insight: 7, credibility: 9, composite: 8.1 },
    verdict: "quality",
    reason: "High-quality research with strong evidence",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    topics: ["ai", "research"],
    sourceUrl: "https://example.com/article",
    ...overrides,
  };
}

function makeBriefingItem(overrides: Partial<ContentItem> = {}, isSerendipity = false): BriefingItem {
  return { item: makeContentItem(overrides), briefingScore: 8.5, isSerendipity, classification: "mixed" };
}

function makeBriefingState(overrides: Partial<BriefingState> = {}): BriefingState {
  return {
    generatedAt: 1700000000000,
    priority: [
      makeBriefingItem({ id: "p1", text: "Priority article one about quantum computing advances" }),
      makeBriefingItem({ id: "p2", text: "Priority article two about neural network optimization", scores: { originality: 7, insight: 8, credibility: 7, composite: 7.3 }, topics: ["ml"] }),
    ],
    serendipity: makeBriefingItem({ id: "s1", text: "Serendipity pick about ancient history discovery", topics: ["history"], scores: { originality: 9, insight: 6, credibility: 7, composite: 7.5 } }, true),
    filteredOut: [],
    totalItems: 50,
    ...overrides,
  };
}

describe("serializeBriefing — output structure", () => {
  it("produces markdown with title, stats, priority section, and serendipity section", () => {
    const result = serializeBriefing(makeBriefingState());
    expect(result.content).toContain("# Aegis Briefing");
    expect(result.content).toContain("## Priority Briefing");
    expect(result.content).toContain("## Serendipity Pick");
    expect(result.content).toContain("insights selected from 50 items");
  });

  it("identifier uses generatedAt timestamp", () => {
    const result = serializeBriefing(makeBriefingState());
    expect(result.identifier).toBe("briefing-1700000000000");
  });

  it("tags include required metadata", () => {
    const result = serializeBriefing(makeBriefingState());
    const tagNames = result.tags.map(t => t[0]);
    expect(tagNames).toContain("d");
    expect(tagNames).toContain("title");
    expect(tagNames).toContain("summary");
    expect(tagNames).toContain("published_at");
    expect(tagNames).toContain("t");
    expect(tagNames).toContain("client");
  });

  it("tags include topic tags from items", () => {
    const result = serializeBriefing(makeBriefingState());
    const topicTags = result.tags.filter(t => t[0] === "t").map(t => t[1]);
    expect(topicTags).toContain("ai");
    expect(topicTags).toContain("research");
    expect(topicTags).toContain("ml");
    expect(topicTags).toContain("history");
  });

  it("limits topic tags to 10", () => {
    const manyTopics: string[] = [];
    for (let i = 0; i < 15; i++) manyTopics.push(`topic${i}`);
    const state = makeBriefingState();
    state.priority[0].item.topics = manyTopics;
    const result = serializeBriefing(state);
    // Fixed tags (aegis, briefing, ai-curation) + custom topics ≤ 10
    const customTopicTags = result.tags.filter(t => t[0] === "t" && !["aegis", "briefing", "ai-curation"].includes(t[1]));
    expect(customTopicTags.length).toBeLessThanOrEqual(10);
  });
});

describe("serializeBriefing — edge cases", () => {
  it("no priority items", () => {
    const state = makeBriefingState({ priority: [] });
    const result = serializeBriefing(state);
    expect(result.content).not.toContain("## Priority Briefing");
    expect(result.content).toContain("## Serendipity Pick");
  });

  it("no serendipity", () => {
    const state = makeBriefingState({ serendipity: null });
    const result = serializeBriefing(state);
    expect(result.content).toContain("## Priority Briefing");
    expect(result.content).not.toContain("## Serendipity Pick");
  });

  it("both empty — minimal briefing", () => {
    const state = makeBriefingState({ priority: [], serendipity: null });
    const result = serializeBriefing(state);
    expect(result.content).toContain("# Aegis Briefing");
    // Summary should use fallback format
    const summaryTag = result.tags.find(t => t[0] === "summary");
    expect(summaryTag).toBeDefined();
  });

  it("item with no reason omits blockquote for that item", () => {
    const state = makeBriefingState();
    state.priority[0].item.reason = "";
    const result = serializeBriefing(state);
    // p1 has no reason → no blockquote between its score line and text
    const lines = result.content.split("\n");
    const p1ScoreIdx = lines.findIndex(l => l.includes("#1:"));
    // The line after the score line should NOT be a blockquote
    const afterScore = lines[p1ScoreIdx + 2]; // skip score line
    expect(afterScore).not.toMatch(/^> /);
  });

  it("item with no sourceUrl", () => {
    const state = makeBriefingState();
    state.priority[0].item.sourceUrl = undefined;
    const result = serializeBriefing(state);
    expect(result.content).not.toContain("[Source](undefined)");
  });

  it("item with very long text gets truncated", () => {
    const state = makeBriefingState();
    state.priority[0].item.text = "X".repeat(500);
    const result = serializeBriefing(state);
    // truncate(text, 280) should apply
    const textLine = result.content.split("\n").find(l => l.startsWith("X"));
    expect(textLine!.length).toBeLessThanOrEqual(280);
  });
});

describe("parseBriefingMarkdown — roundtrip", () => {
  it("parses back the same number of items", () => {
    const state = makeBriefingState();
    const serialized = serializeBriefing(state);
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);

    // 2 priority + 1 serendipity = 3
    expect(parsed.items).toHaveLength(3);
    expect(parsed.totalItems).toBe(50);
  });

  it("preserves title from tags", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.title).toContain("Aegis Briefing");
  });

  it("preserves item ranking", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.items[0].rank).toBe(1);
    expect(parsed.items[1].rank).toBe(2);
    expect(parsed.items[2].rank).toBeNull(); // serendipity has no rank
  });

  it("identifies serendipity items", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    const serendipityItems = parsed.items.filter(i => i.isSerendipity);
    expect(serendipityItems).toHaveLength(1);
  });

  it("preserves composite scores", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.items[0].composite).toBe(8.1);
    expect(parsed.items[1].composite).toBe(7.3);
  });

  it("preserves verdict", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.items[0].verdict).toBe("quality");
  });

  it("preserves topics", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.items[0].topics).toContain("ai");
    expect(parsed.items[0].topics).toContain("research");
  });

  it("preserves sourceUrl", () => {
    const serialized = serializeBriefing(makeBriefingState());
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);
    expect(parsed.items[0].sourceUrl).toBe("https://example.com/article");
  });
});

describe("parseBriefingMarkdown — malformed input", () => {
  it("handles empty content", () => {
    const parsed = parseBriefingMarkdown("", []);
    expect(parsed.items).toHaveLength(0);
    expect(parsed.title).toBe("Aegis Briefing");
  });

  it("handles content with no items", () => {
    const parsed = parseBriefingMarkdown("# Some Title\n\nJust text.", [["title", "Test"]]);
    expect(parsed.items).toHaveLength(0);
    expect(parsed.title).toBe("Test");
  });

  it("handles missing tags", () => {
    const parsed = parseBriefingMarkdown("### #1: Test Article\n**Score: 8.0/10** | Verdict: quality", []);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].composite).toBe(8.0);
  });

  it("handles item with no score line", () => {
    const parsed = parseBriefingMarkdown("## Priority Briefing\n\n### #1: Article Title\nSome content here.", []);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].composite).toBe(0);
  });
});
