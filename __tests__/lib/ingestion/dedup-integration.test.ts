import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

describe("ArticleDeduplicator — fingerprint accuracy", () => {
  let dedup: ArticleDeduplicator;

  beforeEach(() => {
    dedup = new ArticleDeduplicator();
    dedup.reset();
  });

  it("detects identical text as duplicate", () => {
    const text = "This is a test article about AI and machine learning.";
    dedup.markSeen(undefined, text);
    expect(dedup.isDuplicate(undefined, text)).toBe(true);
  });

  it("detects URL-based duplicate", () => {
    dedup.markSeen("https://example.com/article-1", "some text");
    expect(dedup.isDuplicate("https://example.com/article-1", "different text")).toBe(true);
  });

  it("does not flag different text as duplicate", () => {
    dedup.markSeen(undefined, "Article about cats");
    expect(dedup.isDuplicate(undefined, "Article about dogs")).toBe(false);
  });

  it("normalizes text (case insensitive, whitespace collapsed)", () => {
    dedup.markSeen(undefined, "Hello   World  Test");
    expect(dedup.isDuplicate(undefined, "hello world test")).toBe(true);
  });

  it("normalizes text (strips punctuation)", () => {
    dedup.markSeen(undefined, "Hello, World! This is a test.");
    expect(dedup.isDuplicate(undefined, "Hello World This is a test")).toBe(true);
  });

  it("fingerprints are deterministic", () => {
    const fp1 = dedup.computeFingerprint("test content");
    const fp2 = dedup.computeFingerprint("test content");
    expect(fp1).toBe(fp2);
  });

  it("fingerprints differ for different content", () => {
    const fp1 = dedup.computeFingerprint("article about AI");
    const fp2 = dedup.computeFingerprint("article about cooking");
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint is hex string of length 32 (16 bytes)", () => {
    const fp = dedup.computeFingerprint("any text");
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("truncates text to 500 chars before fingerprinting", () => {
    const short = "a".repeat(500);
    const long = "a".repeat(1000);
    // Both should produce the same fingerprint since only first 500 chars are used
    const fp1 = dedup.computeFingerprint(short);
    const fp2 = dedup.computeFingerprint(long);
    expect(fp1).toBe(fp2);
  });
});

describe("ArticleDeduplicator — FIFO pruning", () => {
  it("prunes oldest entries when exceeding MAX_ENTRIES (2000)", () => {
    const dedup = new ArticleDeduplicator();
    dedup.reset();

    // Add 2100 entries
    for (let i = 0; i < 2100; i++) {
      dedup.markSeen(`https://example.com/article-${i}`, `Unique article content number ${i}`);
    }

    // Oldest entries should have been pruned
    expect(dedup.isDuplicate("https://example.com/article-0", "different")).toBe(false);
    // Recent entries should still be present
    expect(dedup.isDuplicate("https://example.com/article-2099", "different")).toBe(true);
  });

  it("tracks size correctly", () => {
    const dedup = new ArticleDeduplicator();
    dedup.reset();

    expect(dedup.size).toBe(0);

    dedup.markSeen("https://a.com", "text a");
    // URL + fingerprint = 2 entries in sets
    expect(dedup.size).toBe(2);

    dedup.markSeen(undefined, "text b");
    // Only fingerprint (no URL) = +1
    expect(dedup.size).toBe(3);
  });
});

describe("ArticleDeduplicator — flush/dirty tracking", () => {
  it("flush() completes without error and data remains accessible", async () => {
    const dedup = new ArticleDeduplicator();
    await dedup.reset();

    dedup.markSeen("https://a.com", "test content for flush");
    await dedup.flush();

    // Verify the data survives by checking isDuplicate still works
    expect(dedup.isDuplicate("https://a.com", "anything")).toBe(true);
    expect(dedup.size).toBe(2);
  });

  it("flush() is no-op when not dirty", async () => {
    const dedup = new ArticleDeduplicator();
    await dedup.reset();
    const sizeBefore = dedup.size;

    // No markSeen → not dirty → flush should be quick no-op
    await dedup.flush();
    // Size should remain the same (0) after a no-op flush
    expect(dedup.size).toBe(sizeBefore);
  });
});
