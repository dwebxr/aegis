import {
  serializeBriefing,
  parseBriefingMarkdown,
} from "@/lib/briefing/serialize";
import type { BriefingState } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner-1",
    author: "Test Author",
    avatar: "\uD83D\uDCDD",
    text: "This is a test content item for briefing serialization.",
    source: "manual",
    sourceUrl: "https://example.com/article",
    scores: { originality: 8, insight: 7, credibility: 9, composite: 8.0 },
    verdict: "quality",
    reason: "Well-researched and original analysis",
    createdAt: 1700000000000,
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    topics: ["ai", "decentralization"],
    ...overrides,
  };
}

function makeBriefing(overrides: Partial<BriefingState> = {}): BriefingState {
  return {
    priority: [
      { item: makeItem(), briefingScore: 9.2, isSerendipity: false, classification: "mixed" as const },
      {
        item: makeItem({
          id: "item-2",
          text: "Second priority item about web3.",
          scores: { originality: 6, insight: 7, credibility: 7, composite: 6.5 },
          verdict: "quality",
          reason: "Good overview of web3 trends",
          topics: ["web3"],
          sourceUrl: "https://example.com/web3",
        }),
        briefingScore: 7.5,
        isSerendipity: false, classification: "mixed" as const,
      },
    ],
    serendipity: {
      item: makeItem({
        id: "item-s",
        text: "Surprise serendipity pick about cooking.",
        scores: { originality: 5, insight: 6, credibility: 8, composite: 6.0 },
        verdict: "quality",
        reason: "Unexpected but delightful find",
        topics: ["cooking"],
        sourceUrl: undefined,
      }),
      briefingScore: 6.0,
      isSerendipity: true, classification: "mixed" as const,
    },
    filteredOut: [],
    totalItems: 15,
    generatedAt: 1700000000000,
    ...overrides,
  };
}

describe("serializeBriefing", () => {
  it("produces valid markdown with title and items", () => {
    const briefing = makeBriefing();
    const result = serializeBriefing(briefing);

    expect(result.content).toContain("# Aegis Briefing");
    expect(result.content).toContain("## Priority Briefing");
    expect(result.content).toContain("### #1:");
    expect(result.content).toContain("### #2:");
    expect(result.content).toContain("## Serendipity Pick");
    expect(result.content).toContain("**Score: 8.0/10**");
    expect(result.content).toContain("Verdict: quality");
    expect(result.content).toContain("[Source](https://example.com/article)");
  });

  it("generates correct NIP-23 tags", () => {
    const briefing = makeBriefing();
    const result = serializeBriefing(briefing);

    const dTag = result.tags.find((t) => t[0] === "d");
    expect(dTag).toBeDefined();
    expect(dTag![1]).toBe(result.identifier);
    expect(result.identifier).toMatch(/^briefing-\d+$/);

    const titleTag = result.tags.find((t) => t[0] === "title");
    expect(titleTag).toBeDefined();
    expect(titleTag![1]).toContain("Aegis Briefing");

    const summaryTag = result.tags.find((t) => t[0] === "summary");
    expect(summaryTag).toBeDefined();

    const publishedTag = result.tags.find((t) => t[0] === "published_at");
    expect(publishedTag).toBeDefined();

    const clientTag = result.tags.find((t) => t[0] === "client");
    expect(clientTag).toEqual(["client", "aegis", "https://aegis.dwebxr.xyz"]);

    // Topic tags
    const tTags = result.tags.filter((t) => t[0] === "t");
    expect(tTags.length).toBeGreaterThanOrEqual(3); // aegis, briefing, ai-curation + content topics
    expect(tTags.map((t) => t[1])).toContain("aegis");
    expect(tTags.map((t) => t[1])).toContain("briefing");
    expect(tTags.map((t) => t[1])).toContain("ai-curation");
  });

  it("generates d-tag with generatedAt timestamp", () => {
    const briefing = makeBriefing({ generatedAt: 1234567890000 });
    const result = serializeBriefing(briefing);

    expect(result.identifier).toBe("briefing-1234567890000");
  });

  it("handles empty briefing (no priority, no serendipity)", () => {
    const briefing = makeBriefing({
      priority: [],
      serendipity: null,
      totalItems: 5,
    });
    const result = serializeBriefing(briefing);

    expect(result.content).toContain("# Aegis Briefing");
    expect(result.content).toContain("0 insights selected from 5 items");
    expect(result.content).not.toContain("## Priority Briefing");
    expect(result.content).not.toContain("## Serendipity Pick");
  });

  it("truncates long text at 280 characters", () => {
    const longText = "A".repeat(300);
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ text: longText }), briefingScore: 8, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);

    // Text should be truncated
    expect(result.content).not.toContain(longText);
    expect(result.content).toContain("...");
  });

  it("collects unique topic tags (max 10)", () => {
    const manyTopics = Array.from({ length: 15 }, (_, i) => `topic${i}`);
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ topics: manyTopics }), briefingScore: 8, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);

    const contentTopicTags = result.tags.filter(
      (tag) => tag[0] === "t" && !["aegis", "briefing", "ai-curation"].includes(tag[1]),
    );
    expect(contentTopicTags.length).toBeLessThanOrEqual(10);
  });
});

describe("parseBriefingMarkdown", () => {
  it("round-trips serialize → parse correctly", () => {
    const briefing = makeBriefing();
    const serialized = serializeBriefing(briefing);
    const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);

    expect(parsed.title).toContain("Aegis Briefing");
    expect(parsed.insightCount).toBe(3); // 2 priority + 1 serendipity
    expect(parsed.totalItems).toBe(15);

    // Priority items
    const priorityItems = parsed.items.filter((i) => !i.isSerendipity);
    expect(priorityItems.length).toBe(2);
    expect(priorityItems[0].rank).toBe(1);
    expect(priorityItems[0].composite).toBe(8.0);
    expect(priorityItems[0].verdict).toBe("quality");
    expect(priorityItems[0].topics).toContain("ai");
    expect(priorityItems[0].sourceUrl).toBe("https://example.com/article");

    // Serendipity item
    const serendipityItems = parsed.items.filter((i) => i.isSerendipity);
    expect(serendipityItems.length).toBe(1);
    expect(serendipityItems[0].composite).toBe(6.0);
  });

  it("extracts title and summary from tags", () => {
    const tags: string[][] = [
      ["title", "My Briefing Title"],
      ["summary", "A brief summary"],
      ["published_at", "1700000000"],
    ];
    const parsed = parseBriefingMarkdown("# My Briefing Title\n\n", tags);

    expect(parsed.title).toBe("My Briefing Title");
    expect(parsed.summary).toBe("A brief summary");
    expect(parsed.generatedAt).toBe(1700000000000);
  });

  it("parses score values correctly", () => {
    const content = [
      "# Test",
      "",
      "*3 insights selected from 10 items. 7 burned as slop.*",
      "",
      "## Priority Briefing",
      "",
      "### #1: High Score Item",
      "**Score: 9.5/10** | Verdict: quality",
      "> Excellent analysis",
      "",
    ].join("\n");

    const parsed = parseBriefingMarkdown(content, [["title", "Test"]]);
    expect(parsed.items[0].composite).toBe(9.5);
    expect(parsed.items[0].verdict).toBe("quality");
    expect(parsed.items[0].reason).toBe("Excellent analysis");
    expect(parsed.totalItems).toBe(10);
  });

  it("handles content with no items gracefully", () => {
    const parsed = parseBriefingMarkdown("# Empty Briefing\n\n", [["title", "Empty"]]);
    expect(parsed.items).toEqual([]);
    expect(parsed.insightCount).toBe(0);
  });

  it("parses topics from hashtag format", () => {
    const content = [
      "## Priority Briefing",
      "",
      "### #1: Topic Test",
      "**Score: 7.0/10** | Verdict: quality",
      "Topics: #ai #crypto #web3",
      "",
    ].join("\n");

    const parsed = parseBriefingMarkdown(content, []);
    expect(parsed.items[0].topics).toEqual(["ai", "crypto", "web3"]);
  });
});
