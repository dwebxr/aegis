/**
 * One-time migration from localStorage to IndexedDB for large caches.
 * Migrates: score-cache, dedup, content-cache, wot-cache.
 * Safe to call multiple times — uses a migration flag to skip if already done.
 */

import {
  isIDBAvailable,
  idbPut,
  STORE_SCORE_CACHE,
  STORE_DEDUP,
  STORE_CONTENT_CACHE,
  STORE_WOT_CACHE,
} from "./idb";

const MIGRATION_FLAG = "aegis-idb-migrated-v1";

interface MigrationMapping {
  lsKey: string;
  idbStore: string;
  idbKey: string;
}

const MIGRATIONS: MigrationMapping[] = [
  { lsKey: "aegis-score-cache", idbStore: STORE_SCORE_CACHE, idbKey: "data" },
  { lsKey: "aegis_article_dedup", idbStore: STORE_DEDUP, idbKey: "data" },
  { lsKey: "aegis-content-cache", idbStore: STORE_CONTENT_CACHE, idbKey: "items" },
  { lsKey: "aegis-wot-graph", idbStore: STORE_WOT_CACHE, idbKey: "graph" },
];

export async function migrateToIDB(): Promise<void> {
  if (typeof globalThis.localStorage === "undefined") return;
  if (!isIDBAvailable()) return;

  try {
    if (localStorage.getItem(MIGRATION_FLAG) === "1") return;
  } catch {
    return;
  }

  let migrated = 0;
  for (const { lsKey, idbStore, idbKey } of MIGRATIONS) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      await idbPut(idbStore, idbKey, parsed);
      localStorage.removeItem(lsKey);
      migrated++;
    } catch (err) {
      console.warn(`[migrate] Failed to migrate ${lsKey}:`, err);
    }
  }

  try {
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // Non-critical — migration will re-run next time but data is already in IDB
  }

  if (migrated > 0) {
    console.log(`[migrate] Migrated ${migrated} cache(s) from localStorage to IndexedDB`);
  }
}
