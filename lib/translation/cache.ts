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

// Best-effort localStorage.removeItem that swallows SecurityError from
// Safari private mode / Storage Access API denials. Used by the
// corruption-recovery paths below.
function safeRemove(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch (err) {
    console.debug("[translation-cache] removeItem denied:", err instanceof Error ? err.message : err);
  }
}

// localStorage contents are tamper-able (user devtools, schema
// migrations, mid-write truncation). Verify the parsed value is
// actually a record of `{ result, expiresAt }` entries before
// trusting it — otherwise downstream crashes on `Object.keys` or
// `store[key].expiresAt`.
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

// Returns `{}` on SSR (no localStorage), Safari private-mode getItem
// throws, invalid JSON, or wrong shape. On corruption the blob is
// cleared so we don't re-parse on every read.
function loadStore(): CacheStore {
  if (typeof globalThis.localStorage === "undefined") return {};
  let raw: string | null;
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch (err) {
    // Expected in Safari private mode — keep at debug so it doesn't
    // spam the console on every lookup.
    console.debug("[translation-cache] getItem denied:", err instanceof Error ? err.message : err);
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Corrupt JSON is a genuine anomaly (mid-write truncation, user
    // tamper, schema migration bug) — surface at warn so devs see it.
    console.warn("[translation-cache] corrupt JSON, clearing blob:", err instanceof Error ? err.message : err);
    safeRemove();
    return {};
  }
  if (!isCacheStoreShape(parsed)) {
    // Wrong shape is also a genuine anomaly — either old schema or
    // tampered data. Warn-level so it's visible by default.
    console.warn("[translation-cache] wrong shape, clearing blob");
    safeRemove();
    return {};
  }
  return parsed;
}

// On QuotaExceededError (Safari private mode), halve the store
// (keeping latest-expiring entries) and retry. If the retry also
// fails, drop the blob entirely so subsequent reads start clean
// instead of re-hitting the quota boundary. Cache persistence is
// best-effort — translation re-runs on the next lookup.
function saveStore(store: CacheStore): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    return;
  } catch (err) {
    console.debug(
      "[translation-cache] setItem failed, halving and retrying:",
      err instanceof Error ? err.message : err,
    );
    const entries = Object.entries(store).sort(
      ([, a], [, b]) => b.expiresAt - a.expiresAt,
    );
    const halved: CacheStore = {};
    for (const [k, v] of entries.slice(0, Math.floor(entries.length / 2))) {
      halved[k] = v;
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(halved));
    } catch (retryErr) {
      // Halved retry failing means the user's localStorage is
      // essentially full and cache persistence is unrecoverable for
      // this session. Warn-level so the anomaly is visible.
      console.warn(
        "[translation-cache] halved retry also failed, clearing blob:",
        retryErr instanceof Error ? retryErr.message : retryErr,
      );
      safeRemove();
    }
  }
}

// Never throws — crypto.subtle failure, corrupt store, or any other
// unexpected error falls back to "not cached" so the caller recomputes.
export async function lookupTranslation(text: string, targetLang: string): Promise<TranslationResult | null> {
  let hash: string;
  try {
    hash = await computeHash(text);
  } catch (err) {
    console.debug("[translation-cache] computeHash failed on lookup:", err instanceof Error ? err.message : err);
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

// Never throws — a transient cache problem must not tank a successful
// translation result.
export async function storeTranslation(text: string, result: TranslationResult): Promise<void> {
  let hash: string;
  try {
    hash = await computeHash(text);
  } catch (err) {
    console.debug("[translation-cache] computeHash failed on store:", err instanceof Error ? err.message : err);
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
