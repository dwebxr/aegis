/**
 * @jest-environment jsdom
 */
import { TextEncoder, TextDecoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

// Mock IDB as unavailable to use localStorage path
jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn(),
  idbPut: jest.fn(),
  STORE_DEDUP: "dedup",
}));

// Reduce MAX_ENTRIES for testing by using a small dedup instance
// The actual MAX_ENTRIES is 2000, but we can test behavior at boundaries

describe("ArticleDeduplicator — prune edge cases", () => {
  let dedup: ArticleDeduplicator;

  beforeEach(async () => {
    localStorage.clear();
    dedup = new ArticleDeduplicator();
    await dedup.init();
  });

  it("does not prune when under limit", () => {
    dedup.markSeen("https://a.com", "text a");
    dedup.markSeen("https://b.com", "text b");
    expect(dedup.size).toBe(4); // 2 URLs + 2 fingerprints
  });

  it("markSeen adds both url and fingerprint entries", () => {
    dedup.markSeen("https://test.com", "hello world");
    expect(dedup.isDuplicate("https://test.com", "different")).toBe(true);
    expect(dedup.isDuplicate(undefined, "hello world")).toBe(true);
    expect(dedup.isDuplicate(undefined, "something else")).toBe(false);
  });

  it("isDuplicate returns false for unseen content", () => {
    expect(dedup.isDuplicate("https://new.com", "new content")).toBe(false);
  });

  it("markSeen without URL only adds fingerprint", () => {
    dedup.markSeen(undefined, "orphan text");
    expect(dedup.isDuplicate(undefined, "orphan text")).toBe(true);
    expect(dedup.size).toBe(1); // Only fingerprint, no URL
  });

  it("flush and reload preserves state via localStorage", async () => {
    dedup.markSeen("https://persist.com", "persist text");
    await dedup.flush();

    const fresh = new ArticleDeduplicator();
    await fresh.init();
    expect(fresh.isDuplicate("https://persist.com", "different")).toBe(true);
    expect(fresh.isDuplicate(undefined, "persist text")).toBe(true);
  });

  it("reset clears all entries", async () => {
    dedup.markSeen("https://a.com", "text a");
    dedup.markSeen("https://b.com", "text b");
    await dedup.reset();
    expect(dedup.size).toBe(0);
    expect(dedup.isDuplicate("https://a.com", "text a")).toBe(false);
  });

  it("computeFingerprint returns consistent hash", () => {
    const fp1 = dedup.computeFingerprint("hello world");
    const fp2 = dedup.computeFingerprint("hello world");
    const fp3 = dedup.computeFingerprint("different text");
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1.length).toBeGreaterThan(0);
  });

  it("fingerprint normalizes whitespace", () => {
    const fp1 = dedup.computeFingerprint("hello  world  test");
    const fp2 = dedup.computeFingerprint("hello world test");
    // computeContentFingerprint normalizes whitespace
    expect(fp1).toBe(fp2);
  });

  it("handles corrupted localStorage gracefully", async () => {
    localStorage.setItem("aegis_article_dedup", "not-json");
    const fresh = new ArticleDeduplicator();
    await fresh.init();
    expect(fresh.size).toBe(0);
  });

  it("handles empty localStorage data", async () => {
    localStorage.setItem("aegis_article_dedup", "{}");
    const fresh = new ArticleDeduplicator();
    await fresh.init();
    expect(fresh.size).toBe(0);
  });
});
