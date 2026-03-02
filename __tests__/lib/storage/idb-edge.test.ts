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
} from "@/lib/storage/idb";

beforeEach(async () => {
  _resetDB();
  await idbClear(STORE_SCORE_CACHE);
  await idbClear(STORE_DEDUP);
});

describe("idb — complex value types", () => {
  it("stores and retrieves nested objects", async () => {
    const value = { a: { b: { c: [1, 2, 3] } }, d: null };
    await idbPut(STORE_SCORE_CACHE, "nested", value);
    const result = await idbGet(STORE_SCORE_CACHE, "nested");
    expect(result).toEqual(value);
  });

  it("stores and retrieves arrays", async () => {
    const arr = [1, "two", { three: 3 }, [4]];
    await idbPut(STORE_DEDUP, "arr", arr);
    expect(await idbGet(STORE_DEDUP, "arr")).toEqual(arr);
  });

  it("stores boolean values", async () => {
    await idbPut(STORE_DEDUP, "bool-true", true);
    await idbPut(STORE_DEDUP, "bool-false", false);
    expect(await idbGet(STORE_DEDUP, "bool-true")).toBe(true);
    expect(await idbGet(STORE_DEDUP, "bool-false")).toBe(false);
  });

  it("stores null values", async () => {
    await idbPut(STORE_DEDUP, "null-val", null);
    expect(await idbGet(STORE_DEDUP, "null-val")).toBeNull();
  });

  it("stores large string values", async () => {
    const largeStr = "x".repeat(100_000);
    await idbPut(STORE_DEDUP, "large", largeStr);
    expect(await idbGet(STORE_DEDUP, "large")).toBe(largeStr);
  });
});

describe("idb — key edge cases", () => {
  it("handles empty string key", async () => {
    await idbPut(STORE_DEDUP, "", "empty-key-value");
    expect(await idbGet(STORE_DEDUP, "")).toBe("empty-key-value");
  });

  it("handles keys with special characters", async () => {
    const key = "key:with/special?chars#and&more=stuff";
    await idbPut(STORE_DEDUP, key, "special");
    expect(await idbGet(STORE_DEDUP, key)).toBe("special");
  });

  it("handles very long keys", async () => {
    const key = "k".repeat(1000);
    await idbPut(STORE_DEDUP, key, "long-key");
    expect(await idbGet(STORE_DEDUP, key)).toBe("long-key");
  });
});

describe("idbPutBatch — edge cases", () => {
  it("overwrites existing keys in batch", async () => {
    await idbPut(STORE_DEDUP, "k1", "old1");
    await idbPut(STORE_DEDUP, "k2", "old2");
    await idbPutBatch(STORE_DEDUP, [
      ["k1", "new1"],
      ["k2", "new2"],
    ]);
    expect(await idbGet(STORE_DEDUP, "k1")).toBe("new1");
    expect(await idbGet(STORE_DEDUP, "k2")).toBe("new2");
  });

  it("handles large batch (100 entries)", async () => {
    const entries: [string, number][] = Array.from({ length: 100 }, (_, i) => [`batch-${i}`, i]);
    await idbPutBatch(STORE_DEDUP, entries);
    const all = await idbGetAll<number>(STORE_DEDUP);
    expect(all).toHaveLength(100);
    expect(await idbGet(STORE_DEDUP, "batch-0")).toBe(0);
    expect(await idbGet(STORE_DEDUP, "batch-99")).toBe(99);
  });

  it("duplicate keys in batch — last write wins", async () => {
    await idbPutBatch(STORE_DEDUP, [
      ["dup", "first"],
      ["dup", "second"],
      ["dup", "third"],
    ]);
    expect(await idbGet(STORE_DEDUP, "dup")).toBe("third");
  });
});

describe("idbClear — edge cases", () => {
  it("clearing already empty store is a no-op", async () => {
    await expect(idbClear(STORE_DEDUP)).resolves.toBeUndefined();
    expect(await idbGetAll(STORE_DEDUP)).toEqual([]);
  });
});

describe("idbDelete — edge cases", () => {
  it("deleting from store with other keys does not affect them", async () => {
    await idbPut(STORE_DEDUP, "keep", "value");
    await idbPut(STORE_DEDUP, "remove", "value");
    await idbDelete(STORE_DEDUP, "remove");
    expect(await idbGet(STORE_DEDUP, "keep")).toBe("value");
    expect(await idbGet(STORE_DEDUP, "remove")).toBeUndefined();
  });
});

describe("getDB — connection caching after reset", () => {
  it("returns fresh connection after _resetDB", async () => {
    const db1 = await getDB();
    _resetDB();
    const db2 = await getDB();
    // Both should be valid IDBDatabase instances
    expect(db1.name).toBe("aegis-storage");
    expect(db2.name).toBe("aegis-storage");
  });
});

describe("isIDBAvailable", () => {
  it("returns boolean", () => {
    const result = isIDBAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("idbGetAll — ordering", () => {
  it("returns all values regardless of insertion order", async () => {
    await idbPut(STORE_DEDUP, "c", 3);
    await idbPut(STORE_DEDUP, "a", 1);
    await idbPut(STORE_DEDUP, "b", 2);
    const all = await idbGetAll<number>(STORE_DEDUP);
    expect(all.sort()).toEqual([1, 2, 3]);
  });
});
