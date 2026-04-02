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

function loadStore(): CacheStore {
  if (typeof globalThis.localStorage === "undefined") return {};
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as CacheStore;
}

function saveStore(store: CacheStore): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

export async function lookupTranslation(text: string, targetLang: string): Promise<TranslationResult | null> {
  const hash = await computeHash(text);
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

export async function storeTranslation(text: string, result: TranslationResult): Promise<void> {
  const hash = await computeHash(text);
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
