import type { ContentItem } from "@/lib/types/content";
import { isDuplicateItem } from "@/contexts/content/dedup";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test",
    author: "author",
    avatar: "A",
    text: "default text",
    source: "manual",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

describe("isDuplicateItem", () => {
  it("detects duplicate by sourceUrl", () => {
    const existing = [makeItem({ sourceUrl: "https://example.com/article" })];
    const dup = makeItem({ sourceUrl: "https://example.com/article", text: "different text" });
    expect(isDuplicateItem(dup, existing)).toBe(true);
  });

  it("detects duplicate by text when no sourceUrl", () => {
    const existing = [makeItem({ text: "same text here", sourceUrl: undefined })];
    const dup = makeItem({ text: "same text here", sourceUrl: undefined });
    expect(isDuplicateItem(dup, existing)).toBe(true);
  });

  it("does not detect as duplicate with different sourceUrl and text", () => {
    const existing = [makeItem({ sourceUrl: "https://a.com", text: "article A" })];
    const notDup = makeItem({ sourceUrl: "https://b.com", text: "article B" });
    expect(isDuplicateItem(notDup, existing)).toBe(false);
  });

  it("does not detect as duplicate with different text (no sourceUrl)", () => {
    const existing = [makeItem({ text: "text A", sourceUrl: undefined })];
    const notDup = makeItem({ text: "text B", sourceUrl: undefined });
    expect(isDuplicateItem(notDup, existing)).toBe(false);
  });

  it("sourceUrl match takes precedence over text comparison", () => {
    const existing = [makeItem({ sourceUrl: "https://same.com", text: "original" })];
    const dup = makeItem({ sourceUrl: "https://same.com", text: "modified" });
    expect(isDuplicateItem(dup, existing)).toBe(true);
  });

  it("items with same text but different sourceUrl are duplicates", () => {
    const existing = [makeItem({ sourceUrl: "https://unique.com", text: "same text" })];
    const item = makeItem({ sourceUrl: "https://other.com", text: "same text" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("empty existing array means no duplicates", () => {
    expect(isDuplicateItem(makeItem(), [])).toBe(false);
  });

  it("handles item without sourceUrl against existing with sourceUrl", () => {
    const existing = [makeItem({ sourceUrl: "https://a.com", text: "same" })];
    const item = makeItem({ sourceUrl: undefined, text: "same" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("handles item with empty string sourceUrl", () => {
    const existing = [makeItem({ sourceUrl: "", text: "match" })];
    const item = makeItem({ sourceUrl: "", text: "match" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("handles a large existing array efficiently and correctly", () => {
    const existing = Array.from({ length: 10000 }, (_, i) =>
      makeItem({ sourceUrl: `https://site.com/article-${i}`, text: `text ${i}` }),
    );
    // Correctness at scale (deterministic): a unique item is not flagged, and a
    // match deep in a 10k array IS still detected.
    const notDup = makeItem({ sourceUrl: "https://unique-url.com", text: "unique" });
    expect(isDuplicateItem(notDup, existing)).toBe(false);
    const dup = makeItem({ sourceUrl: "https://site.com/article-9999", text: "text 9999" });
    expect(isDuplicateItem(dup, existing)).toBe(true);
    // Catastrophe guard only: an O(n^2) regression on 10k items would take
    // seconds. A tight sub-100ms wall-clock bound flakes under coverage
    // instrumentation and shared CI runners, so use a generous ceiling that
    // still catches a genuine algorithmic blow-up.
    const start = performance.now();
    isDuplicateItem(notDup, existing);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("detects duplicate with www vs non-www URL", () => {
    const existing = [makeItem({ sourceUrl: "https://www.example.com/article", text: "a" })];
    const item = makeItem({ sourceUrl: "https://example.com/article", text: "b" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("detects duplicate with trailing slash difference", () => {
    const existing = [makeItem({ sourceUrl: "https://example.com/page/", text: "a" })];
    const item = makeItem({ sourceUrl: "https://example.com/page", text: "b" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("detects duplicate ignoring UTM parameters", () => {
    const existing = [makeItem({ sourceUrl: "https://example.com/article?utm_source=rss", text: "a" })];
    const item = makeItem({ sourceUrl: "https://example.com/article?utm_source=twitter", text: "b" });
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("does not falsely match different paths after normalization", () => {
    const existing = [makeItem({ sourceUrl: "https://example.com/page-1", text: "a" })];
    const item = makeItem({ sourceUrl: "https://example.com/page-2", text: "b" });
    expect(isDuplicateItem(item, existing)).toBe(false);
  });
});
