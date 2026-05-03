// Key = SHA-256(normalized text[0..500]) + profileHash. TTL 24h, FIFO at MAX_ENTRIES.
// Reads are sync (in-memory); writes are debounced and flushed to IDB async.

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
  if (typeof e.storedAt !== "number" || typeof e.profileHash !== "string") return false;
  if (!e.result || typeof e.result !== "object") return false;
  const r = e.result as Record<string, unknown>;
  return typeof r.originality === "number"
    && typeof r.insight === "number"
    && typeof r.credibility === "number"
    && typeof r.composite === "number"
    && (r.verdict === "quality" || r.verdict === "slop")
    && typeof r.reason === "string";
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

function loadFromLocalStorage(): Map<string, ScoringCacheEntry> {
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return parseEntries(JSON.parse(raw));
    } catch (err) {
      console.warn("[scoring-cache] localStorage parse failed:", err);
    }
  }
  return new Map();
}

export async function initScoringCache(): Promise<void> {
  if (_memCache) return;

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

  _useIDB = false;
  _memCache = loadFromLocalStorage();
}

function getCache(): Map<string, ScoringCacheEntry> {
  if (_memCache) return _memCache;
  return (_memCache = loadFromLocalStorage());
}

let _flushing = false;

function scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_flushing) {
      // A flush is already in progress; re-schedule so the latest data is persisted
      scheduleFlush();
      return;
    }
    _flushing = true;
    flushCache()
      .catch(err => { console.warn("[scoring-cache] Scheduled flush failed:", err); })
      .finally(() => { _flushing = false; });
  }, FLUSH_DEBOUNCE_MS);
}

async function flushCache(): Promise<void> {
  if (!_memCache) return;
  const data = Object.fromEntries(_memCache);

  if (_useIDB) {
    try {
      await idbPut(STORE_SCORE_CACHE, IDB_KEY, data);
    } catch (err) {
      console.warn("[scoring-cache] IDB flush failed:", err);
    }
  } else if (typeof globalThis.localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("[scoring-cache] localStorage flush failed (quota?):", err);
    }
  }
}

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

export async function clearScoringCache(): Promise<void> {
  _memCache = new Map();
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_useIDB) {
    try {
      await idbPut(STORE_SCORE_CACHE, IDB_KEY, {});
    } catch (err) {
      console.warn("[scoring-cache] IDB clear failed:", err);
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { console.warn("[scoring-cache] Failed to clear localStorage:", err); }
  }
  cacheHits = 0;
  cacheMisses = 0;
}

export function _resetScoringCache(): void {
  _memCache = null;
  _useIDB = false;
  _flushing = false;
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  cacheHits = 0;
  cacheMisses = 0;
}
