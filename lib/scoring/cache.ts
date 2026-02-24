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

/** Compute the full cache key combining content fingerprint and profile hash. */
export function computeScoringCacheKey(text: string, userContext?: UserContext | null): string {
  return `${computeContentFingerprint(text)}:${computeProfileHash(userContext)}`;
}

function loadCache(): Record<string, ScoringCacheEntry> {
  if (typeof globalThis.localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ScoringCacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, ScoringCacheEntry>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // QuotaExceededError — silently degrade
  }
}

/** Look up a cached scoring result. Returns null on miss or expired entry. */
export function lookupScoringCache(key: string, profileHash: string): AnalyzeResponse | null {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) {
    cacheMisses++;
    return null;
  }
  if (entry.profileHash !== profileHash) {
    cacheMisses++;
    return null;
  }
  if (Date.now() - entry.storedAt > TTL_MS) {
    // Expired — clean up
    delete cache[key];
    saveCache(cache);
    cacheMisses++;
    return null;
  }
  cacheHits++;
  return entry.result;
}

/** Store a scoring result in the cache. */
export function storeScoringCache(key: string, profileHash: string, result: AnalyzeResponse): void {
  const cache = loadCache();
  cache[key] = { result, storedAt: Date.now(), profileHash };

  // FIFO pruning
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    // Sort by storedAt ascending and remove oldest
    const sorted = keys.sort((a, b) => (cache[a].storedAt || 0) - (cache[b].storedAt || 0));
    const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const k of toRemove) delete cache[k];
  }

  saveCache(cache);
}

/** Get cache stats for diagnostics. */
export function getScoringCacheStats(): { hits: number; misses: number; size: number } {
  const cache = loadCache();
  return { hits: cacheHits, misses: cacheMisses, size: Object.keys(cache).length };
}

/** Clear the entire scoring cache. */
export function clearScoringCache(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  cacheHits = 0;
  cacheMisses = 0;
}
