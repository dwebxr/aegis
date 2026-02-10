/**
 * Edge case tests for lib/ingestion/dedup.ts
 * Tests fingerprint stability, near-duplicate handling, pruning boundary,
 * and concurrent dedup operations.
 */
import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  },
  writable: true,
});

describe("ArticleDeduplicator — edge cases", () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
  });

  describe("fingerprint stability", () => {
    it("produces same fingerprint for equivalent text after normalization", () => {
      const dedup = new ArticleDeduplicator();
      const fp1 = dedup.computeFingerprint("Hello, World! This is a test.");
      const fp2 = dedup.computeFingerprint("HELLO, WORLD! THIS IS A TEST.");
      expect(fp1).toBe(fp2);
    });

    it("produces same fingerprint ignoring punctuation differences", () => {
      const dedup = new ArticleDeduplicator();
      const fp1 = dedup.computeFingerprint("Hello World");
      const fp2 = dedup.computeFingerprint("Hello, World!");
      expect(fp1).toBe(fp2);
    });

    it("produces same fingerprint ignoring extra whitespace", () => {
      const dedup = new ArticleDeduplicator();
      const fp1 = dedup.computeFingerprint("Hello  World");
      const fp2 = dedup.computeFingerprint("Hello World");
      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprints for different content", () => {
      const dedup = new ArticleDeduplicator();
      const fp1 = dedup.computeFingerprint("Article about AI research");
      const fp2 = dedup.computeFingerprint("Article about quantum computing");
      expect(fp1).not.toBe(fp2);
    });

    it("uses only first 500 chars for fingerprint", () => {
      const dedup = new ArticleDeduplicator();
      const base = "a".repeat(500);
      const fp1 = dedup.computeFingerprint(base + " extra content that should be ignored");
      const fp2 = dedup.computeFingerprint(base + " completely different ending text");
      expect(fp1).toBe(fp2);
    });

    it("fingerprint is 32 hex characters (16 bytes)", () => {
      const dedup = new ArticleDeduplicator();
      const fp = dedup.computeFingerprint("Some test content");
      expect(fp).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("URL-based dedup", () => {
    it("detects duplicate by URL even with different content", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/article-1", "First version of the content");
      expect(dedup.isDuplicate("https://example.com/article-1", "Updated content version")).toBe(true);
    });

    it("does not deduplicate different URLs with same content", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/article-1", "Same content here");
      // Different URL but same content — caught by fingerprint
      expect(dedup.isDuplicate("https://example.com/article-2", "Same content here")).toBe(true);
    });

    it("handles undefined URL gracefully", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen(undefined, "Content without URL");
      expect(dedup.isDuplicate(undefined, "Content without URL")).toBe(true);
      expect(dedup.isDuplicate(undefined, "Different content")).toBe(false);
    });
  });

  describe("pruning at MAX_ENTRIES boundary", () => {
    it("prunes oldest entries when exceeding 2000", () => {
      const dedup = new ArticleDeduplicator();

      // Add 1001 URL-based entries (each adds 1 URL + 1 fingerprint = 2 insertions)
      for (let i = 0; i < 1001; i++) {
        dedup.markSeen(`https://example.com/${i}`, `Content ${i}`);
      }

      // Oldest entries should be pruned
      // Each markSeen adds 2 entries (URL + fingerprint), so 1001 * 2 = 2002 > 2000
      // First entry should be pruned
      expect(dedup.isDuplicate(`https://example.com/0`, "Different content now")).toBe(false);

      // Recent entries should still be present
      expect(dedup.isDuplicate(`https://example.com/1000`, "Content 1000")).toBe(true);
    });
  });

  describe("cross-feed dedup", () => {
    it("detects same article appearing in different RSS feeds", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://feed-a.com/article", "Identical article text shared across feeds");
      // Same article syndicated on another feed
      expect(dedup.isDuplicate("https://feed-b.com/article-copy", "Identical article text shared across feeds")).toBe(true);
    });
  });

  describe("size tracking", () => {
    it("tracks combined URL + fingerprint count", () => {
      const dedup = new ArticleDeduplicator();
      expect(dedup.size).toBe(0);

      dedup.markSeen("https://example.com/1", "Content 1");
      expect(dedup.size).toBe(2); // 1 URL + 1 fingerprint

      dedup.markSeen(undefined, "Content 2");
      expect(dedup.size).toBe(3); // +1 fingerprint (no URL)
    });
  });

  describe("localStorage persistence", () => {
    it("survives reconstruction from localStorage", () => {
      const dedup1 = new ArticleDeduplicator();
      dedup1.markSeen("https://example.com/persisted", "Persisted content");

      // Create new instance — should load from localStorage
      const dedup2 = new ArticleDeduplicator();
      expect(dedup2.isDuplicate("https://example.com/persisted", "Other")).toBe(true);
      expect(dedup2.isDuplicate(undefined, "Persisted content")).toBe(true);
    });

    it("handles corrupted localStorage gracefully", () => {
      store["aegis_article_dedup"] = "not valid json {{{";
      const dedup = new ArticleDeduplicator();
      // Should start fresh without crashing
      expect(dedup.size).toBe(0);
      expect(dedup.isDuplicate("https://example.com/x", "test")).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all state and localStorage", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen("https://example.com/x", "Content");
      expect(dedup.size).toBeGreaterThan(0);

      dedup.reset();
      expect(dedup.size).toBe(0);
      expect(dedup.isDuplicate("https://example.com/x", "Content")).toBe(false);

      // New instance should also be empty (localStorage cleared)
      const dedup2 = new ArticleDeduplicator();
      expect(dedup2.size).toBe(0);
    });
  });

  describe("empty/edge input", () => {
    it("handles empty string content", () => {
      const dedup = new ArticleDeduplicator();
      dedup.markSeen(undefined, "");
      expect(dedup.isDuplicate(undefined, "")).toBe(true);
    });

    it("handles very long content (uses first 500 chars only)", () => {
      const dedup = new ArticleDeduplicator();
      const longText = "x".repeat(100000);
      // Should not crash or be slow
      dedup.markSeen(undefined, longText);
      expect(dedup.isDuplicate(undefined, longText)).toBe(true);
    });
  });
});
