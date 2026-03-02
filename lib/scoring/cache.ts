/**
 * Scoring result cache backed by IndexedDB (with localStorage fallback).
 * Avoids redundant AI API calls for identical content + profile combos.
 *
 * Key = SHA-256(normalized text first 500 chars) + profileHash
 * TTL = 24 hours, FIFO pruning at MAX_ENTRIES.
 *
 * Reads are synchronous (from in-memory cache).
 * Writes are debounced and flushed to IDB asynchronously.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { hexFromBytes, computeContentFingerprint } from "@/lib/utils/hashing";
import { isIDBAvailable, idbGet, idbPut, STORE_SCORE_CACHE } from "@/lib/storage/idb";

const STORAGE_KEY = "aegis-score-cache";
const IDB_KEY = "data";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 500;
const FLUSH_DEBOUNCE_MS = 500;

interface ScoringCacheEntry {
  result: AnalyzeResponse;
  storedAt: number;
  profileHash: string;
}

let cacheHits = 0;
let cacheMisses = 0;

/** Compute a short hash of the user context to detect profile changes. */
export function computeProfileHash(userContext?: UserContext | null): string {
  if (!userContext) return "none";
  const parts = [
    ...(userContext.highAffinityTopics || []).sort(),
    "|",
    ...(userContext.recentTopics || []).sort(),
  ].join(",");
  const hash = sha256(new TextEncoder().encode(parts));
  return hexFromBytes(hash.slice(0, 8));
}

/** Compute the full cache key. Accepts optional pre-computed profileHash to avoid double hashing. */
export function computeScoringCacheKey(text: string, userContext?: UserContext | null, precomputedHash?: string): string {
  const ph = precomputedHash ?? computeProfileHash(userContext);
  return `${computeContentFingerprint(text)}:${ph}`;
}

let _memCache: Map<string, ScoringCacheEntry> | null = null;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _useIDB = false;

function isValidEntry(v: unknown): v is ScoringCacheEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.storedAt === "number"
    && typeof e.profileHash === "string"
    && e.result != null && typeof e.result === "object";
}

function parseEntries(parsed: unknown): Map<string, ScoringCacheEntry> {
  const validated = new Map<string, ScoringCacheEntry>();
  if (!parsed || typeof parsed !== "object") return validated;
  let dropped = 0;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValidEntry(v)) {
      validated.set(k, v);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) console.warn(`[scoring-cache] Dropped ${dropped} corrupt entries on load`);
  return validated;
}

/** Initialize the scoring cache from IDB (preferred) or localStorage (fallback). */
export async function initScoringCache(): Promise<void> {
  if (_memCache) return; // already initialized

  if (isIDBAvailable()) {
    try {
      const data = await idbGet<Record<string, unknown>>(STORE_SCORE_CACHE, IDB_KEY);
      if (data) {
        _memCache = parseEntries(data);
        _useIDB = true;
        return;
      }
    } catch (err) {
      console.warn("[scoring-cache] IDB load failed, falling back to localStorage:", err);
    }
  }

  // Fallback: load from localStorage
  _useIDB = false;
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        _memCache = parseEntries(JSON.parse(raw));
        return;
      }
    } catch (err) {
      console.warn("[scoring-cache] localStorage parse failed, starting fresh:", err);
    }
  }
  _memCache = new Map();
}

function getCache(): Map<string, ScoringCacheEntry> {
  if (_memCache) return _memCache;
  // Synchronous fallback for pre-init access
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return (_memCache = parseEntries(JSON.parse(raw)));
      }
    } catch {
      // ignore
    }
  }
  return (_memCache = new Map());
}

function scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushCacheAsync();
  }, FLUSH_DEBOUNCE_MS);
}

function flushCacheAsync(): void {
  if (!_memCache) return;
  const data = Object.fromEntries(_memCache);

  if (_useIDB) {
    idbPut(STORE_SCORE_CACHE, IDB_KEY, data).catch(err => {
      console.warn("[scoring-cache] IDB flush failed:", err);
    });
  } else if (typeof globalThis.localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("[scoring-cache] localStorage flush failed (quota?):", err);
    }
  }
}

/** Look up a cached scoring result. Returns null on miss or expired entry. */
export function lookupScoringCache(key: string, profileHash: string): AnalyzeResponse | null {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry || entry.profileHash !== profileHash) {
    cacheMisses++;
    return null;
  }
  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(key);
    scheduleFlush();
    cacheMisses++;
    return null;
  }
  cacheHits++;
  return entry.result;
}

export function storeScoringCache(key: string, profileHash: string, result: AnalyzeResponse): void {
  const cache = getCache();
  cache.set(key, { result, storedAt: Date.now(), profileHash });

  // Map preserves insertion order — FIFO prune oldest entries in O(excess)
  if (cache.size > MAX_ENTRIES) {
    const excess = cache.size - MAX_ENTRIES;
    const iter = cache.keys();
    for (let i = 0; i < excess; i++) {
      const oldest = iter.next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  scheduleFlush();
}

export function getScoringCacheStats(): { hits: number; misses: number; size: number } {
  return { hits: cacheHits, misses: cacheMisses, size: getCache().size };
}

export function clearScoringCache(): void {
  _memCache = new Map();
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_useIDB) {
    idbPut(STORE_SCORE_CACHE, IDB_KEY, {}).catch(() => {});
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  cacheHits = 0;
  cacheMisses = 0;
}

/** Reset internal state (for testing). */
export function _resetScoringCache(): void {
  _memCache = null;
  _useIDB = false;
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  cacheHits = 0;
  cacheMisses = 0;
}
