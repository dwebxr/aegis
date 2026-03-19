import type { ContentItem } from "@/lib/types/content";
import { normalizeUrl, isDuplicateItem, deduplicateItems, filterNewItems } from "@/contexts/content/dedup";

let _n = 1000;
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const id = _n++;
  return {
    id: `edge-${id}`,
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

// ─── normalizeUrl — boundary & edge cases ─────────────────────────────

describe("normalizeUrl — edge cases", () => {
  it("handles URL with only tracking params (all removed)", () => {
    const url = "https://example.com/page?utm_source=x&utm_medium=y&utm_campaign=z";
    expect(normalizeUrl(url)).toBe("https://example.com/page");
  });

  it("handles URL with duplicate tracking params", () => {
    const url = "https://example.com/?utm_source=a&utm_source=b";
    expect(normalizeUrl(url)).toBe("https://example.com/");
  });

  it("handles URL with mc_cid and mc_eid (Mailchimp)", () => {
    expect(normalizeUrl("https://example.com/?mc_cid=abc&mc_eid=def")).toBe("https://example.com/");
  });

  it("handles URL with port number", () => {
    expect(normalizeUrl("https://example.com:8080/page")).toBe("https://example.com:8080/page");
  });

  it("handles URL with username:password", () => {
    expect(normalizeUrl("https://user:pass@example.com/page")).toBe("https://user:pass@example.com/page");
  });

  it("handles URL with encoded characters", () => {
    const url = "https://example.com/path%20with%20spaces";
    const normalized = normalizeUrl(url);
    expect(normalized).toContain("example.com");
  });

  it("handles empty string", () => {
    expect(normalizeUrl("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(normalizeUrl("   ")).toBe("");
  });

  it("strips www from subdomain but not from domain containing www", () => {
    expect(normalizeUrl("https://www.example.com/")).toBe("https://example.com/");
    // "wwwexample.com" should not be affected
    expect(normalizeUrl("https://wwwexample.com/")).toBe("https://wwwexample.com/");
  });

  it("handles URL with multiple consecutive slashes in path", () => {
    const normalized = normalizeUrl("https://example.com/a///b///");
    // Only trailing slashes are stripped
    expect(normalized).toContain("example.com");
  });

  it("handles very long URL", () => {
    const longPath = "/a".repeat(500);
    const url = `https://example.com${longPath}`;
    const normalized = normalizeUrl(url);
    expect(normalized).toContain("example.com");
  });

  it("handles international domain names", () => {
    const url = "https://www.例え.jp/page";
    const normalized = normalizeUrl(url);
    expect(normalized).not.toContain("www.");
  });

  it("preserves query params that are not tracking params", () => {
    const url = "https://example.com/search?q=hello&page=2&utm_source=google";
    const normalized = normalizeUrl(url);
    expect(normalized).toContain("page=2");
    expect(normalized).toContain("q=hello");
    expect(normalized).not.toContain("utm_source");
  });
});

// ─── isDuplicateItem — edge cases ────────────────────────────────────

describe("isDuplicateItem — edge cases", () => {
  it("returns false for empty existing array", () => {
    const item = makeItem({ sourceUrl: "https://a.com" });
    expect(isDuplicateItem(item, [])).toBe(false);
  });

  it("matches by URL even when texts differ", () => {
    const item = makeItem({ sourceUrl: "https://www.example.com/page/", text: "new text" });
    const existing = [makeItem({ sourceUrl: "https://example.com/page", text: "old text" })];
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("matches by text even when URLs differ", () => {
    const item = makeItem({ sourceUrl: "https://a.com", text: "same" });
    const existing = [makeItem({ sourceUrl: "https://b.com", text: "same" })];
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("handles item without sourceUrl against existing with sourceUrl", () => {
    const item = makeItem({ sourceUrl: undefined, text: "unique" });
    const existing = [makeItem({ sourceUrl: "https://a.com", text: "different" })];
    expect(isDuplicateItem(item, existing)).toBe(false);
  });

  it("handles item with sourceUrl against existing without sourceUrl", () => {
    const item = makeItem({ sourceUrl: "https://a.com", text: "unique" });
    const existing = [makeItem({ sourceUrl: undefined, text: "different" })];
    expect(isDuplicateItem(item, existing)).toBe(false);
  });

  it("both item and existing have no sourceUrl — matches by text", () => {
    const item = makeItem({ sourceUrl: undefined, text: "same content" });
    const existing = [makeItem({ sourceUrl: undefined, text: "same content" })];
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("empty text matches empty text", () => {
    const item = makeItem({ sourceUrl: undefined, text: "" });
    const existing = [makeItem({ sourceUrl: undefined, text: "" })];
    expect(isDuplicateItem(item, existing)).toBe(true);
  });

  it("text match is case-sensitive", () => {
    const item = makeItem({ text: "Hello World" });
    const existing = [makeItem({ text: "hello world" })];
    expect(isDuplicateItem(item, existing)).toBe(false);
  });

  it("URL normalization strips tracking params for comparison", () => {
    const item = makeItem({ sourceUrl: "https://example.com/article?utm_source=twitter", text: "x" });
    const existing = [makeItem({ sourceUrl: "https://example.com/article?utm_source=rss", text: "y" })];
    expect(isDuplicateItem(item, existing)).toBe(true);
  });
});

// ─── deduplicateItems — edge cases ───────────────────────────────────

describe("deduplicateItems — edge cases", () => {
  it("preserves order (first occurrence wins)", () => {
    const a = makeItem({ id: "first", sourceUrl: "https://a.com", text: "content" });
    const b = makeItem({ id: "second", sourceUrl: "https://a.com", text: "different" });
    const result = deduplicateItems([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("first");
  });

  it("handles items with undefined sourceUrl and same text", () => {
    const items = Array.from({ length: 5 }, () =>
      makeItem({ sourceUrl: undefined, text: "duplicate" }),
    );
    expect(deduplicateItems(items)).toHaveLength(1);
  });

  it("handles mix: URL match + text match for different pairs", () => {
    const a = makeItem({ sourceUrl: "https://a.com", text: "text-a" });
    const b = makeItem({ sourceUrl: "https://a.com", text: "text-b" }); // URL dup of a
    const c = makeItem({ sourceUrl: "https://c.com", text: "text-a" }); // text dup of a
    const d = makeItem({ sourceUrl: "https://d.com", text: "text-d" }); // unique
    const result = deduplicateItems([a, b, c, d]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(a.id);
    expect(result[1].id).toBe(d.id);
  });

  it("handles all items identical", () => {
    const items = Array.from({ length: 10 }, () =>
      makeItem({ sourceUrl: "https://same.com", text: "same" }),
    );
    expect(deduplicateItems(items)).toHaveLength(1);
  });

  it("handles all items unique", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ sourceUrl: `https://unique-${i}.com`, text: `unique text ${i}` }),
    );
    expect(deduplicateItems(items)).toHaveLength(50);
  });
});

// ─── filterNewItems — edge cases ─────────────────────────────────────

describe("filterNewItems — edge cases", () => {
  it("returns empty when all candidates are duplicates", () => {
    const existing = [
      makeItem({ sourceUrl: "https://a.com", text: "text-a" }),
      makeItem({ sourceUrl: "https://b.com", text: "text-b" }),
    ];
    const candidates = [
      makeItem({ sourceUrl: "https://a.com", text: "different" }),
      makeItem({ sourceUrl: "https://c.com", text: "text-b" }),
    ];
    expect(filterNewItems(candidates, existing)).toHaveLength(0);
  });

  it("handles candidates with undefined sourceUrl correctly", () => {
    const existing = [makeItem({ sourceUrl: "https://a.com", text: "exists" })];
    const candidates = [
      makeItem({ sourceUrl: undefined, text: "new content" }),
      makeItem({ sourceUrl: undefined, text: "exists" }), // text dup
    ];
    const result = filterNewItems(candidates, existing);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("new content");
  });

  it("handles empty candidates", () => {
    const existing = [makeItem()];
    expect(filterNewItems([], existing)).toHaveLength(0);
  });

  it("handles both empty", () => {
    expect(filterNewItems([], [])).toHaveLength(0);
  });

  it("does not modify original arrays", () => {
    const existing = [makeItem({ sourceUrl: "https://a.com" })];
    const candidates = [makeItem({ sourceUrl: "https://a.com" }), makeItem({ sourceUrl: "https://b.com" })];
    const existingLen = existing.length;
    const candidatesLen = candidates.length;
    filterNewItems(candidates, existing);
    expect(existing).toHaveLength(existingLen);
    expect(candidates).toHaveLength(candidatesLen);
  });

  it("doesn't deduplicate within candidates — only against existing", () => {
    const existing: ContentItem[] = [];
    const candidates = [
      makeItem({ sourceUrl: "https://a.com", text: "same" }),
      makeItem({ sourceUrl: "https://a.com", text: "same" }),
    ];
    // Both candidates are new relative to existing (which is empty)
    // filterNewItems checks against existing, not within candidates
    const result = filterNewItems(candidates, existing);
    expect(result).toHaveLength(2);
  });
});
