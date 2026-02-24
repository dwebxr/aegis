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

const STORAGE_KEY = "aegis-score-cache";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 500;

interface ScoringCacheEntry {
  result: AnalyzeResponse;
  storedAt: number;
  profileHash: string;
}

// In-memory stats (not persisted)
let cacheHits = 0;
let cacheMisses = 0;

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize text and compute SHA-256 fingerprint (first 16 bytes as hex). Same as ArticleDeduplicator. */
function computeContentFingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const hash = sha256(new TextEncoder().encode(normalized));
  return hexFromBytes(hash.slice(0, 16));
}

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

// In-memory layer: avoids repeated JSON.parse per scoring call.
let _memCache: Record<string, ScoringCacheEntry> | null = null;

function getCache(): Record<string, ScoringCacheEntry> {
  if (_memCache) return _memCache;
  if (typeof globalThis.localStorage === "undefined") {
    _memCache = {};
    return _memCache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { _memCache = {}; return _memCache; }
    const parsed = JSON.parse(raw);
    _memCache = (parsed && typeof parsed === "object") ? parsed as Record<string, ScoringCacheEntry> : {};
  } catch {
    _memCache = {};
  }
  return _memCache;
}

function flushCache(): void {
  if (typeof globalThis.localStorage === "undefined" || !_memCache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_memCache));
  } catch {
    // QuotaExceededError — silently degrade
  }
}

/** Look up a cached scoring result. Returns null on miss or expired entry. */
export function lookupScoringCache(key: string, profileHash: string): AnalyzeResponse | null {
  const cache = getCache();
  const entry = cache[key];
  if (!entry || entry.profileHash !== profileHash) {
    cacheMisses++;
    return null;
  }
  if (Date.now() - entry.storedAt > TTL_MS) {
    delete cache[key];
    flushCache();
    cacheMisses++;
    return null;
  }
  cacheHits++;
  return entry.result;
}

/** Store a scoring result in the cache. */
export function storeScoringCache(key: string, profileHash: string, result: AnalyzeResponse): void {
  const cache = getCache();
  cache[key] = { result, storedAt: Date.now(), profileHash };

  // FIFO pruning
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => (cache[a].storedAt || 0) - (cache[b].storedAt || 0));
    const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const k of toRemove) delete cache[k];
  }

  flushCache();
}

/** Get cache stats for diagnostics. */
export function getScoringCacheStats(): { hits: number; misses: number; size: number } {
  return { hits: cacheHits, misses: cacheMisses, size: Object.keys(getCache()).length };
}

/** Clear the entire scoring cache. */
export function clearScoringCache(): void {
  _memCache = {};
  if (typeof globalThis.localStorage !== "undefined") {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  cacheHits = 0;
  cacheMisses = 0;
}
