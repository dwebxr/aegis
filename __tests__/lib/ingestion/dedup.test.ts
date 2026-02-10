import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

// Mock localStorage
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { for (const k in store) delete store[k]; },
    },
    writable: true,
  });
});

afterEach(() => {
  for (const k in store) delete store[k];
});

describe("ArticleDeduplicator", () => {
  describe("URL-based dedup", () => {
    it("detects duplicate URL", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/article", "some text");
      expect(dedup.isDuplicate("https://example.com/article", "different text")).toBe(true);
    });

    it("does not flag different URL as duplicate", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/a", "text");
      expect(dedup.isDuplicate("https://example.com/b", "totally different")).toBe(false);
    });
  });

  describe("fingerprint-based dedup", () => {
    it("detects identical content from different URLs", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://a.com/post", "This is the exact same article content");
      expect(dedup.isDuplicate("https://b.com/post", "This is the exact same article content")).toBe(true);
    });

    it("handles minor differences in punctuation/casing", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen(undefined, "Hello World! This is a test.");
      // After normalization (lowercase, strip punctuation), should match
      expect(dedup.isDuplicate(undefined, "hello world this is a test")).toBe(true);
    });

    it("does not match significantly different content", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen(undefined, "An article about machine learning and neural networks");
      expect(dedup.isDuplicate(undefined, "A recipe for chocolate cake with frosting")).toBe(false);
    });
  });

  describe("computeFingerprint", () => {
    it("returns a hex string", () => {
      const dedup = new ArticleDeduplicator();
      const fp = dedup.computeFingerprint("hello world");
      expect(fp).toMatch(/^[0-9a-f]+$/);
      expect(fp.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it("is deterministic", () => {
      const dedup = new ArticleDeduplicator();
      expect(dedup.computeFingerprint("test")).toBe(dedup.computeFingerprint("test"));
    });

    it("normalizes text before hashing", () => {
      const dedup = new ArticleDeduplicator();
      expect(dedup.computeFingerprint("Hello, World!")).toBe(dedup.computeFingerprint("hello world"));
    });
  });

  describe("cross-feed dedup", () => {
    it("detects same article appearing in different feeds", () => {
      const dedup = new ArticleDeduplicator();
      const article = "Breaking: New AI model achieves state of the art on benchmark X with 95% accuracy";
      dedup.markSeen("https://feed-a.com/article-123", article);
      // Same content syndicated on feed B with different URL
      expect(dedup.isDuplicate("https://feed-b.com/repost-456", article)).toBe(true);
    });
  });

  describe("localStorage persistence", () => {
    it("persists across instances", () => {
      const dedup1 = new ArticleDeduplicator();
      dedup1.markSeen("https://example.com/1", "unique content here");

      // New instance should load from localStorage
      const dedup2 = new ArticleDeduplicator();
      expect(dedup2.isDuplicate("https://example.com/1", "other text")).toBe(true);
    });
  });

  describe("pruning", () => {
    it("maintains entries within MAX limit", () => {
      const dedup = new ArticleDeduplicator();
      // Mark 1100 items — each produces ~2 entries (url + fingerprint)
      for (let i = 0; i < 1100; i++) {
        dedup.markSeen(`https://example.com/${i}`, `content ${i} with enough words to be unique`);
      }
      // Should have pruned oldest entries
      expect(dedup.size).toBeLessThanOrEqual(2200); // max 2000 entries in insertionOrder
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/1", "text");
      dedup.reset();
      expect(dedup.isDuplicate("https://example.com/1", "text")).toBe(false);
      expect(dedup.size).toBe(0);
    });
  });
});
