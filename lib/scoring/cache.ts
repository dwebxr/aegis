/**
 * Scoring result cache backed by localStorage.
 * Avoids redundant AI API calls for identical content + profile combos.
 *
 * Key = SHA-256(normalized text first 500 chars) + profileHash
 * TTL = 24 hours, FIFO pruning at MAX_ENTRIES.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { hexFromBytes, computeContentFingerprint } from "@/lib/utils/hashing";

const STORAGE_KEY = "aegis-score-cache";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 500;

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

function isValidEntry(v: unknown): v is ScoringCacheEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.storedAt === "number"
    && typeof e.profileHash === "string"
    && e.result != null && typeof e.result === "object";
}

function getCache(): Map<string, ScoringCacheEntry> {
  if (_memCache) return _memCache;
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const validated = new Map<string, ScoringCacheEntry>();
          let dropped = 0;
          for (const [k, v] of Object.entries(parsed)) {
            if (isValidEntry(v)) {
              validated.set(k, v);
            } else {
              dropped++;
            }
          }
          if (dropped > 0) console.warn(`[scoring-cache] Dropped ${dropped} corrupt entries on load`);
          return (_memCache = validated);
        }
      }
    } catch (err) {
      console.warn("[scoring-cache] localStorage parse failed, starting fresh:", err);
    }
  }
  return (_memCache = new Map());
}

function flushCache(): void {
  if (typeof globalThis.localStorage === "undefined" || !_memCache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(_memCache)));
  } catch (err) {
    console.warn("[scoring-cache] flushCache failed (quota?):", err);
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
    flushCache();
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

  flushCache();
}

export function getScoringCacheStats(): { hits: number; misses: number; size: number } {
  return { hits: cacheHits, misses: cacheMisses, size: getCache().size };
}

export function clearScoringCache(): void {
  _memCache = new Map();
  if (typeof globalThis.localStorage !== "undefined") {
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { console.warn("[scoring-cache] clear failed:", err); }
  }
  cacheHits = 0;
  cacheMisses = 0;
}
