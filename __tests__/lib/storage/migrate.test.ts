/**
 * @jest-environment jsdom
 */
// Polyfill structuredClone for jsdom (required by fake-indexeddb)
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import { migrateToIDB } from "@/lib/storage/migrate";
import { idbGet, idbClear, _resetDB, STORE_SCORE_CACHE, STORE_DEDUP, STORE_CONTENT_CACHE, STORE_WOT_CACHE } from "@/lib/storage/idb";

const MIGRATION_FLAG = "aegis-idb-migrated-v1";

beforeEach(async () => {
  _resetDB();
  // Clear all IDB stores
  await idbClear(STORE_SCORE_CACHE);
  await idbClear(STORE_DEDUP);
  await idbClear(STORE_CONTENT_CACHE);
  await idbClear(STORE_WOT_CACHE);
  localStorage.clear();
});

describe("migrateToIDB", () => {
  it("migrates score-cache from localStorage to IDB", async () => {
    const data = { "key1": { result: {}, storedAt: 1, profileHash: "p" } };
    localStorage.setItem("aegis-score-cache", JSON.stringify(data));
    await migrateToIDB();
    const stored = await idbGet(STORE_SCORE_CACHE, "data");
    expect(stored).toEqual(data);
    expect(localStorage.getItem("aegis-score-cache")).toBeNull();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
  });

  it("migrates dedup data", async () => {
    const data = { urls: ["u1"], fingerprints: ["f1"], order: ["u:u1", "f:f1"] };
    localStorage.setItem("aegis_article_dedup", JSON.stringify(data));
    await migrateToIDB();
    expect(await idbGet(STORE_DEDUP, "data")).toEqual(data);
    expect(localStorage.getItem("aegis_article_dedup")).toBeNull();
  });

  it("migrates content-cache", async () => {
    const items = [{ id: "1", createdAt: 1000 }];
    localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    await migrateToIDB();
    expect(await idbGet(STORE_CONTENT_CACHE, "items")).toEqual(items);
  });

  it("migrates wot-cache", async () => {
    const graph = { graph: { userPubkey: "pk" }, cachedAt: 1, ttl: 3600000 };
    localStorage.setItem("aegis-wot-graph", JSON.stringify(graph));
    await migrateToIDB();
    expect(await idbGet(STORE_WOT_CACHE, "graph")).toEqual(graph);
  });

  it("skips if already migrated", async () => {
    localStorage.setItem(MIGRATION_FLAG, "1");
    localStorage.setItem("aegis-score-cache", '{"key":"value"}');
    await migrateToIDB();
    // Score cache should NOT have been migrated
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toBeUndefined();
    // Original still in localStorage
    expect(localStorage.getItem("aegis-score-cache")).not.toBeNull();
  });

  it("handles empty localStorage gracefully", async () => {
    await migrateToIDB();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
  });

  it("migrates only non-null keys", async () => {
    localStorage.setItem("aegis-score-cache", '{"k":1}');
    // aegis_article_dedup intentionally empty
    await migrateToIDB();
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toEqual({ k: 1 });
    expect(await idbGet(STORE_DEDUP, "data")).toBeUndefined();
  });

  it("sets migration flag after successful migration", async () => {
    localStorage.setItem("aegis-score-cache", '{"k":1}');
    expect(localStorage.getItem(MIGRATION_FLAG)).toBeNull();
    await migrateToIDB();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
  });
});
