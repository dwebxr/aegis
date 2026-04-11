/**
 * @jest-environment jsdom
 */
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import { migrateToIDB } from "@/lib/storage/migrate";
import * as idb from "@/lib/storage/idb";

describe("migrateToIDB — environment guards", () => {
  beforeEach(async () => {
    idb._resetDB();
    await idb.idbClear(idb.STORE_SCORE_CACHE);
    await idb.idbClear(idb.STORE_DEDUP);
    await idb.idbClear(idb.STORE_CONTENT_CACHE);
    await idb.idbClear(idb.STORE_WOT_CACHE);
    localStorage.clear();
  });

  it("returns without touching IDB when localStorage is missing", async () => {
    expect(await idb.idbGet(idb.STORE_SCORE_CACHE, "data")).toBeUndefined();

    const ls = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
    try {
      await migrateToIDB();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    }
    expect(await idb.idbGet(idb.STORE_SCORE_CACHE, "data")).toBeUndefined();
    expect(localStorage.getItem("aegis-idb-migrated-v1")).toBeNull();
  });

  it("returns without migrating when IDB is unavailable", async () => {
    const spy = jest.spyOn(idb, "isIDBAvailable").mockReturnValue(false);
    localStorage.setItem("aegis-score-cache", JSON.stringify({ k: 1 }));
    await migrateToIDB();
    expect(localStorage.getItem("aegis-idb-migrated-v1")).toBeNull();
    expect(localStorage.getItem("aegis-score-cache")).toBe(JSON.stringify({ k: 1 }));
    expect(await idb.idbGet(idb.STORE_SCORE_CACHE, "data")).toBeUndefined();
    spy.mockRestore();
  });

  it("returns without migrating if reading the migration flag throws", async () => {
    localStorage.setItem("aegis-score-cache", JSON.stringify({ x: 99 }));

    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "aegis-idb-migrated-v1") throw new Error("blocked");
      return original.call(this, key);
    };
    try {
      await migrateToIDB();
    } finally {
      Storage.prototype.getItem = original;
    }
    expect(localStorage.getItem("aegis-score-cache")).toBe(JSON.stringify({ x: 99 }));
    expect(await idb.idbGet(idb.STORE_SCORE_CACHE, "data")).toBeUndefined();
  });

  it("still migrates data even if persisting the migration flag throws", async () => {
    const originalSet = Storage.prototype.setItem;
    let setItemFailed = false;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "aegis-idb-migrated-v1") {
        setItemFailed = true;
        throw new Error("quota exceeded");
      }
      return originalSet.call(this, key, value);
    };
    try {
      localStorage.setItem("aegis-score-cache", JSON.stringify({ k: 1 }));
      await migrateToIDB();
    } finally {
      Storage.prototype.setItem = originalSet;
    }
    expect(setItemFailed).toBe(true);
    expect(await idb.idbGet(idb.STORE_SCORE_CACHE, "data")).toEqual({ k: 1 });
    expect(localStorage.getItem("aegis-score-cache")).toBeNull();
    expect(localStorage.getItem("aegis-idb-migrated-v1")).toBeNull();
  });
});
