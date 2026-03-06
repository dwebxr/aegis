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

  it("does not detect as duplicate with different sourceUrl", () => {
    const existing = [makeItem({ sourceUrl: "https://a.com" })];
    const notDup = makeItem({ sourceUrl: "https://b.com" });
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

  it("items with sourceUrl are not duplicate-checked by text", () => {
    const existing = [makeItem({ sourceUrl: "https://unique.com", text: "same text" })];
    const item = makeItem({ sourceUrl: "https://other.com", text: "same text" });
    expect(isDuplicateItem(item, existing)).toBe(false);
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

  it("handles large existing array efficiently", () => {
    const existing = Array.from({ length: 10000 }, (_, i) =>
      makeItem({ sourceUrl: `https://site.com/article-${i}` }),
    );
    const start = performance.now();
    const notDup = makeItem({ sourceUrl: "https://unique-url.com" });
    isDuplicateItem(notDup, existing);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
