/**
 * @jest-environment jsdom
 */
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
// jsdom doesn't provide TextEncoder; import from node:util
import { TextEncoder, TextDecoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "fake-indexeddb/auto";
import { _resetDB, idbClear, idbGet, idbPut, STORE_DEDUP } from "@/lib/storage/idb";
import { ArticleDeduplicator } from "@/lib/ingestion/dedup";

beforeEach(async () => {
  _resetDB();
  await idbClear(STORE_DEDUP);
  localStorage.clear();
});

describe("ArticleDeduplicator — IDB path", () => {
  it("init() loads from IDB when data exists", async () => {
    // Pre-seed IDB with dedup data
    const data = {
      urls: ["https://example.com/1"],
      fingerprints: ["abcd1234abcd1234abcd1234abcd1234"],
      order: ["u:https://example.com/1", "f:abcd1234abcd1234abcd1234abcd1234"],
    };
    await idbPut(STORE_DEDUP, "data", data);

    const dedup = new ArticleDeduplicator();
    await dedup.init();

    expect(dedup.isDuplicate("https://example.com/1", "any text")).toBe(true);
    expect(dedup.size).toBe(2);
  });

  it("flush() persists to IDB after init from IDB", async () => {
    // Seed IDB so init takes IDB path
    await idbPut(STORE_DEDUP, "data", { urls: [], fingerprints: [], order: [] });

    const dedup = new ArticleDeduplicator();
    await dedup.init();
    dedup.markSeen("https://new.com/article", "New article content");
    await dedup.flush();

    // Verify persisted to IDB
    const stored = await idbGet<{ urls: string[]; fingerprints: string[]; order: string[] }>(STORE_DEDUP, "data");
    expect(stored).toBeDefined();
    expect(stored!.urls).toContain("https://new.com/article");
    expect(stored!.fingerprints.length).toBe(1);
    expect(stored!.order.length).toBe(2);
  });

  it("reset() clears IDB data", async () => {
    await idbPut(STORE_DEDUP, "data", {
      urls: ["https://example.com/1"],
      fingerprints: ["fp1"],
      order: ["u:https://example.com/1", "f:fp1"],
    });

    const dedup = new ArticleDeduplicator();
    await dedup.init();
    expect(dedup.size).toBe(2);

    await dedup.reset();
    expect(dedup.size).toBe(0);

    // Verify IDB was cleared
    const stored = await idbGet<{ urls: string[] }>(STORE_DEDUP, "data");
    expect(stored).toBeDefined();
    expect(stored!.urls).toEqual([]);
  });

  it("init() is idempotent — second call is a no-op", async () => {
    await idbPut(STORE_DEDUP, "data", {
      urls: ["https://example.com/1"],
      fingerprints: [],
      order: ["u:https://example.com/1"],
    });

    const dedup = new ArticleDeduplicator();
    await dedup.init();
    const sizeBefore = dedup.size;

    // Modify IDB directly — should NOT affect the already-initialized instance
    await idbPut(STORE_DEDUP, "data", {
      urls: ["https://example.com/1", "https://example.com/2"],
      fingerprints: [],
      order: ["u:https://example.com/1", "u:https://example.com/2"],
    });

    await dedup.init(); // second call
    expect(dedup.size).toBe(sizeBefore);
  });

  it("flush() is no-op when not dirty", async () => {
    const dedup = new ArticleDeduplicator();
    await dedup.init();
    // No markSeen, so dirty = false
    await dedup.flush();
    // Should not have written anything to IDB
    const stored = await idbGet(STORE_DEDUP, "data");
    expect(stored).toBeUndefined();
  });

  it("IDB failure during init falls back to localStorage", async () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();

    // Seed localStorage
    const lsData = {
      urls: ["https://ls.com/1"],
      fingerprints: ["lsfp"],
      order: ["u:https://ls.com/1", "f:lsfp"],
    };
    localStorage.setItem("aegis_article_dedup", JSON.stringify(lsData));

    // Make IDB fail by closing the DB and resetting
    const db = await (await import("@/lib/storage/idb")).getDB();
    db.close();
    _resetDB();

    // Create a dedup instance — IDB will fail, should fall back to localStorage
    const dedup = new ArticleDeduplicator();
    await dedup.init();

    // Should have loaded from localStorage
    expect(dedup.isDuplicate("https://ls.com/1", "any")).toBe(true);
    spy.mockRestore();
  });
});

describe("ArticleDeduplicator — IDB round-trip integrity", () => {
  it("preserves full state through IDB save/load cycle", async () => {
    // Seed IDB
    await idbPut(STORE_DEDUP, "data", { urls: [], fingerprints: [], order: [] });

    const dedup1 = new ArticleDeduplicator();
    await dedup1.init();
    dedup1.markSeen("https://a.com", "Content A");
    dedup1.markSeen("https://b.com", "Content B");
    dedup1.markSeen(undefined, "Content C no URL");
    await dedup1.flush();

    // New instance loads from IDB
    const dedup2 = new ArticleDeduplicator();
    await dedup2.init();
    expect(dedup2.isDuplicate("https://a.com", "different")).toBe(true);
    expect(dedup2.isDuplicate("https://b.com", "different")).toBe(true);
    expect(dedup2.isDuplicate(undefined, "Content C no URL")).toBe(true);
    expect(dedup2.isDuplicate("https://c.com", "Something new")).toBe(false);
  });

  it("handles concurrent markSeen calls before single flush", async () => {
    await idbPut(STORE_DEDUP, "data", { urls: [], fingerprints: [], order: [] });

    const dedup = new ArticleDeduplicator();
    await dedup.init();

    // Rapid fire markSeen
    for (let i = 0; i < 50; i++) {
      dedup.markSeen(`https://example.com/${i}`, `Content ${i}`);
    }
    await dedup.flush();

    // Verify all persisted
    const stored = await idbGet<{ urls: string[] }>(STORE_DEDUP, "data");
    expect(stored!.urls).toHaveLength(50);
  });
});
