import { generateBriefing } from "@/lib/briefing/ranker";
import type { ContentItem } from "@/lib/types/content";
import { createEmptyProfile } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: Math.random().toString(36).slice(2),
    owner: "test",
    author: "Author",
    avatar: "🧪",
    text: "Test article content",
    source: "rss",
    verdict: "quality",
    reason: "Good content",
    topics: ["tech"],
    createdAt: Date.now() - 3600000,
    scores: { composite: 7, originality: 7, insight: 7, credibility: 7 },
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    ...overrides,
  };
}

const profile = {
  ...createEmptyProfile("test-user"),
  calibration: { qualityThreshold: 3 },
};

describe("generateBriefing — deduplication", () => {
  it("removes duplicate articles with same sourceUrl", () => {
    const items = [
      makeItem({ sourceUrl: "https://example.com/article-1", scores: { composite: 8, originality: 8, insight: 8, credibility: 8, } }),
      makeItem({ sourceUrl: "https://example.com/article-1", scores: { composite: 6, originality: 6, insight: 6, credibility: 6, } }),
      makeItem({ sourceUrl: "https://example.com/article-2", scores: { composite: 7, originality: 7, insight: 7, credibility: 7, } }),
    ];

    const briefing = generateBriefing(items, profile);

    // Should only have 2 unique articles (deduped by sourceUrl)
    const priorityUrls = briefing.priority.map(b => b.item.sourceUrl);
    expect(new Set(priorityUrls).size).toBe(priorityUrls.length);
    // The higher-composite item should be kept
    const keptArticle1 = briefing.priority.find(b => b.item.sourceUrl === "https://example.com/article-1");
    expect(keptArticle1?.item.scores.composite).toBe(8);
  });

  it("keeps both items when sourceUrls differ", () => {
    const items = [
      makeItem({ sourceUrl: "https://a.com/article", scores: { composite: 8, originality: 8, insight: 8, credibility: 8, } }),
      makeItem({ sourceUrl: "https://b.com/article", scores: { composite: 7, originality: 7, insight: 7, credibility: 7, } }),
    ];

    const briefing = generateBriefing(items, profile);
    expect(briefing.priority.length).toBe(2);
  });

  it("uses item.id as dedup key when sourceUrl is undefined", () => {
    const item1 = makeItem({ sourceUrl: undefined });
    const item2 = makeItem({ sourceUrl: undefined });
    const items = [item1, item2];

    const briefing = generateBriefing(items, profile);
    // Both should be kept since they have different IDs
    expect(briefing.priority.length).toBe(2);
  });

  it("handles many duplicates of same URL", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        sourceUrl: "https://example.com/same",
        scores: { composite: 5 + i * 0.1, originality: 5, insight: 5, credibility: 5, },
      }),
    );

    const briefing = generateBriefing(items, profile);
    // Only 1 item should survive dedup
    const sameUrlItems = briefing.priority.filter(b => b.item.sourceUrl === "https://example.com/same");
    expect(sameUrlItems.length).toBeLessThanOrEqual(1);
  });

  it("dedup does not affect filteredOut count (uses original content.length)", () => {
    const items = [
      makeItem({ sourceUrl: "https://example.com/a", scores: { composite: 9, originality: 9, insight: 9, credibility: 9, } }),
      makeItem({ sourceUrl: "https://example.com/a", scores: { composite: 4, originality: 4, insight: 4, credibility: 4, } }),
    ];

    const briefing = generateBriefing(items, profile);
    expect(briefing.totalItems).toBe(2); // Original count, not deduped
  });
});
