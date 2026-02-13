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
  MAX_CONSECUTIVE_FAILURES,
  BASE_CYCLE_MS,
} from "./sourceState";
import type { ContentItem } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { errMsg } from "@/lib/utils/errors";
import { scoreItemWithHeuristics } from "@/lib/filtering/pipeline";

interface RawItem {
  text: string;
  author: string;
  avatar?: string;
  sourceUrl?: string;
  imageUrl?: string;
  nostrPubkey?: string;
}

const MAX_ITEMS_PER_SOURCE = 5;
const MAX_ENRICH_PER_CYCLE = 3;
const ENRICH_MIN_WORDS = 100;
const MAX_TEXT_LENGTH = 2000;
const MAX_DISPLAY_TEXT = 300;

interface SchedulerSource {
  type: "rss" | "url" | "nostr";
  config: Record<string, string>;
  enabled: boolean;
}

interface SchedulerCallbacks {
  onNewContent: (item: ContentItem) => void;
  getSources: () => SchedulerSource[];
  getUserContext: () => UserContext | null;
  getSkipAI?: () => boolean;
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
  private conditionalHeaders = new Map<string, { etag?: string; lastModified?: string }>();

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
    this.dedup = new ArticleDeduplicator();
    const persisted = loadSourceStates();
    this.sourceStates = new Map(Object.entries(persisted));
  }

  start(): void {
    if (this.intervalId) return;
    // runCycle() is async but fire-and-forget is safe: it has internal try/catch/finally
    // that handles all errors and resets the `running` guard. JS single-threaded event
    // loop guarantees no concurrent execution of the same cycle.
    this.initialTimeoutId = setTimeout(() => this.runCycle(), 5000);
    this.intervalId = setInterval(() => this.runCycle(), BASE_CYCLE_MS);
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

    try {
      const sources = this.callbacks.getSources();
      const userContext = this.callbacks.getUserContext();
      const now = Date.now();
      const cycleItems: ContentItem[] = [];

      for (const source of sources) {
        if (!source.enabled) continue;

        const key = getSourceKey(source.type, source.config);
        const state = this.getOrCreateState(key);

        // Skip if auto-disabled
        if (state.errorCount >= MAX_CONSECUTIVE_FAILURES) continue;

        // Skip if not yet due (adaptive/backoff timing)
        if (state.nextFetchAt > now) continue;

        const errorsBefore = state.errorCount;
        const items = await this.fetchSource(source, key);

        // If fetch recorded an error, skip scoring and success tracking
        if (state.errorCount > errorsBefore) continue;

        const passed = items.filter(raw => quickSlopFilter(raw.text));

        // Deduplicate before scoring (saves Claude API calls)
        const unique = passed.filter(raw => !this.dedup.isDuplicate(raw.sourceUrl, raw.text));

        const enriched = await this.enrichItems(unique, source.type);
        const toScore = enriched.slice(0, MAX_ITEMS_PER_SOURCE);
        const scores: number[] = [];

        for (const raw of toScore) {
          const scored = this.callbacks.getSkipAI?.()
            ? scoreItemWithHeuristics(raw, source.type)
            : await this.scoreItem(raw, userContext, source.type);
          if (scored) {
            this.dedup.markSeen(raw.sourceUrl, raw.text);
            scores.push(scored.scores.composite);
            this.callbacks.onNewContent(scored);
            cycleItems.push(scored);
          }
        }

        // Mark remaining passed items as seen (even if not scored) to avoid re-fetching
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
      this.dedup.flush();
      this.running = false;
    }
  }

  private async enrichItems(
    items: RawItem[],
    sourceType: string,
  ): Promise<RawItem[]> {
    if (sourceType !== "rss") return items;

    let enrichCount = 0;
    const result: typeof items = [];

    for (const item of items) {
      const wordCount = item.text.split(/\s+/).length;

      if (wordCount < ENRICH_MIN_WORDS && item.sourceUrl && enrichCount < MAX_ENRICH_PER_CYCLE) {
        try {
          const res = await fetch("/api/fetch/url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: item.sourceUrl }),
          });
          if (res.ok) {
            const data = await res.json();
            const fullText = `${data.title || ""}\n\n${data.content || ""}`.slice(0, MAX_TEXT_LENGTH);
            if (fullText.split(/\s+/).length > wordCount) {
              result.push({ ...item, text: fullText, imageUrl: item.imageUrl || data.imageUrl });
              enrichCount++;
              continue;
            }
          }
        } catch (err) {
          console.warn("[scheduler] Enrichment failed for", item.sourceUrl, ":", errMsg(err));
        }
      }

      result.push(item);
    }

    return result;
  }

  private async fetchSource(source: SchedulerSource, key: string): Promise<RawItem[]> {
    switch (source.type) {
      case "rss":
        return this.fetchRSS(source.config.feedUrl, key);
      case "nostr":
        return this.fetchNostr(
          source.config.relays?.split(",").map(r => r.trim()) || ["wss://relay.damus.io"],
          source.config.pubkeys?.split(",").map(p => p.trim()),
          key,
        );
      case "url":
        return this.fetchURL(source.config.url, key);
      default:
        console.warn(`[scheduler] Unknown source type: ${source.type}`);
        return [];
    }
  }

  private async fetchRSS(feedUrl: string, key: string): Promise<RawItem[]> {
    try {
      const body: Record<string, unknown> = { feedUrl, limit: 10 };
      const cached = this.conditionalHeaders.get(key);
      if (cached?.etag) body.etag = cached.etag;
      if (cached?.lastModified) body.lastModified = cached.lastModified;

      const res = await fetch("/api/fetch/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.recordSourceError(key, `HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();

      if (data.etag || data.lastModified) {
        this.conditionalHeaders.set(key, { etag: data.etag, lastModified: data.lastModified });
      }

      // 304 Not Modified — no new content
      if (data.notModified) return [];

      return (data.items || []).map((item: { title: string; content: string; author?: string; link?: string; imageUrl?: string }) => ({
        text: `${item.title}\n\n${item.content}`.slice(0, MAX_TEXT_LENGTH),
        author: item.author || data.feedTitle || "RSS",
        sourceUrl: item.link,
        imageUrl: item.imageUrl,
      }));
    } catch (err) {
      const msg = errMsg(err);
      console.error("[scheduler] RSS fetch failed:", msg);
      this.recordSourceError(key, msg);
      return [];
    }
  }

  private async fetchNostr(relays: string[], pubkeys: string[] | undefined, key: string): Promise<RawItem[]> {
    try {
      const res = await fetch("/api/fetch/nostr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relays, pubkeys: pubkeys?.filter(Boolean).length ? pubkeys.filter(Boolean) : undefined, limit: 20 }),
      });
      if (!res.ok) {
        this.recordSourceError(key, `HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      const profiles: Record<string, { name?: string; picture?: string }> = data.profiles || {};
      return (data.events || []).map((ev: { content: string; pubkey: string; id: string }) => {
        const profile = profiles[ev.pubkey];
        return {
          text: ev.content.slice(0, MAX_TEXT_LENGTH),
          author: profile?.name || ev.pubkey.slice(0, 12) + "...",
          avatar: profile?.picture,
          sourceUrl: `nostr:${ev.id}`,
          nostrPubkey: ev.pubkey,
        };
      });
    } catch (err) {
      const msg = errMsg(err);
      console.error("[scheduler] Nostr fetch failed:", msg);
      this.recordSourceError(key, msg);
      return [];
    }
  }

  private async fetchURL(url: string, key: string): Promise<RawItem[]> {
    try {
      const res = await fetch("/api/fetch/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        this.recordSourceError(key, `HTTP ${res.status}`);
        return [];
      }
      const data = await res.json();
      let hostname = "unknown";
      try { hostname = new URL(url).hostname; } catch { /* noop */ }
      return [{
        text: `${data.title || ""}\n\n${data.content || ""}`.slice(0, MAX_TEXT_LENGTH),
        author: data.author || hostname,
        sourceUrl: url,
        imageUrl: data.imageUrl,
      }];
    } catch (err) {
      const msg = errMsg(err);
      console.error("[scheduler] URL fetch failed:", msg);
      this.recordSourceError(key, msg);
      return [];
    }
  }

  private async scoreItem(
    raw: RawItem,
    userContext: UserContext | null,
    sourceType: SchedulerSource["type"],
  ): Promise<ContentItem | null> {
    try {
      const body: Record<string, unknown> = { text: raw.text, source: "auto" };
      if (userContext) body.userContext = userContext;

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const result: AnalyzeResponse = data.fallback || data;

      return {
        id: uuidv4(),
        owner: "",
        author: raw.author,
        avatar: raw.avatar || (sourceType === "nostr" ? "\uD83D\uDD2E" : "\uD83D\uDCE1"),
        text: raw.text.slice(0, MAX_DISPLAY_TEXT),
        source: sourceType,
        sourceUrl: raw.sourceUrl,
        imageUrl: raw.imageUrl,
        nostrPubkey: raw.nostrPubkey,
        scores: {
          originality: result.originality,
          insight: result.insight,
          credibility: result.credibility,
          composite: result.composite,
        },
        verdict: result.verdict,
        reason: result.reason,
        createdAt: Date.now(),
        validated: false,
        flagged: false,
        timestamp: "just now",
        topics: result.topics,
        vSignal: result.vSignal,
        cContext: result.cContext,
        lSlop: result.lSlop,
        scoredByAI: true,
      };
    } catch (err) {
      console.error("[scheduler] Score item failed:", errMsg(err));
      return null;
    }
  }
}
