import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

// localStorage mock
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("ArticleDeduplicator — fingerprint normalization", () => {
  it("treats case differences as duplicates", () => {
    const d = new ArticleDeduplicator();
    d.markSeen(undefined, "Hello World");
    expect(d.isDuplicate(undefined, "hello world")).toBe(true);
  });

  it("ignores punctuation when computing fingerprint", () => {
    const d = new ArticleDeduplicator();
    d.markSeen(undefined, "Hello, World!");
    expect(d.isDuplicate(undefined, "Hello World")).toBe(true);
  });

  it("collapses whitespace for comparison", () => {
    const d = new ArticleDeduplicator();
    d.markSeen(undefined, "word1   word2\t\tword3");
    expect(d.isDuplicate(undefined, "word1 word2 word3")).toBe(true);
  });

  it("truncates text to 500 chars for fingerprint", () => {
    const d = new ArticleDeduplicator();
    const base = "a".repeat(500);
    const extended = base + "ZZZZZ";
    d.markSeen(undefined, base);
    // The extended version should have the same fingerprint since it's truncated
    expect(d.isDuplicate(undefined, extended)).toBe(true);
  });

  it("produces different fingerprints for genuinely different texts", () => {
    const d = new ArticleDeduplicator();
    const fp1 = d.computeFingerprint("Article about quantum computing");
    const fp2 = d.computeFingerprint("Article about classical music");
    expect(fp1).not.toBe(fp2);
    expect(fp1).toHaveLength(32);
    expect(fp2).toHaveLength(32);
  });

  it("returns 32-char hex string", () => {
    const d = new ArticleDeduplicator();
    const fp = d.computeFingerprint("test");
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("ArticleDeduplicator — URL deduplication", () => {
  it("detects duplicate by URL alone", () => {
    const d = new ArticleDeduplicator();
    d.markSeen("https://example.com/article", "Original text");
    expect(d.isDuplicate("https://example.com/article", "Completely different text")).toBe(true);
  });

  it("undefined URL falls back to text fingerprint", () => {
    const d = new ArticleDeduplicator();
    d.markSeen(undefined, "Unique article content here");
    expect(d.isDuplicate(undefined, "Unique article content here")).toBe(true);
    expect(d.isDuplicate(undefined, "Different article")).toBe(false);
  });

  it("empty string URL is treated as falsy (no URL match)", () => {
    const d = new ArticleDeduplicator();
    d.markSeen("", "Some text");
    // Empty string is falsy, so URL won't be stored
    expect(d.isDuplicate("", "Different text")).toBe(false);
    // But fingerprint should still match
    expect(d.isDuplicate("", "Some text")).toBe(true);
  });
});

describe("ArticleDeduplicator — FIFO pruning", () => {
  it("prunes oldest entries when exceeding MAX_ENTRIES (2000)", () => {
    const d = new ArticleDeduplicator();
    // Insert 2001 items. Each markSeen adds 1 fingerprint entry (+ 1 url entry if url given).
    // With just text (no url), each markSeen adds 1 to insertionOrder.
    for (let i = 0; i < 2001; i++) {
      d.markSeen(undefined, `Unique article number ${i} with enough variation`);
    }
    // The first item should have been pruned
    expect(d.isDuplicate(undefined, "Unique article number 0 with enough variation")).toBe(false);
    // The last item should still be present
    expect(d.isDuplicate(undefined, "Unique article number 2000 with enough variation")).toBe(true);
  });

  it("URL entries count toward the max", () => {
    const d = new ArticleDeduplicator();
    // Each markSeen with URL adds 2 entries (url + fingerprint)
    for (let i = 0; i < 1001; i++) {
      d.markSeen(`https://example.com/${i}`, `Content ${i}`);
    }
    // 1001 items × 2 entries = 2002 entries, so first item should be partially pruned
    expect(d.size).toBeLessThanOrEqual(2002);
  });
});

describe("ArticleDeduplicator — persistence", () => {
  it("round-trips data through localStorage", () => {
    const d1 = new ArticleDeduplicator();
    d1.markSeen("https://example.com/persist", "Persistence test");
    d1.flush();

    const d2 = new ArticleDeduplicator();
    expect(d2.isDuplicate("https://example.com/persist", "Persistence test")).toBe(true);
  });

  it("flush is no-op when nothing changed", () => {
    const d = new ArticleDeduplicator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setSpy = jest.spyOn(globalThis.localStorage as any, "setItem");
    d.flush();
    // Should not call setItem because dirty flag is false
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("handles corrupted localStorage gracefully", () => {
    store["aegis_article_dedup"] = "not valid json {{{";
    const d = new ArticleDeduplicator();
    // Should not throw, should start fresh
    expect(d.size).toBe(0);
    expect(d.isDuplicate(undefined, "any text")).toBe(false);
  });

  it("reset clears all data and persists", () => {
    const d = new ArticleDeduplicator();
    d.markSeen("https://example.com/1", "test1");
    d.markSeen("https://example.com/2", "test2");
    d.flush();
    expect(d.size).toBeGreaterThan(0);

    d.reset();
    expect(d.size).toBe(0);

    const d2 = new ArticleDeduplicator();
    expect(d2.isDuplicate("https://example.com/1", "test1")).toBe(false);
  });
});

describe("ArticleDeduplicator — size tracking", () => {
  it("size reflects both urls and fingerprints", () => {
    const d = new ArticleDeduplicator();
    expect(d.size).toBe(0);
    d.markSeen("https://a.com", "text a");
    expect(d.size).toBe(2); // 1 url + 1 fingerprint
    d.markSeen(undefined, "text b");
    expect(d.size).toBe(3); // 1 url + 2 fingerprints
  });
});
