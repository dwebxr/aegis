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
    text: "Test content for briefing.",
    source: "manual",
    sourceUrl: "https://example.com/article",
    scores: { originality: 7, insight: 8, credibility: 9, composite: 8.0 },
    verdict: "quality",
    reason: "Good analysis",
    createdAt: 1700000000000,
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    topics: ["ai", "ml"],
    ...overrides,
  };
}

function makeBriefing(overrides: Partial<BriefingState> = {}): BriefingState {
  return {
    priority: [
      { item: makeItem(), briefingScore: 9.2, isSerendipity: false, classification: "mixed" as const },
    ],
    serendipity: null,
    filteredOut: [],
    totalItems: 10,
    generatedAt: 1700000000000,
    ...overrides,
  };
}

describe("parseBriefingMarkdown — edge cases", () => {
  describe("missing and malformed tags", () => {
    it("uses default title when title tag missing", () => {
      const parsed = parseBriefingMarkdown("# Some Content\n", []);
      expect(parsed.title).toBe("Aegis Briefing");
    });

    it("uses empty summary when summary tag missing", () => {
      const parsed = parseBriefingMarkdown("# Content\n", [["title", "T"]]);
      expect(parsed.summary).toBe("");
    });

    it("uses Date.now() when published_at tag missing", () => {
      const before = Date.now();
      const parsed = parseBriefingMarkdown("# Content\n", []);
      expect(parsed.generatedAt).toBeGreaterThanOrEqual(before);
    });

    it("converts published_at from seconds to milliseconds", () => {
      const parsed = parseBriefingMarkdown("", [["published_at", "1700000000"]]);
      expect(parsed.generatedAt).toBe(1700000000000);
    });
  });

  describe("malformed markdown", () => {
    it("handles empty content string", () => {
      const parsed = parseBriefingMarkdown("", []);
      expect(parsed.items).toEqual([]);
      expect(parsed.insightCount).toBe(0);
    });

    it("handles content with only headers (no items)", () => {
      const content = "# Title\n\n## Priority Briefing\n\n---\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items).toEqual([]);
    });

    it("handles item with no score line", () => {
      const content = [
        "## Priority Briefing",
        "",
        "### #1: Title Without Score",
        "Some body text here",
        "",
      ].join("\n");
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].title).toBe("Title Without Score");
      expect(parsed.items[0].composite).toBe(0); // default
    });

    it("handles item with no reason (blockquote)", () => {
      const content = [
        "## Priority Briefing",
        "",
        "### #1: No Reason Item",
        "**Score: 7.5/10** | Verdict: quality",
        "",
      ].join("\n");
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].reason).toBe("");
    });

    it("handles item with no topics", () => {
      const content = [
        "## Priority Briefing",
        "",
        "### #1: No Topics",
        "**Score: 6.0/10** | Verdict: quality",
        "",
      ].join("\n");
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].topics).toEqual([]);
    });

    it("handles item with no source URL", () => {
      const content = [
        "## Priority Briefing",
        "",
        "### #1: No Source",
        "**Score: 5.0/10** | Verdict: slop",
        "",
      ].join("\n");
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].sourceUrl).toBeUndefined();
    });
  });

  describe("score parsing", () => {
    it("parses integer scores", () => {
      const content = "## Priority Briefing\n\n### #1: Item\n**Score: 8/10** | Verdict: quality\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].composite).toBe(8);
    });

    it("parses decimal scores", () => {
      const content = "## Priority Briefing\n\n### #1: Item\n**Score: 7.3/10** | Verdict: quality\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].composite).toBe(7.3);
    });

    it("parses serendipity score line (Novelty bonus)", () => {
      const content = "## Serendipity Pick\n\n### Surprise Item\n**Score: 5.5/10** | Novelty bonus applied\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].composite).toBe(5.5);
      expect(parsed.items[0].isSerendipity).toBe(true);
    });

    it("parses slop verdict", () => {
      const content = "## Priority Briefing\n\n### #1: Bad Item\n**Score: 2.0/10** | Verdict: slop\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].verdict).toBe("slop");
    });
  });

  describe("totalItems extraction", () => {
    it("extracts totalItems from stats line", () => {
      const content = "*5 insights selected from 42 items. 37 burned as slop.*\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.totalItems).toBe(42);
    });

    it("handles singular 'insight' text", () => {
      const content = "*1 insight selected from 3 items. 2 burned as slop.*\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.totalItems).toBe(3);
    });

    it("falls back to items.length when stats line missing", () => {
      const content = "## Priority Briefing\n\n### #1: Item\n**Score: 7.0/10** | Verdict: quality\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.totalItems).toBe(1); // falls back to items.length
    });
  });

  describe("serendipity detection", () => {
    it("marks items after '## Serendipity Pick' as serendipity", () => {
      const content = [
        "## Priority Briefing",
        "",
        "### #1: Normal Item",
        "**Score: 8.0/10** | Verdict: quality",
        "",
        "## Serendipity Pick",
        "",
        "### Surprise",
        "**Score: 6.0/10** | Novelty bonus applied",
        "",
      ].join("\n");
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].isSerendipity).toBe(false);
      expect(parsed.items[0].rank).toBe(1);
      expect(parsed.items[1].isSerendipity).toBe(true);
      expect(parsed.items[1].rank).toBeNull();
    });
  });

  describe("multiple items parsing", () => {
    it("parses 5 priority items correctly", () => {
      const lines = ["## Priority Briefing", ""];
      for (let i = 1; i <= 5; i++) {
        lines.push(`### #${i}: Item ${i}`);
        lines.push(`**Score: ${(10 - i).toFixed(1)}/10** | Verdict: quality`);
        lines.push(`> Reason for item ${i}`);
        lines.push(`Topics: #topic${i}`);
        lines.push("");
      }
      const parsed = parseBriefingMarkdown(lines.join("\n"), []);
      expect(parsed.items).toHaveLength(5);
      expect(parsed.items[0].rank).toBe(1);
      expect(parsed.items[4].rank).toBe(5);
      expect(parsed.items[0].composite).toBe(9);
      expect(parsed.items[4].composite).toBe(5);
    });
  });

  describe("topic parsing", () => {
    it("parses multiple hashtag topics", () => {
      const content = "## Priority Briefing\n\n### #1: T\n**Score: 7.0/10** | Verdict: quality\nTopics: #ai #ml #crypto #web3\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].topics).toEqual(["ai", "ml", "crypto", "web3"]);
    });

    it("handles single topic", () => {
      const content = "## Priority Briefing\n\n### #1: T\n**Score: 7.0/10** | Verdict: quality\nTopics: #security\n";
      const parsed = parseBriefingMarkdown(content, []);
      expect(parsed.items[0].topics).toEqual(["security"]);
    });
  });
});

describe("serializeBriefing — edge cases", () => {
  it("handles item with empty text", () => {
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ text: "" }), briefingScore: 7, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);
    expect(result.content).toContain("### #1:");
  });

  it("handles item with no topics", () => {
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ topics: undefined }), briefingScore: 7, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);
    expect(result.content).not.toContain("Topics:");
  });

  it("handles item with no source URL", () => {
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ sourceUrl: undefined }), briefingScore: 7, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);
    expect(result.content).not.toContain("[Source]");
  });

  it("handles item with no reason", () => {
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ reason: "" }), briefingScore: 7, isSerendipity: false, classification: "mixed" as const },
      ],
    });
    const result = serializeBriefing(briefing);
    // Should not have a blockquote line
    expect(result.content).not.toContain("> ");
  });

  it("deduplicates topic tags across priority and serendipity", () => {
    const briefing = makeBriefing({
      priority: [
        { item: makeItem({ topics: ["ai", "ml"] }), briefingScore: 9, isSerendipity: false, classification: "mixed" as const },
      ],
      serendipity: {
        item: makeItem({ id: "s", topics: ["ai", "cooking"] }),
        briefingScore: 6,
        isSerendipity: true, classification: "mixed" as const,
      },
    });
    const result = serializeBriefing(briefing);
    const topicTags = result.tags.filter(t => t[0] === "t" && !["aegis", "briefing", "ai-curation"].includes(t[1]));
    const topicValues = topicTags.map(t => t[1]);
    // "ai" should appear only once
    expect(topicValues.filter(t => t === "ai")).toHaveLength(1);
    expect(topicValues).toContain("ml");
    expect(topicValues).toContain("cooking");
  });

  it("summary includes top item details when priority exists", () => {
    const briefing = makeBriefing();
    const result = serializeBriefing(briefing);
    const summaryTag = result.tags.find(t => t[0] === "summary");
    expect(summaryTag).toBeDefined();
    expect(summaryTag![1]).toContain("8.0/10");
  });

  it("summary falls back to item count when no priority", () => {
    const briefing = makeBriefing({ priority: [], totalItems: 20 });
    const result = serializeBriefing(briefing);
    const summaryTag = result.tags.find(t => t[0] === "summary");
    expect(summaryTag![1]).toContain("20 items");
  });

  describe("round-trip integrity", () => {
    it("round-trips briefing with all fields populated", () => {
      const briefing = makeBriefing({
        priority: [
          {
            item: makeItem({
              text: "Deep analysis of transformer architectures",
              scores: { originality: 9, insight: 8, credibility: 9, composite: 8.7 },
              reason: "Original research with strong methodology",
              topics: ["transformers", "ai", "research"],
              sourceUrl: "https://arxiv.org/paper123",
            }),
            briefingScore: 9.5,
            isSerendipity: false, classification: "mixed" as const,
          },
          {
            item: makeItem({
              id: "item-2",
              text: "Web3 governance models compared",
              scores: { originality: 7, insight: 7, credibility: 6, composite: 6.8 },
              reason: "Good comparative analysis",
              topics: ["web3", "governance"],
              sourceUrl: "https://example.com/web3",
            }),
            briefingScore: 7.2,
            isSerendipity: false, classification: "mixed" as const,
          },
        ],
        serendipity: {
          item: makeItem({
            id: "item-s",
            text: "Unexpected finding in marine biology",
            scores: { originality: 6, insight: 5, credibility: 7, composite: 5.9 },
            reason: "Outside your usual interests",
            topics: ["biology"],
            sourceUrl: undefined,
          }),
          briefingScore: 5.9,
          isSerendipity: true, classification: "mixed" as const,
        },
        totalItems: 25,
      });

      const serialized = serializeBriefing(briefing);
      const parsed = parseBriefingMarkdown(serialized.content, serialized.tags);

      expect(parsed.insightCount).toBe(3);
      expect(parsed.totalItems).toBe(25);

      // Priority items
      const priority = parsed.items.filter(i => !i.isSerendipity);
      expect(priority).toHaveLength(2);
      expect(priority[0].rank).toBe(1);
      expect(priority[0].composite).toBe(8.7);
      expect(priority[0].topics).toContain("transformers");
      expect(priority[0].sourceUrl).toBe("https://arxiv.org/paper123");
      expect(priority[1].rank).toBe(2);

      // Serendipity
      const ser = parsed.items.filter(i => i.isSerendipity);
      expect(ser).toHaveLength(1);
      expect(ser[0].composite).toBe(5.9);
      expect(ser[0].topics).toContain("biology");
    });
  });
});
