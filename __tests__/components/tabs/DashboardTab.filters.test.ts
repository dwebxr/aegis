/**
 * DashboardTab — filter logic, content export helpers, and Topic Spotlight edge cases.
 * Tests exercise real utility functions from lib/dashboard/utils.
 */
import { applyDashboardFilters, matchesTopic, buildTopicPatternCache } from "@/lib/dashboard/utils";
import { deduplicateItems } from "@/contexts/content/dedup";
import { contentToCSV } from "@/lib/utils/csv";
import { generateBriefing } from "@/lib/briefing/ranker";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

let _itemCounter = 0;
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _itemCounter++;
  return {
    id: `item-${n}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: `Test content text for testing purposes #${n}`,
    source: "manual",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test reason",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

describe("Filtering logic", () => {
  const items = [
    makeItem({ id: "q1", verdict: "quality", source: "manual" }),
    makeItem({ id: "q2", verdict: "quality", source: "rss" }),
    makeItem({ id: "s1", verdict: "slop", source: "manual" }),
    makeItem({ id: "s2", verdict: "slop", source: "nostr" }),
    makeItem({ id: "v1", verdict: "quality", validated: true, validatedAt: 2000, source: "rss" }),
    makeItem({ id: "v2", verdict: "quality", validated: true, validatedAt: 1000, source: "manual" }),
  ];

  it("all filter returns everything", () => {
    expect(applyDashboardFilters(items, "all", "all")).toHaveLength(6);
  });

  it("quality filter returns exactly the 4 quality items by ID", () => {
    const result = applyDashboardFilters(items, "quality", "all");
    const ids = result.map(c => c.id);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual(expect.arrayContaining(["q1", "q2", "v1", "v2"]));
    expect(ids).not.toContain("s1");
    expect(ids).not.toContain("s2");
  });

  it("slop filter returns exactly the 2 slop items by ID", () => {
    const result = applyDashboardFilters(items, "slop", "all");
    const ids = result.map(c => c.id);
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("validated filter returns validated items sorted by validatedAt desc", () => {
    const result = applyDashboardFilters(items, "validated", "all");
    expect(result.map(c => c.id)).toEqual(["v1", "v2"]);
    expect(result[0].validatedAt).toBe(2000);
    expect(result[1].validatedAt).toBe(1000);
  });

  it("source filter narrows to specific source by ID", () => {
    const result = applyDashboardFilters(items, "all", "rss");
    const ids = result.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(["q2", "v1"]));
    expect(ids).toHaveLength(2);
  });

  it("combined verdict + source filter returns matching items by ID", () => {
    const result = applyDashboardFilters(items, "quality", "manual");
    const ids = result.map(c => c.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(["q1", "v2"]));
  });

  it("returns empty for non-matching source", () => {
    expect(applyDashboardFilters(items, "all", "twitter")).toHaveLength(0);
  });

  it("returns empty for slop filter with only quality content", () => {
    const qualityOnly = items.filter(c => c.verdict === "quality");
    expect(applyDashboardFilters(qualityOnly, "slop", "all")).toHaveLength(0);
  });

  it("empty content returns empty", () => {
    expect(applyDashboardFilters([], "all", "all")).toHaveLength(0);
  });
});

// ─── Topic Spotlight matching (replicates DashboardTab logic) ──

describe("Topic Spotlight matching", () => {
  it("matches by explicit topic tag (case-insensitive)", () => {
    const cache = buildTopicPatternCache(["AI"]);
    const item = makeItem({ topics: ["ai", "ml"], text: "Some text" });
    expect(matchesTopic(item, "AI", cache)).toBe(true);
  });

  it("matches by text content when topics array is empty", () => {
    const cache = buildTopicPatternCache(["blockchain"]);
    const item = makeItem({ topics: undefined, text: "The blockchain revolution is here" });
    expect(matchesTopic(item, "blockchain", cache)).toBe(true);
  });

  it("does NOT match partial word in text", () => {
    const cache = buildTopicPatternCache(["ai"]);
    const item = makeItem({ topics: undefined, text: "The airplane was delayed" });
    expect(matchesTopic(item, "ai", cache)).toBe(false);
  });

  it("handles regex special characters in topic names via explicit tags", () => {
    const cache = buildTopicPatternCache(["c++"]);
    // Regex word-boundary \b won't match "c++" in text (+ is non-word char),
    // but explicit topic tag matching still works
    const itemWithTag = makeItem({ topics: ["c++"], text: "Some text" });
    expect(matchesTopic(itemWithTag, "c++", cache)).toBe(true);

    // Text-only fallback doesn't match due to \b + special chars
    const itemTextOnly = makeItem({ topics: undefined, text: "Learning c++ programming" });
    expect(matchesTopic(itemTextOnly, "c++", cache)).toBe(false);
  });

  it("does NOT match in reason field (avoids encoded metadata)", () => {
    const cache = buildTopicPatternCache(["crypto"]);
    const item = makeItem({ topics: undefined, text: "Unrelated text", reason: "This is about crypto [topics:crypto]" });
    // Should NOT match because we only search text, not reason
    expect(matchesTopic(item, "crypto", cache)).toBe(false);
  });

  it("explicit tag match takes priority (short-circuits text search)", () => {
    const cache = buildTopicPatternCache(["ai"]);
    const item = makeItem({ topics: ["ai"], text: "" }); // Empty text
    expect(matchesTopic(item, "ai", cache)).toBe(true);
  });
});

// ─── Content Export ──

describe("contentToCSV", () => {
  it("produces valid CSV with headers", () => {
    const items = [makeItem({ id: "test-1", author: "Alice", verdict: "quality" })];
    const csv = contentToCSV(items);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("author");
    expect(lines[0]).toContain("verdict");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("escapes commas in content", () => {
    const items = [makeItem({ text: "Hello, World" })];
    const csv = contentToCSV(items);
    // Commas inside fields should be quoted
    expect(csv).toContain('"Hello, World"');
  });

  it("handles empty content array", () => {
    const csv = contentToCSV([]);
    // Should still have a header row
    const lines = csv.split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it("escapes quotes in content", () => {
    const items = [makeItem({ author: 'Dr. "Quotes" Smith' })];
    const csv = contentToCSV(items);
    // Double-quotes should be escaped
    expect(csv).toContain('""Quotes""');
  });
});

// ─── Briefing integration: edge cases ──

describe("generateBriefing edge cases", () => {
  it("handles all-flagged content (returns empty priority)", () => {
    const items = [
      makeItem({ flagged: true, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing(items, profile);
    expect(briefing.priority).toHaveLength(0);
  });

  it("handles empty content array", () => {
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing([], profile);
    expect(briefing.priority).toHaveLength(0);
  });

  it("boosts items matching high affinity topics", () => {
    const profile = {
      ...createEmptyProfile("test"),
      topicAffinities: { "ai": 0.9 },
    };
    const aiItem = makeItem({ id: "ai-item", topics: ["ai"], text: "AI article about machine learning", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } });
    const plainItem = makeItem({ id: "plain", topics: ["cooking"], text: "Cooking article about recipes", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } });
    const briefing = generateBriefing([aiItem, plainItem], profile);

    expect(briefing.priority.length).toBeGreaterThanOrEqual(2);
    const aiEntry = briefing.priority.find(p => p.item.id === "ai-item");
    const plainEntry = briefing.priority.find(p => p.item.id === "plain");
    expect(aiEntry).toBeDefined();
    expect(plainEntry).toBeDefined();
    // AI item should have higher briefing score due to affinity boost
    expect(aiEntry!.briefingScore).toBeGreaterThan(plainEntry!.briefingScore);
  });

  it("excludes slop items from priority list", () => {
    const items = [
      makeItem({ verdict: "slop", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ verdict: "quality", scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
    ];
    const profile = createEmptyProfile("test");
    const briefing = generateBriefing(items, profile);
    // Only quality items should appear
    expect(briefing.priority.every(p => p.item.verdict === "quality")).toBe(true);
  });
});

// ─── DashboardTab dedup integration (mirrors filteredContent logic) ──

describe("DashboardTab filteredContent dedup", () => {
  it("removes duplicate items with same normalized URL from filtered results", () => {
    const items = [
      makeItem({ id: "dup-1", sourceUrl: "https://www.example.com/article/", verdict: "quality", text: "article A" }),
      makeItem({ id: "dup-2", sourceUrl: "https://example.com/article", verdict: "quality", text: "article B" }),
      makeItem({ id: "unique", sourceUrl: "https://other.com/page", verdict: "quality", text: "article C" }),
    ];
    const filtered = applyDashboardFilters(items, "quality", "all");
    const deduped = deduplicateItems(filtered);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].id).toBe("dup-1"); // first occurrence kept
    expect(deduped[1].id).toBe("unique");
  });

  it("removes duplicate items with same text from filtered results", () => {
    const items = [
      makeItem({ id: "t1", sourceUrl: "https://a.com", text: "same content", verdict: "quality" }),
      makeItem({ id: "t2", sourceUrl: "https://b.com", text: "same content", verdict: "quality" }),
    ];
    const filtered = applyDashboardFilters(items, "quality", "all");
    const deduped = deduplicateItems(filtered);
    expect(deduped).toHaveLength(1);
  });

  it("removes duplicates with UTM parameter variations", () => {
    const items = [
      makeItem({ id: "utm-1", sourceUrl: "https://example.com/post?utm_source=rss", verdict: "quality", text: "text A" }),
      makeItem({ id: "utm-2", sourceUrl: "https://example.com/post?utm_source=twitter", verdict: "quality", text: "text B" }),
    ];
    const filtered = applyDashboardFilters(items, "quality", "all");
    const deduped = deduplicateItems(filtered);
    expect(deduped).toHaveLength(1);
  });
});
