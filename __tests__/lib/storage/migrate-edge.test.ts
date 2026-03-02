/**
 * @jest-environment jsdom
 */
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import { migrateToIDB } from "@/lib/storage/migrate";
import { idbGet, idbClear, _resetDB, STORE_SCORE_CACHE, STORE_DEDUP, STORE_CONTENT_CACHE, STORE_WOT_CACHE } from "@/lib/storage/idb";

const MIGRATION_FLAG = "aegis-idb-migrated-v1";

beforeEach(async () => {
  _resetDB();
  await idbClear(STORE_SCORE_CACHE);
  await idbClear(STORE_DEDUP);
  await idbClear(STORE_CONTENT_CACHE);
  await idbClear(STORE_WOT_CACHE);
  localStorage.clear();
});

describe("migrateToIDB — error handling", () => {
  it("handles corrupted JSON in score-cache gracefully", async () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    localStorage.setItem("aegis-score-cache", "not valid json{{{");
    localStorage.setItem("aegis_article_dedup", JSON.stringify({ urls: ["u1"] }));

    await migrateToIDB();

    // Corrupted score-cache should be skipped
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toBeUndefined();
    // Valid dedup should still be migrated
    expect(await idbGet(STORE_DEDUP, "data")).toEqual({ urls: ["u1"] });
    // Migration flag should still be set
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
    spy.mockRestore();
  });

  it("handles corrupted JSON in dedup gracefully", async () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    localStorage.setItem("aegis_article_dedup", "{broken json");
    await migrateToIDB();
    expect(await idbGet(STORE_DEDUP, "data")).toBeUndefined();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
    spy.mockRestore();
  });

  it("handles corrupted JSON in all keys without crashing", async () => {
    const spy = jest.spyOn(console, "warn").mockImplementation();
    localStorage.setItem("aegis-score-cache", "BAD");
    localStorage.setItem("aegis_article_dedup", "BAD");
    localStorage.setItem("aegis-content-cache", "BAD");
    localStorage.setItem("aegis-wot-graph", "BAD");

    await migrateToIDB();

    expect(await idbGet(STORE_SCORE_CACHE, "data")).toBeUndefined();
    expect(await idbGet(STORE_DEDUP, "data")).toBeUndefined();
    expect(await idbGet(STORE_CONTENT_CACHE, "items")).toBeUndefined();
    expect(await idbGet(STORE_WOT_CACHE, "graph")).toBeUndefined();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
    spy.mockRestore();
  });
});

describe("migrateToIDB — idempotency", () => {
  it("does not re-migrate if flag is set", async () => {
    const data = { k: "v" };
    localStorage.setItem("aegis-score-cache", JSON.stringify(data));
    await migrateToIDB();
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toEqual(data);

    // Clear IDB, set flag, add new data — should NOT migrate
    await idbClear(STORE_SCORE_CACHE);
    localStorage.setItem("aegis-score-cache", JSON.stringify({ new: "data" }));
    await migrateToIDB();
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toBeUndefined();
  });

  it("calling twice without flag still only migrates once (flag set on first call)", async () => {
    localStorage.setItem("aegis-score-cache", JSON.stringify({ a: 1 }));
    await migrateToIDB();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");

    // Second call is a no-op
    await idbClear(STORE_SCORE_CACHE);
    await migrateToIDB();
    expect(await idbGet(STORE_SCORE_CACHE, "data")).toBeUndefined();
  });
});

describe("migrateToIDB — data types", () => {
  it("migrates complex nested content-cache data", async () => {
    const items = [
      { id: "1", text: "Hello", scores: { composite: 7 }, topics: ["ai", "ml"] },
      { id: "2", text: "World", scores: { composite: 3 }, topics: [] },
    ];
    localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    await migrateToIDB();
    const stored = await idbGet(STORE_CONTENT_CACHE, "items");
    expect(stored).toEqual(items);
  });

  it("migrates wot-cache with Map-serialized nodes", async () => {
    const graph = {
      graph: {
        userPubkey: "pk",
        nodes: [["a", { hopDistance: 1 }], ["b", { hopDistance: 2 }]],
        maxHops: 3,
        builtAt: 1000,
      },
      cachedAt: Date.now(),
      ttl: 3600000,
    };
    localStorage.setItem("aegis-wot-graph", JSON.stringify(graph));
    await migrateToIDB();
    expect(await idbGet(STORE_WOT_CACHE, "graph")).toEqual(graph);
  });

  it("removes localStorage keys after successful migration", async () => {
    localStorage.setItem("aegis-score-cache", JSON.stringify({ k: 1 }));
    localStorage.setItem("aegis_article_dedup", JSON.stringify({ urls: [] }));
    localStorage.setItem("aegis-content-cache", JSON.stringify([]));
    localStorage.setItem("aegis-wot-graph", JSON.stringify({ g: 1 }));

    await migrateToIDB();

    expect(localStorage.getItem("aegis-score-cache")).toBeNull();
    expect(localStorage.getItem("aegis_article_dedup")).toBeNull();
    expect(localStorage.getItem("aegis-content-cache")).toBeNull();
    expect(localStorage.getItem("aegis-wot-graph")).toBeNull();
  });
});

describe("migrateToIDB — partial migration", () => {
  it("migrates only keys that have data", async () => {
    // Only score-cache has data
    localStorage.setItem("aegis-score-cache", JSON.stringify({ x: 1 }));
    await migrateToIDB();

    expect(await idbGet(STORE_SCORE_CACHE, "data")).toEqual({ x: 1 });
    expect(await idbGet(STORE_DEDUP, "data")).toBeUndefined();
    expect(await idbGet(STORE_CONTENT_CACHE, "items")).toBeUndefined();
    expect(await idbGet(STORE_WOT_CACHE, "graph")).toBeUndefined();
  });
});

describe("migrateToIDB — logging", () => {
  it("logs migration count when items are migrated", async () => {
    const spy = jest.spyOn(console, "log").mockImplementation();
    localStorage.setItem("aegis-score-cache", JSON.stringify({ k: 1 }));
    localStorage.setItem("aegis_article_dedup", JSON.stringify({ urls: [] }));

    await migrateToIDB();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Migrated 2 cache(s)"));
    spy.mockRestore();
  });

  it("does not log when no items to migrate", async () => {
    const spy = jest.spyOn(console, "log").mockImplementation();
    await migrateToIDB();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("Migrated"));
    spy.mockRestore();
  });
});
