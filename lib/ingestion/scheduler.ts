import * as Sentry from "@sentry/nextjs";
import { v4 as uuidv4 } from "uuid";
import { quickSlopFilter } from "./quickFilter";
import { ArticleDeduplicator } from "./dedup";
import {
  type SourceRuntimeState,
  defaultState,
  getSourceKey,
  loadSourceStates,
  saveSourceStates,
  computeBackoffDelay,
  computeAdaptiveInterval,
  resetSourceErrors,
  MAX_CONSECUTIVE_FAILURES,
  AUTO_RECOVERY_MS,
  BASE_CYCLE_MS,
} from "./sourceState";
import { type ContentItem, scoredItemFields } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { errMsg } from "@/lib/utils/errors";
import { scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import { fetchRSS, fetchNostr, fetchURL, fetchFarcaster, type RawItem, type FetcherCallbacks } from "./fetchers";

const MAX_ITEMS_PER_SOURCE = 5;
const MAX_ENRICH_PER_CYCLE = 3;
const ENRICH_MIN_WORDS = 100;
const MAX_TEXT_LENGTH = 2000;
const MAX_DISPLAY_TEXT = 300;

export interface SchedulerSource {
  type: "rss" | "url" | "nostr" | "farcaster";
  config: Record<string, string>;
  enabled: boolean;
  platform?: import("@/lib/types/sources").SourcePlatform;
}

interface SchedulerCallbacks {
  onNewContent: (item: ContentItem) => void;
  getSources: () => SchedulerSource[];
  getUserContext: () => UserContext | null;
  getSkipAI?: () => boolean;
  /** Full scoring cascade (Ollama → WebLLM → BYOK → IC LLM → Server → Heuristic). Provided by ContentContext. */
  scoreFn?: (text: string, userContext?: UserContext | null) => Promise<AnalyzeResponse>;
  onSourceError?: (sourceKey: string, error: string) => void;
  onSourceAutoDisabled?: (sourceKey: string, error: string) => void;
  onCycleComplete?: (newItemCount: number, items: ContentItem[]) => void;
}

export class IngestionScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private callbacks: SchedulerCallbacks;
  private running = false;
  private sourceStates: Map<string, SourceRuntimeState>;
  private dedup: ArticleDeduplicator;
  /** ETag / Last-Modified cache per source key */
  private httpCacheHeaders = new Map<string, { etag?: string; lastModified?: string }>();
  private readonly fetchCallbacks: FetcherCallbacks;

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
    this.dedup = new ArticleDeduplicator();
    const persisted = loadSourceStates();
    this.sourceStates = new Map(Object.entries(persisted));
    this.fetchCallbacks = {
      handleFetchError: (res, key) => this.handleFetchError(res, key),
      recordSourceError: (key, error) => this.recordSourceError(key, error),
    };
  }

  start(): void {
    if (this.intervalId || this.initialTimeoutId) return;
    const safeCycle = () => this.runCycle().catch(err => {
      console.error("[scheduler] Unhandled cycle error:", errMsg(err));
      this.running = false;
    });
    const initAndStart = async () => {
      try {
        await this.dedup.init();
      } catch (err) {
        console.error("[scheduler] Dedup init failed, first cycle may have reduced dedup coverage:", errMsg(err));
      }
      await safeCycle();
    };
    this.initialTimeoutId = setTimeout(() => {
      initAndStart().catch(err => {
        console.error("[scheduler] initAndStart failed:", errMsg(err));
        this.running = false;
      });
    }, 5000);
    this.intervalId = setInterval(safeCycle, BASE_CYCLE_MS);
  }

  stop(): void {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getSourceStates(): ReadonlyMap<string, SourceRuntimeState> {
    return this.sourceStates;
  }

  resetDedup(): void {
    this.dedup.reset();
  }

  /** Reset error state for a source key, re-enabling it if it was auto-disabled. */
  resetSourceState(key: string): void {
    const state = this.sourceStates.get(key);
    if (state) {
      state.errorCount = 0;
      state.lastError = "";
      state.nextFetchAt = 0;
      state.rateLimitedUntil = 0;
      this.persistStates();
    } else {
      resetSourceErrors(key);
    }
  }

  private getOrCreateState(key: string): SourceRuntimeState {
    let state = this.sourceStates.get(key);
    if (!state) {
      state = defaultState();
      this.sourceStates.set(key, state);
    }
    return state;
  }

  private persistStates(): void {
    saveSourceStates(Object.fromEntries(this.sourceStates));
  }

  private handleFetchError(res: Response, key: string): void {
    if (res.status === 429) {
      const raw = parseInt(res.headers.get("Retry-After") || "60", 10);
      this.recordRateLimit(key, isNaN(raw) ? 60 : raw);
    } else {
      this.recordSourceError(key, `HTTP ${res.status}`);
    }
  }

  private recordRateLimit(key: string, retryAfterSec: number): void {
    const state = this.getOrCreateState(key);
    const retryMs = Math.max(retryAfterSec * 1000, 60_000);
    state.rateLimitedUntil = Date.now() + retryMs;
    state.nextFetchAt = Date.now() + retryMs;
    this.persistStates();
  }

  private recordSourceError(key: string, error: string): void {
    const state = this.getOrCreateState(key);
    state.errorCount += 1;
    state.lastError = error;
    state.lastErrorAt = Date.now();

    const backoff = computeBackoffDelay(state.errorCount);
    state.nextFetchAt = Date.now() + backoff;

    this.persistStates();
    this.callbacks.onSourceError?.(key, error);

    if (state.errorCount >= MAX_CONSECUTIVE_FAILURES) {
      this.callbacks.onSourceAutoDisabled?.(key, error);
    }
  }

  private recordSourceSuccess(key: string, itemCount: number, scores: number[]): void {
    const state = this.getOrCreateState(key);
    state.errorCount = 0;
    state.lastError = "";
    state.lastSuccessAt = Date.now();
    state.lastFetchedAt = Date.now();
    state.itemsFetched = itemCount;

    if (itemCount === 0) {
      state.consecutiveEmpty += 1;
    } else {
      state.consecutiveEmpty = 0;
    }

    if (scores.length > 0) {
      const newAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const prevTotal = state.totalItemsScored;
      state.averageScore =
        prevTotal === 0
          ? newAvg
          : (state.averageScore * prevTotal + newAvg * scores.length) / (prevTotal + scores.length);
      state.totalItemsScored += scores.length;
    }

    const interval = computeAdaptiveInterval(state);
    state.nextFetchAt = Date.now() + interval;

    this.persistStates();
  }

  private async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await Sentry.startSpan({ name: "scheduler.cycle", op: "scheduler" }, async () => {
    try {
      const sources = this.callbacks.getSources();
      const userContext = this.callbacks.getUserContext();
      const now = Date.now();
      const cycleItems: ContentItem[] = [];

      const activeKeys = new Set(sources.map(s => getSourceKey(s.type, s.config)));
      for (const key of Array.from(this.httpCacheHeaders.keys())) {
        if (!activeKeys.has(key)) this.httpCacheHeaders.delete(key);
      }
      if (this.httpCacheHeaders.size > 200) this.httpCacheHeaders.clear();

      for (const source of sources) {
        if (!source.enabled) continue;

        const key = getSourceKey(source.type, source.config);
        const state = this.getOrCreateState(key);

        if (state.errorCount >= MAX_CONSECUTIVE_FAILURES && state.lastErrorAt > 0 && now - state.lastErrorAt >= AUTO_RECOVERY_MS) {
          state.errorCount = MAX_CONSECUTIVE_FAILURES - 1;
          state.nextFetchAt = 0;
          this.persistStates();
        }

        if (state.errorCount >= MAX_CONSECUTIVE_FAILURES) continue;
        if (state.nextFetchAt > now) continue;

        const errorsBefore = state.errorCount;
        const items = await this.fetchSource(source, key);
        if (state.errorCount > errorsBefore) continue;

        const passed = items.filter(raw => quickSlopFilter(raw.text));

        const unique = passed.filter(raw => !this.dedup.isDuplicate(raw.sourceUrl, raw.text));

        const enriched = await this.enrichItems(unique, source.type);
        const toScore = enriched.slice(0, MAX_ITEMS_PER_SOURCE);
        const scores: number[] = [];

        for (const raw of toScore) {
          const scored = this.callbacks.getSkipAI?.()
            ? scoreItemWithHeuristics(raw, source.type, source.platform)
            : await this.scoreItem(raw, userContext, source.type, source.platform);
          this.dedup.markSeen(raw.sourceUrl, raw.text);
          if (scored) {
            scores.push(scored.scores.composite);
            this.callbacks.onNewContent(scored);
            cycleItems.push(scored);
          }
        }

        for (const raw of unique.slice(MAX_ITEMS_PER_SOURCE)) {
          this.dedup.markSeen(raw.sourceUrl, raw.text);
        }

        this.recordSourceSuccess(key, items.length, scores);
      }
      if (cycleItems.length > 0) {
        this.callbacks.onCycleComplete?.(cycleItems.length, cycleItems);
      }
    } catch (err) {
      console.error("[scheduler] Ingestion cycle failed:", errMsg(err));
    } finally {
      await this.dedup.flush();
      this.running = false;
    }
    });
  }

  private async enrichItems(
    items: RawItem[],
    sourceType: string,
  ): Promise<RawItem[]> {
    if (sourceType !== "rss") return items;

    const toEnrich: Array<{ index: number; url: string }> = [];
    for (let i = 0; i < items.length; i++) {
      if (toEnrich.length >= MAX_ENRICH_PER_CYCLE) break;
      const wordCount = items[i].text.split(/\s+/).length;
      if (wordCount < ENRICH_MIN_WORDS && items[i].sourceUrl) {
        toEnrich.push({ index: i, url: items[i].sourceUrl! });
      }
    }

    if (toEnrich.length === 0) return items;

    const enrichedData = new Map<number, { title?: string; content?: string; imageUrl?: string }>();
    try {
      const res = await fetch("/api/fetch/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: toEnrich.map(e => e.url) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json();
        const results: Array<{ url: string; title?: string; content?: string; imageUrl?: string; error?: string }> = data.results || [];
        for (let i = 0; i < results.length && i < toEnrich.length; i++) {
          const r = results[i];
          if (!r.error && r.content) {
            enrichedData.set(toEnrich[i].index, r);
          }
        }
      }
    } catch (err) {
      console.warn("[scheduler] Batch enrichment failed:", errMsg(err));
    }

    return items.map((item, i) => {
      const data = enrichedData.get(i);
      if (!data) return item;
      const fullText = `${data.title || ""}\n\n${data.content || ""}`.slice(0, MAX_TEXT_LENGTH);
      const origWordCount = item.text.split(/\s+/).length;
      if (fullText.split(/\s+/).length > origWordCount) {
        return { ...item, text: fullText, imageUrl: item.imageUrl || data.imageUrl };
      }
      return item;
    });
  }

  private async fetchSource(source: SchedulerSource, key: string): Promise<RawItem[]> {
    const cb = this.fetchCallbacks;
    switch (source.type) {
      case "rss":
        return fetchRSS(source.config.feedUrl, key, this.httpCacheHeaders, cb);
      case "nostr":
        return fetchNostr(
          source.config.relays?.split(",").map(r => r.trim()) || ["wss://relay.damus.io"],
          source.config.pubkeys?.split(",").map(p => p.trim()),
          key,
          cb,
        );
      case "url":
        return fetchURL(source.config.url, key, cb);
      case "farcaster":
        return fetchFarcaster(source.config.fid, source.config.username, key, cb);
      default:
        console.warn(`[scheduler] Unknown source type: ${source.type}`);
        return [];
    }
  }

  private async scoreItem(
    raw: RawItem,
    userContext: UserContext | null,
    sourceType: SchedulerSource["type"],
    platform?: SchedulerSource["platform"],
  ): Promise<ContentItem | null> {
    try {
      if (!this.callbacks.scoreFn) {
        console.warn("[scheduler] No scoreFn provided — cannot score");
        return null;
      }

      const result = await this.callbacks.scoreFn(raw.text, userContext);

      return {
        id: uuidv4(),
        owner: "",
        author: raw.author,
        avatar: raw.avatar || (sourceType === "nostr" ? "\uD83D\uDD2E" : sourceType === "farcaster" ? "\uD83D\uDFE3" : "\uD83D\uDCE1"),
        text: raw.text.slice(0, MAX_DISPLAY_TEXT),
        source: sourceType,
        sourceUrl: raw.sourceUrl,
        imageUrl: raw.imageUrl,
        nostrPubkey: raw.nostrPubkey,
        ...scoredItemFields(result),
        platform,
      };
    } catch (err) {
      console.error("[scheduler] Score item failed:", errMsg(err));
      return null;
    }
  }
}
