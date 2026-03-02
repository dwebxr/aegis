/**
 * Article-level deduplication using URL + content fingerprint (SHA-256).
 * Persisted to IndexedDB (with localStorage fallback).
 * Prevents re-scoring identical articles across cycles.
 */

import { computeContentFingerprint } from "@/lib/utils/hashing";
import { isIDBAvailable, idbGet, idbPut, STORE_DEDUP } from "@/lib/storage/idb";

const STORAGE_KEY = "aegis_article_dedup";
const IDB_KEY = "data";
const MAX_ENTRIES = 2000;

interface DedupData {
  urls?: string[];
  fingerprints?: string[];
  order?: string[];
}

export class ArticleDeduplicator {
  private urls: Set<string>;
  private fingerprints: Set<string>;
  private insertionOrder: string[];
  private dirty = false;
  private useIDB = false;
  private initialized = false;

  constructor() {
    this.urls = new Set();
    this.fingerprints = new Set();
    this.insertionOrder = [];
  }

  /** Async initialization from IDB (preferred) or localStorage (fallback). Must be called before first use. */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (isIDBAvailable()) {
      try {
        const data = await idbGet<DedupData>(STORE_DEDUP, IDB_KEY);
        if (data) {
          this.loadFromData(data);
          this.useIDB = true;
          this.initialized = true;
          return;
        }
      } catch (err) {
        console.warn("[dedup] IDB load failed, falling back to localStorage:", err);
      }
    }

    // Fallback: localStorage
    this.loadFromLocalStorage();
    this.initialized = true;
  }

  isDuplicate(url: string | undefined, text: string): boolean {
    if (url && this.urls.has(url)) return true;
    const fp = this.computeFingerprint(text);
    return this.fingerprints.has(fp);
  }

  markSeen(url: string | undefined, text: string): void {
    const fp = this.computeFingerprint(text);
    if (url) {
      this.urls.add(url);
      this.insertionOrder.push(`u:${url}`);
    }
    this.fingerprints.add(fp);
    this.insertionOrder.push(`f:${fp}`);
    this.prune();
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const data: DedupData = {
      urls: Array.from(this.urls),
      fingerprints: Array.from(this.fingerprints),
      order: this.insertionOrder,
    };

    if (this.useIDB) {
      try {
        await idbPut(STORE_DEDUP, IDB_KEY, data);
        this.dirty = false;
        return;
      } catch (err) {
        console.warn("[dedup] IDB flush failed, falling back to localStorage:", err);
      }
    }

    this.saveToLocalStorage(data);
    this.dirty = false;
  }

  computeFingerprint(text: string): string {
    return computeContentFingerprint(text);
  }

  async reset(): Promise<void> {
    this.urls.clear();
    this.fingerprints.clear();
    this.insertionOrder = [];
    this.dirty = true;
    await this.flush();
  }

  get size(): number {
    return this.urls.size + this.fingerprints.size;
  }

  private prune(): void {
    while (this.insertionOrder.length > MAX_ENTRIES) {
      const oldest = this.insertionOrder.shift()!;
      if (oldest.startsWith("u:")) {
        this.urls.delete(oldest.slice(2));
      } else if (oldest.startsWith("f:")) {
        this.fingerprints.delete(oldest.slice(2));
      }
    }
  }

  private loadFromData(data: DedupData): void {
    if (data.urls) data.urls.forEach(u => this.urls.add(u));
    if (data.fingerprints) data.fingerprints.forEach(f => this.fingerprints.add(f));
    if (data.order) this.insertionOrder = data.order;
  }

  private loadFromLocalStorage(): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as DedupData;
      this.loadFromData(data);
    } catch (err) {
      console.warn("[dedup] Corrupted localStorage data, starting fresh:", err);
    }
  }

  private saveToLocalStorage(data: DedupData): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("[dedup] Failed to persist dedup state:", err);
    }
  }
}
