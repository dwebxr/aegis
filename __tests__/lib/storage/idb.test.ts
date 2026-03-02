/**
 * @jest-environment jsdom
 */
// Polyfill structuredClone for jsdom (required by fake-indexeddb)
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import {
  getDB,
  idbGet,
  idbPut,
  idbDelete,
  idbGetAll,
  idbClear,
  idbPutBatch,
  isIDBAvailable,
  _resetDB,
  STORE_SCORE_CACHE,
  STORE_DEDUP,
  STORE_CONTENT_CACHE,
  STORE_WOT_CACHE,
} from "@/lib/storage/idb";

beforeEach(async () => {
  _resetDB();
  // Clear all stores for isolation (fake-indexeddb persists across tests)
  await idbClear(STORE_SCORE_CACHE);
  await idbClear(STORE_DEDUP);
  await idbClear(STORE_CONTENT_CACHE);
  await idbClear(STORE_WOT_CACHE);
});

describe("isIDBAvailable", () => {
  it("returns true when indexedDB is available", () => {
    expect(isIDBAvailable()).toBe(true);
  });
});

describe("getDB", () => {
  it("opens database and creates all stores", async () => {
    const db = await getDB();
    expect(db.name).toBe("aegis-storage");
    expect(db.objectStoreNames.contains(STORE_SCORE_CACHE)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_DEDUP)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_CONTENT_CACHE)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_WOT_CACHE)).toBe(true);
  });

  it("returns the same cached connection on second call", async () => {
    const db1 = await getDB();
    const db2 = await getDB();
    expect(db1).toBe(db2);
  });
});

describe("idbPut / idbGet", () => {
  it("stores and retrieves a value", async () => {
    await idbPut(STORE_SCORE_CACHE, "key1", { score: 42 });
    const result = await idbGet<{ score: number }>(STORE_SCORE_CACHE, "key1");
    expect(result).toEqual({ score: 42 });
  });

  it("returns undefined for non-existent key", async () => {
    const result = await idbGet(STORE_SCORE_CACHE, "missing");
    expect(result).toBeUndefined();
  });

  it("overwrites value on same key", async () => {
    await idbPut(STORE_DEDUP, "k", "old");
    await idbPut(STORE_DEDUP, "k", "new");
    expect(await idbGet(STORE_DEDUP, "k")).toBe("new");
  });

  it("stores different values in different stores", async () => {
    await idbPut(STORE_SCORE_CACHE, "k", "score");
    await idbPut(STORE_DEDUP, "k", "dedup");
    expect(await idbGet(STORE_SCORE_CACHE, "k")).toBe("score");
    expect(await idbGet(STORE_DEDUP, "k")).toBe("dedup");
  });
});

describe("idbDelete", () => {
  it("removes a value", async () => {
    await idbPut(STORE_CONTENT_CACHE, "key1", "value");
    await idbDelete(STORE_CONTENT_CACHE, "key1");
    expect(await idbGet(STORE_CONTENT_CACHE, "key1")).toBeUndefined();
  });

  it("does nothing for non-existent key", async () => {
    await expect(idbDelete(STORE_CONTENT_CACHE, "missing")).resolves.toBeUndefined();
  });
});

describe("idbGetAll", () => {
  it("returns all values in a store", async () => {
    await idbPut(STORE_WOT_CACHE, "a", 1);
    await idbPut(STORE_WOT_CACHE, "b", 2);
    await idbPut(STORE_WOT_CACHE, "c", 3);
    const all = await idbGetAll<number>(STORE_WOT_CACHE);
    expect(all).toHaveLength(3);
    expect(all.sort()).toEqual([1, 2, 3]);
  });

  it("returns empty array for empty store", async () => {
    const all = await idbGetAll(STORE_WOT_CACHE);
    expect(all).toEqual([]);
  });
});

describe("idbClear", () => {
  it("removes all values from a store", async () => {
    await idbPut(STORE_SCORE_CACHE, "a", 1);
    await idbPut(STORE_SCORE_CACHE, "b", 2);
    await idbClear(STORE_SCORE_CACHE);
    expect(await idbGetAll(STORE_SCORE_CACHE)).toEqual([]);
  });

  it("does not affect other stores", async () => {
    await idbPut(STORE_SCORE_CACHE, "a", 1);
    await idbPut(STORE_DEDUP, "b", 2);
    await idbClear(STORE_SCORE_CACHE);
    expect(await idbGet(STORE_DEDUP, "b")).toBe(2);
  });
});

describe("idbPutBatch", () => {
  it("stores multiple entries in a single transaction", async () => {
    await idbPutBatch(STORE_DEDUP, [
      ["k1", "v1"],
      ["k2", "v2"],
      ["k3", "v3"],
    ]);
    expect(await idbGet(STORE_DEDUP, "k1")).toBe("v1");
    expect(await idbGet(STORE_DEDUP, "k2")).toBe("v2");
    expect(await idbGet(STORE_DEDUP, "k3")).toBe("v3");
  });

  it("handles empty batch without error", async () => {
    await expect(idbPutBatch(STORE_DEDUP, [])).resolves.toBeUndefined();
  });
});
