import type { TranslationResult } from "./types";

const LS_KEY = "aegis-translation-cache";
const MAX_ENTRIES = 200;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: TranslationResult;
  expiresAt: number;
}

type CacheStore = Record<string, CacheEntry>;

function cacheKey(textHash: string, targetLang: string): string {
  return `${targetLang}:${textHash}`;
}

async function computeHash(text: string): Promise<string> {
  const slice = text.slice(0, 500);
  const data = new TextEncoder().encode(slice);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Runtime validator for a parsed cache store. localStorage contents are
 * attacker-influenced (or at least tamper-able by the user), and
 * schema migrations can leave stale shapes behind. Verify the parsed
 * value is actually a flat record of `{ result, expiresAt }` entries
 * before trusting it — a malformed store must be ignored, not
 * propagated into downstream code that would crash on `Object.keys`
 * or `store[key].expiresAt`.
 */
function isCacheStoreShape(value: unknown): value is CacheStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.expiresAt !== "number") return false;
    if (!e.result || typeof e.result !== "object") return false;
    const r = e.result as Record<string, unknown>;
    if (typeof r.translatedText !== "string") return false;
    if (typeof r.targetLanguage !== "string") return false;
    if (typeof r.backend !== "string") return false;
    if (typeof r.generatedAt !== "number") return false;
  }
  return true;
}

/**
 * Read the store from localStorage, tolerating three failure modes that
 * each collapse to "treat the cache as empty":
 *
 *   1. SSR / Node — `localStorage` is undefined.
 *   2. Transient access errors — Safari private mode or Storage
 *      Access API denial can make even `getItem` throw.
 *   3. Corrupt or wrong-shape data — mid-write truncation, schema
 *      migration, user-tampered blob. JSON.parse throws or the shape
 *      validator rejects.
 *
 * Returning `{}` on any of those is always safe — the caller will
 * recompute the translation and `saveStore` will overwrite the blob
 * with a fresh, well-formed store on the next write.
 */
function loadStore(): CacheStore {
  if (typeof globalThis.localStorage === "undefined") return {};
  let raw: string | null;
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt blob — clear it so we don't re-parse on every call.
    try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ }
    return {};
  }
  if (!isCacheStoreShape(parsed)) {
    try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ }
    return {};
  }
  return parsed;
}

/**
 * Write the store with graceful degradation on QuotaExceededError.
 * Safari private mode exposes localStorage but `setItem` throws the
 * moment the (very small) quota is hit. Halving the store and
 * retrying covers the common case where the user has accumulated
 * many small caches across the app and only this one overflowed.
 * If the retry also fails we give up — cache persistence is
 * best-effort and translation will just recompute next time.
 */
function saveStore(store: CacheStore): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    return;
  } catch {
    // Drop half the entries (keeping those that expire latest) and retry.
    const entries = Object.entries(store).sort(
      ([, a], [, b]) => b.expiresAt - a.expiresAt,
    );
    const halved: CacheStore = {};
    for (const [k, v] of entries.slice(0, Math.floor(entries.length / 2))) {
      halved[k] = v;
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(halved));
    } catch {
      // Still no room — drop the blob entirely so future reads start
      // clean instead of re-hitting the quota boundary.
      try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ }
    }
  }
}

/**
 * Look up a cached translation. Never throws — a crypto.subtle
 * failure, a corrupt store, or any other unexpected error falls back
 * to "not cached" so the caller recomputes.
 */
export async function lookupTranslation(text: string, targetLang: string): Promise<TranslationResult | null> {
  let hash: string;
  try {
    hash = await computeHash(text);
  } catch {
    return null;
  }
  const key = cacheKey(hash, targetLang);
  const store = loadStore();
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete store[key];
    saveStore(store);
    return null;
  }
  return entry.result;
}

/**
 * Persist a successful translation. Never throws — a hash failure,
 * quota exceeded, or any other unexpected error is silently tolerated
 * so a transient cache problem doesn't tank the user's translation
 * result (which succeeded before this call).
 */
export async function storeTranslation(text: string, result: TranslationResult): Promise<void> {
  let hash: string;
  try {
    hash = await computeHash(text);
  } catch {
    return;
  }
  const key = cacheKey(hash, result.targetLanguage);
  const store = loadStore();

  store[key] = { result, expiresAt: Date.now() + TTL_MS };

  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => store[a].expiresAt - store[b].expiresAt);
    const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const k of toRemove) delete store[k];
  }

  saveStore(store);
}

/** Test seam — clears the cache from localStorage. */
export function _clearTranslationCache(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ }
}
