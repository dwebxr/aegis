/**
 * Article-level deduplication using URL + content fingerprint (SHA-256).
 * Persisted to localStorage. Prevents re-scoring identical articles across cycles.
 */

import { sha256 } from "@noble/hashes/sha2.js";

const STORAGE_KEY = "aegis_article_dedup";
const MAX_ENTRIES = 2000;

export class ArticleDeduplicator {
  private urls: Set<string>;
  private fingerprints: Set<string>;
  /** Insertion-order tracking for FIFO pruning */
  private insertionOrder: string[];

  constructor() {
    this.urls = new Set();
    this.fingerprints = new Set();
    this.insertionOrder = [];
    this.load();
  }

  /** Check if an article has been seen before (by URL or content fingerprint). */
  isDuplicate(url: string | undefined, text: string): boolean {
    if (url && this.urls.has(url)) return true;
    const fp = this.computeFingerprint(text);
    return this.fingerprints.has(fp);
  }

  /** Mark an article as seen. */
  markSeen(url: string | undefined, text: string): void {
    const fp = this.computeFingerprint(text);
    if (url) {
      this.urls.add(url);
      this.insertionOrder.push(`u:${url}`);
    }
    this.fingerprints.add(fp);
    this.insertionOrder.push(`f:${fp}`);
    this.prune();
    this.save();
  }

  /** Normalize text and compute SHA-256 fingerprint (first 16 bytes as hex). */
  computeFingerprint(text: string): string {
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    const hash = sha256(new TextEncoder().encode(normalized));
    return Array.from(hash.slice(0, 16))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /** Clear all dedup state. */
  reset(): void {
    this.urls.clear();
    this.fingerprints.clear();
    this.insertionOrder = [];
    this.save();
  }

  get size(): number {
    return this.urls.size + this.fingerprints.size;
  }

  private prune(): void {
    while (this.insertionOrder.length > MAX_ENTRIES) {
      const oldest = this.insertionOrder.shift();
      if (!oldest) break;
      if (oldest.startsWith("u:")) {
        this.urls.delete(oldest.slice(2));
      } else if (oldest.startsWith("f:")) {
        this.fingerprints.delete(oldest.slice(2));
      }
    }
  }

  private load(): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        urls?: string[];
        fingerprints?: string[];
        order?: string[];
      };
      if (data.urls) data.urls.forEach(u => this.urls.add(u));
      if (data.fingerprints) data.fingerprints.forEach(f => this.fingerprints.add(f));
      if (data.order) this.insertionOrder = data.order;
    } catch {
      // Corrupted data — start fresh
    }
  }

  private save(): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        urls: Array.from(this.urls),
        fingerprints: Array.from(this.fingerprints),
        order: this.insertionOrder,
      }));
    } catch {
      // localStorage full or unavailable
    }
  }
}
