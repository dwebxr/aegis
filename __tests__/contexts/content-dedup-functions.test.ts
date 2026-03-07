import type { ContentItem } from "@/lib/types/content";
import { normalizeUrl, isDuplicateItem, deduplicateItems, filterNewItems } from "@/contexts/content/dedup";

let _n = 0;
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const id = _n++;
  return {
    id: `item-${id}`,
    owner: "test",
    author: "author",
    avatar: "A",
    text: `unique text ${id}`,
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

describe("normalizeUrl", () => {
  it("strips www prefix", () => {
    expect(normalizeUrl("https://www.example.com/page")).toBe("https://example.com/page");
  });

  it("removes trailing slashes", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/page///")).toBe("https://example.com/page");
  });

  it("preserves root path as /", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("strips UTM parameters", () => {
    const url = "https://example.com/article?utm_source=twitter&utm_medium=social&id=42";
    const normalized = normalizeUrl(url);
    expect(normalized).toBe("https://example.com/article?id=42");
  });

  it("strips fbclid and gclid", () => {
    expect(normalizeUrl("https://example.com/?fbclid=abc123")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/?gclid=abc123")).toBe("https://example.com/");
  });

  it("strips ref parameter", () => {
    expect(normalizeUrl("https://example.com/page?ref=homepage&key=val")).toBe("https://example.com/page?key=val");
  });

  it("sorts remaining query parameters", () => {
    const url = "https://example.com/page?z=1&a=2&m=3";
    expect(normalizeUrl(url)).toBe("https://example.com/page?a=2&m=3&z=1");
  });

  it("removes hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("combines all normalizations", () => {
    const url = "https://www.example.com/article/?utm_source=rss&key=val#top";
    expect(normalizeUrl(url)).toBe("https://example.com/article?key=val");
  });

  it("handles invalid URLs by trimming and lowercasing", () => {
    expect(normalizeUrl("  NOT-A-URL  ")).toBe("not-a-url");
  });

  it("preserves different protocols", () => {
    expect(normalizeUrl("http://example.com/page")).toBe("http://example.com/page");
  });

  it("is idempotent", () => {
    const url = "https://www.example.com/page/?utm_source=test#hash";
    const first = normalizeUrl(url);
    const second = normalizeUrl(first);
    expect(first).toBe(second);
  });
});

describe("deduplicateItems", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateItems([])).toEqual([]);
  });

  it("returns single item unchanged", () => {
    const item = makeItem({ sourceUrl: "https://a.com" });
    expect(deduplicateItems([item])).toEqual([item]);
  });

  it("deduplicates by normalized URL", () => {
    const a = makeItem({ sourceUrl: "https://www.example.com/page/" });
    const b = makeItem({ sourceUrl: "https://example.com/page" });
    const result = deduplicateItems([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });

  it("deduplicates by URL with different tracking params", () => {
    const a = makeItem({ sourceUrl: "https://example.com/article?utm_source=rss" });
    const b = makeItem({ sourceUrl: "https://example.com/article?utm_source=twitter" });
    const result = deduplicateItems([a, b]);
    expect(result).toHaveLength(1);
  });

  it("deduplicates by text when no sourceUrl", () => {
    const a = makeItem({ text: "same content", sourceUrl: undefined });
    const b = makeItem({ text: "same content", sourceUrl: undefined });
    const result = deduplicateItems([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });

  it("deduplicates by text even when sourceUrls differ", () => {
    const a = makeItem({ sourceUrl: "https://a.com", text: "same content" });
    const b = makeItem({ sourceUrl: "https://b.com", text: "same content" });
    const result = deduplicateItems([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });

  it("keeps items with different URLs and different text", () => {
    const a = makeItem({ sourceUrl: "https://a.com", text: "text A" });
    const b = makeItem({ sourceUrl: "https://b.com", text: "text B" });
    expect(deduplicateItems([a, b])).toHaveLength(2);
  });

  it("keeps items with different text when no sourceUrl", () => {
    const a = makeItem({ text: "alpha", sourceUrl: undefined });
    const b = makeItem({ text: "beta", sourceUrl: undefined });
    expect(deduplicateItems([a, b])).toHaveLength(2);
  });

  it("handles mix of URL and non-URL items", () => {
    const a = makeItem({ sourceUrl: "https://a.com", text: "article" });
    const b = makeItem({ sourceUrl: undefined, text: "manual note" });
    const c = makeItem({ sourceUrl: "https://a.com", text: "article variant" }); // same URL
    const d = makeItem({ sourceUrl: undefined, text: "manual note" }); // same text as b
    const result = deduplicateItems([a, b, c, d]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });
});

describe("filterNewItems", () => {
  it("returns all candidates when existing is empty", () => {
    const items = [makeItem({ sourceUrl: "https://a.com" }), makeItem({ sourceUrl: "https://b.com" })];
    expect(filterNewItems(items, [])).toHaveLength(2);
  });

  it("filters out items with matching normalized URL", () => {
    const existing = [makeItem({ sourceUrl: "https://www.example.com/page/" })];
    const candidates = [makeItem({ sourceUrl: "https://example.com/page" })];
    expect(filterNewItems(candidates, existing)).toHaveLength(0);
  });

  it("filters out items with matching text", () => {
    const existing = [makeItem({ text: "same text", sourceUrl: "https://a.com" })];
    const candidates = [makeItem({ text: "same text", sourceUrl: "https://b.com" })];
    expect(filterNewItems(candidates, existing)).toHaveLength(0);
  });

  it("keeps items that are genuinely new", () => {
    const existing = [makeItem({ sourceUrl: "https://old.com", text: "old text" })];
    const candidates = [makeItem({ sourceUrl: "https://new.com", text: "new text" })];
    expect(filterNewItems(candidates, existing)).toHaveLength(1);
  });

  it("handles large arrays efficiently", () => {
    const existing = Array.from({ length: 2000 }, (_, i) =>
      makeItem({ sourceUrl: `https://site.com/article-${i}`, text: `text ${i}` }),
    );
    const candidates = [
      makeItem({ sourceUrl: "https://site.com/article-500", text: "different" }), // URL dup
      makeItem({ sourceUrl: "https://brand-new.com", text: "text 999" }), // text dup
      makeItem({ sourceUrl: "https://fresh.com", text: "fresh content" }), // genuinely new
    ];
    const start = performance.now();
    const result = filterNewItems(candidates, existing);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1);
    expect(result[0].sourceUrl).toBe("https://fresh.com");
    expect(elapsed).toBeLessThan(200);
  });
});
