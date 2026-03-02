/**
 * Generic IndexedDB utility for Aegis.
 * Single database "aegis-storage" with multiple object stores.
 * Cached connection to avoid repeated open() calls.
 */

const DB_NAME = "aegis-storage";
const DB_VERSION = 1;

export const STORE_SCORE_CACHE = "score-cache";
export const STORE_DEDUP = "dedup";
export const STORE_CONTENT_CACHE = "content-cache";
export const STORE_WOT_CACHE = "wot-cache";

const ALL_STORES = [STORE_SCORE_CACHE, STORE_DEDUP, STORE_CONTENT_CACHE, STORE_WOT_CACHE];

let _dbPromise: Promise<IDBDatabase> | null = null;

export function isIDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function getDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      _dbPromise = null;
      reject(request.error);
    };
  });
  return _dbPromise;
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await getDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbPut<T>(store: string, key: string, value: T): Promise<void> {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await getDB();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear(store: string): Promise<void> {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbPutBatch<T>(store: string, entries: [string, T][]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const [key, value] of entries) {
      os.put(value, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Reset cached connection (for testing). */
export function _resetDB(): void {
  _dbPromise = null;
}
